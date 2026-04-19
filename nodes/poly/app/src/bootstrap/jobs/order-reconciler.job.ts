// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/jobs/order-reconciler.job`
 * Purpose: Disposable 60s scheduler that reconciles `poly_copy_trade_fills` rows
 * with current CLOB status. For each `pending` / `open` row with a non-null
 * `order_id`, calls `getOrder` and updates the ledger if the status has changed.
 * Closes the dashboard lie: rows showing `open` that have already filled or
 * been canceled are now updated within one tick.
 * Scope: Wiring + cadence only. Does not build adapters (container injects),
 * does not own placement logic, does not touch DB directly. Exports
 * `startOrderReconciler(deps) → stop()` and the pure `runReconcileOnce` for
 * unit tests.
 * Invariants:
 *   - SCAFFOLDING_LABELED — this file is `@scaffolding` / `Deleted-in-phase: 4`.
 *     P4's Temporal-hosted WS ingester will provide real-time status updates.
 *   - SINGLE_WRITER — exactly one process runs the reconciler. Enforced by
 *     caller (POLY_ROLE=trader + replicas=1 joint invariant). Boot logs
 *     `event:poly.mirror.reconcile.singleton_claim`.
 *   - TICK_IS_SELF_HEALING — errors are caught per-row; the tick continues for
 *     remaining rows and never crashes the interval.
 *   - NO_REDEMPTION_SYNC_V0 — reconciler only syncs from `getOrder`. Position-
 *     based redemption detection is deferred (task.0329).
 *   - GETORDER_NEVER_NULL — `getOrder` returns `GetOrderResult`; null is never a
 *     valid return. Callers branch on the discriminant. (task.0328 CP1)
 *   - GRACE_WINDOW_IS_CONFIG — not_found rows older than `notFoundGraceMs` are
 *     promoted to `canceled`; value sourced from `POLY_CLOB_NOT_FOUND_GRACE_MS`
 *     env var (default 900 000 ms). (task.0328 CP2)
 *   - UPGRADE_IS_METERED — each not_found-to-canceled promotion increments
 *     `poly_reconciler_not_found_upgrades_total`. (task.0328 CP2)
 *   - SYNCED_AT_WRITTEN_ON_EVERY_SYNC — `markSynced` is called for every row
 *     for which `getOrder` returned a typed answer. (task.0328 CP3)
 *   - SYNC_HEALTH_IS_PUBLIC — `reconcilerLastTickAt` is stamped each tick and
 *     surfaced by the `/api/v1/poly/internal/sync-health` endpoint. (task.0328 CP4)
 * Side-effects: starts a `setInterval`, emits logs + metrics.
 * Links: work/items/task.0323 §2, docs/spec/poly-copy-trade-phase1.md
 *
 * @scaffolding
 * Deleted-in-phase: 4 (replaced by Temporal-hosted WS ingester workflow; see
 *   work/items/task.0322.poly-copy-trade-phase4-design-prep.md).
 *
 * @internal
 */

// TODO(task.0329): redemption-sync will add `getOperatorPositions` back.
import type {
  GetOrderResult,
  LoggerPort,
  MetricsPort,
  OrderStatus,
} from "@cogni/market-provider";
import { EVENT_NAMES } from "@cogni/node-shared";

import type { LedgerRow, LedgerStatus, OrderLedger } from "@/features/trading";

// ─────────────────────────────────────────────────────────────────────────────
// Metric names
// ─────────────────────────────────────────────────────────────────────────────

export const ORDER_RECONCILER_METRICS = {
  /** One per tick (regardless of how many rows were processed). */
  ticksTotal: "poly_mirror_reconcile_ticks_total",
  /** One per ledger row whose status was actually changed. */
  updatesTotal: "poly_mirror_reconcile_updates_total",
  /** One per `getOrder` / `updateStatus` error; tick continues for other rows. */
  errorsTotal: "poly_mirror_reconcile_errors_total",
  /**
   * One per row promoted from open/pending → canceled because CLOB returned
   * not_found beyond the grace window. A spike here signals CLOB changed its
   * order-retention / pruning behavior. Alert threshold: >5 in 10 min.
   */
  notFoundUpgradesTotal: "poly_reconciler_not_found_upgrades_total",
} as const;

const RECONCILE_POLL_MS = 60_000;
const DEFAULT_OLDER_THAN_MS = 30_000;
const DEFAULT_LIMIT = 200;

// ─────────────────────────────────────────────────────────────────────────────
// Public interface
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderReconcilerDeps {
  ledger: OrderLedger;
  /**
   * `PolyTradeBundle.getOrder` — returns a discriminated `GetOrderResult`.
   * GETORDER_NEVER_NULL invariant (task.0328 CP1): null is never returned.
   */
  getOrder: (orderId: string) => Promise<GetOrderResult>;
  operatorWalletAddress: `0x${string}`;
  logger: LoggerPort;
  metrics: MetricsPort;
  /**
   * Grace window (ms) before a not_found row is promoted to canceled.
   * GRACE_WINDOW_IS_CONFIG invariant (task.0328 CP2): read from
   * `POLY_CLOB_NOT_FOUND_GRACE_MS` via server-env; default 900 000 (15 min).
   */
  notFoundGraceMs: number;
  /**
   * Injected clock — returns the current wall time. Defaults to `() => new Date()`
   * at production call sites. Injected in tests for deterministic age calculations.
   * Mirrors the `clock` dep pattern in `mirror-coordinator.ts`.
   */
  clock?: () => Date;
}

/** Stops the reconciler. Returned so the container can call on SIGTERM. */
export type ReconcilerStopFn = () => void;

/**
 * Handle returned by `startOrderReconciler`.
 * `stop` clears the interval; `getLastTickAt` returns the wall time of the last
 * successful tick (after `markSynced` completed), or null before the first tick.
 *
 * SYNC_HEALTH_IS_PUBLIC invariant (task.0328 CP4).
 */
export interface OrderReconcilerHandle {
  stop: ReconcilerStopFn;
  getLastTickAt: () => Date | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Receipt status → LedgerStatus map (mirrors order-ledger.ts `mapReceiptStatus`)
// ─────────────────────────────────────────────────────────────────────────────

function mapReceiptStatus(s: OrderStatus): LedgerStatus {
  switch (s) {
    case "filled":
      return "filled";
    case "partial":
      return "partial";
    case "canceled":
      return "canceled";
    case "open":
      return "open";
    default:
      // Unknown future statuses surface as `open` until CLOB extends the set.
      return "open";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure tick — exported for unit tests; job shim wraps it in setInterval.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run one reconcile pass. Exported for direct unit-test consumption; the
 * `startOrderReconciler` shim simply calls this inside a `setInterval`.
 *
 * @public
 */
export async function runReconcileOnce(
  deps: OrderReconcilerDeps
): Promise<void> {
  const log = deps.logger.child({ component: "order-reconciler" });
  const clock = deps.clock ?? (() => new Date());

  const rows: LedgerRow[] = await deps.ledger.listOpenOrPending({
    olderThanMs: DEFAULT_OLDER_THAN_MS,
    limit: DEFAULT_LIMIT,
  });

  // Collect ids for which getOrder returned a typed answer (found OR not_found).
  // Rows where getOrder threw (network error) are excluded — their staleness
  // grows until we can verify. Bulk-stamped via markSynced after the loop.
  // SYNCED_AT_WRITTEN_ON_EVERY_SYNC invariant (task.0328 CP3).
  const syncedIds: string[] = [];

  for (const row of rows) {
    if (!row.order_id) {
      // Can't prove anything without a CLOB order id — placement may still be
      // in-flight. Skip; markOrderId will eventually stamp the id.
      continue;
    }

    try {
      const result = await deps.getOrder(row.order_id);
      // getOrder returned a typed response — mark as synced regardless of branch.
      syncedIds.push(row.client_order_id);

      if (!("found" in result)) {
        const ageMs = clock().getTime() - row.created_at.getTime();
        if (ageMs < deps.notFoundGraceMs) {
          // Still within grace — assume CLOB is just slow to index.
          log.debug(
            {
              event: EVENT_NAMES.POLY_RECONCILER_NOT_FOUND,
              client_order_id: row.client_order_id,
              ageMs,
            },
            "CLOB getOrder returned not_found (within grace window)"
          );
          continue;
        }
        // Beyond grace — CLOB has pruned or the order was canceled and we
        // missed the transition. Promote to canceled with a distinct reason
        // so forensics can tell this apart from a normal user/market cancel.
        await deps.ledger.updateStatus({
          client_order_id: row.client_order_id,
          status: "canceled",
          reason: "clob_not_found",
        });
        deps.metrics.incr(ORDER_RECONCILER_METRICS.notFoundUpgradesTotal, {});
        log.info(
          {
            event: EVENT_NAMES.POLY_RECONCILER_NOT_FOUND_UPGRADE,
            client_order_id: row.client_order_id,
            order_id: row.order_id,
            ageMs,
          },
          "reconciler: promoting stuck row to canceled (CLOB not_found > grace)"
        );
        continue;
      }
      const receipt = result.found;

      const newStatus = mapReceiptStatus(receipt.status);
      if (newStatus === row.status) {
        // Nothing changed — avoid a gratuitous UPDATE + updated_at churn.
        continue;
      }

      await deps.ledger.updateStatus({
        client_order_id: row.client_order_id,
        status: newStatus,
        filled_size_usdc: receipt.filled_size_usdc ?? undefined,
      });

      deps.metrics.incr(ORDER_RECONCILER_METRICS.updatesTotal, {
        from: row.status,
        to: newStatus,
      });

      log.info(
        {
          client_order_id: row.client_order_id,
          order_id: row.order_id,
          from: row.status,
          to: newStatus,
        },
        "reconciler: status updated"
      );
    } catch (err: unknown) {
      // getOrder threw — do NOT add to syncedIds; row staleness grows.
      deps.metrics.incr(ORDER_RECONCILER_METRICS.errorsTotal, {});
      log.error(
        {
          event: EVENT_NAMES.POLY_MIRROR_RECONCILE_TICK_ERROR,
          errorCode: "reconcile_row_error",
          client_order_id: row.client_order_id,
          order_id: row.order_id,
          err: err instanceof Error ? err.message : String(err),
        },
        "reconciler: row error (continuing)"
      );
    }
  }

  // Bulk-stamp synced_at for all rows that got a typed CLOB response this tick.
  // One UPDATE vs N — correct and efficient.
  await deps.ledger.markSynced(syncedIds);

  deps.metrics.incr(ORDER_RECONCILER_METRICS.ticksTotal, {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Job shim — singleton claim + setInterval wrapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start the 60s reconciler poll. Emits
 * `poly.mirror.reconcile.singleton_claim` at boot. Returns an
 * `OrderReconcilerHandle` with `stop` + `getLastTickAt`.
 *
 * @public
 */
export function startOrderReconciler(
  deps: OrderReconcilerDeps
): OrderReconcilerHandle {
  const log = deps.logger.child({
    component: "order-reconciler-job",
    operator_wallet: deps.operatorWalletAddress,
  });

  log.info(
    {
      event: EVENT_NAMES.POLY_MIRROR_RECONCILE_SINGLETON_CLAIM,
      poll_ms: RECONCILE_POLL_MS,
    },
    "order reconciler starting (SINGLE_WRITER — alert on duplicate pods running this)"
  );

  // In-memory last-tick timestamp. Updated at the END of each successful tick
  // (after markSynced completes). Null before first tick completes.
  // SYNC_HEALTH_IS_PUBLIC invariant (task.0328 CP4).
  let lastTickAt: Date | null = null;

  async function tick(): Promise<void> {
    try {
      await runReconcileOnce(deps);
      // Stamp AFTER the full tick (including markSynced) succeeds.
      lastTickAt = new Date();
    } catch (err: unknown) {
      // Belt-and-suspenders: `runReconcileOnce` already catches per-row errors.
      // Anything escaping here is a structural bug (e.g. ledger query threw).
      deps.metrics.incr(ORDER_RECONCILER_METRICS.errorsTotal, {});
      log.error(
        {
          event: EVENT_NAMES.POLY_MIRROR_RECONCILE_TICK_ERROR,
          errorCode: "tick_escaped_handler",
          err: err instanceof Error ? err.message : String(err),
        },
        "order reconciler: tick threw (continuing)"
      );
    }
  }

  // First tick fires immediately.
  void tick();

  const intervalHandle = setInterval(() => {
    void tick();
  }, RECONCILE_POLL_MS);

  return {
    stop() {
      clearInterval(intervalHandle);
      log.info(
        { event: EVENT_NAMES.POLY_MIRROR_RECONCILE_STOPPED },
        "order reconciler stopped"
      );
    },
    getLastTickAt() {
      return lastTickAt;
    },
  };
}
