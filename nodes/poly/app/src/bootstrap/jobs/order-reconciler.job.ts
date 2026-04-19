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
 *     based redemption detection is deferred.
 *     TODO(task.0323 §2): implement redemption-sync using `getOperatorPositions`
 *     once task.0323 phase-2 spec is finalized.
 * Side-effects: starts a `setInterval`, emits logs + metrics.
 * Links: work/items/task.0323 §2, docs/spec/poly-copy-trade-phase1.md
 *
 * @scaffolding
 * Deleted-in-phase: 4 (replaced by Temporal-hosted WS ingester workflow; see
 *   work/items/task.0322.poly-copy-trade-phase4-design-prep.md).
 *
 * @internal
 */

import type {
  LoggerPort,
  MetricsPort,
  OrderReceipt,
} from "@cogni/market-provider";
import type { PolymarketUserPosition } from "@cogni/market-provider/adapters/polymarket";
import { EVENT_NAMES } from "@cogni/node-shared";

import type { LedgerRow, LedgerStatus, OrderLedger } from "@/features/trading";

// ─────────────────────────────────────────────────────────────────────────────
// Metric names
// ─────────────────────────────────────────────────────────────────────────────

export const RECONCILER_METRICS = {
  /** One per tick (regardless of how many rows were processed). */
  ticksTotal: "poly_mirror_reconcile_ticks_total",
  /** One per ledger row whose status was actually changed. */
  updatesTotal: "poly_mirror_reconcile_updates_total",
  /** One per `getOrder` / `updateStatus` error; tick continues for other rows. */
  errorsTotal: "poly_mirror_reconcile_errors_total",
} as const;

const RECONCILE_POLL_MS = 60_000;
const DEFAULT_OLDER_THAN_MS = 30_000;
const DEFAULT_LIMIT = 200;

// ─────────────────────────────────────────────────────────────────────────────
// Public interface
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderReconcilerDeps {
  ledger: OrderLedger;
  /** `PolyTradeBundle.getOrder` — returns `null` when the order is not found. */
  getOrder: (orderId: string) => Promise<OrderReceipt | null>;
  /**
   * `PolyTradeBundle.getOperatorPositions` — fetched once per tick for future
   * redemption-sync. Currently unused beyond the TODO below.
   */
  getOperatorPositions: () => Promise<PolymarketUserPosition[]>;
  operatorWalletAddress: `0x${string}`;
  logger: LoggerPort;
  metrics: MetricsPort;
}

/** Stops the reconciler. Returned so the container can call on SIGTERM. */
export type ReconcilerStopFn = () => void;

// ─────────────────────────────────────────────────────────────────────────────
// Receipt status → LedgerStatus map (mirrors order-ledger.ts `mapReceiptStatus`)
// ─────────────────────────────────────────────────────────────────────────────

function mapReceiptStatus(s: OrderReceipt["status"]): LedgerStatus {
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

  const rows: LedgerRow[] = await deps.ledger.listOpenOrPending({
    olderThanMs: DEFAULT_OLDER_THAN_MS,
    limit: DEFAULT_LIMIT,
  });

  for (const row of rows) {
    if (!row.order_id) {
      // Can't prove anything without a CLOB order id — placement may still be
      // in-flight. Skip; markOrderId will eventually stamp the id.
      continue;
    }

    try {
      const receipt = await deps.getOrder(row.order_id);
      if (!receipt) {
        // Order not found on CLOB — could be very new or purged. Skip.
        continue;
      }

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

      deps.metrics.incr(RECONCILER_METRICS.updatesTotal, {
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
      deps.metrics.incr(RECONCILER_METRICS.errorsTotal, {});
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

  // TODO(task.0323 §2): redemption-sync — call getOperatorPositions once per
  // tick and mark filled rows as redeemed when the operator no longer holds
  // the asset. Deferred: need to distinguish a sold position (canceled) from a
  // market-resolved redemption (still "filled") without ambiguity.
  // For now `getOperatorPositions` is accepted in deps but not called, keeping
  // the interface stable for the follow-up PR.

  deps.metrics.incr(RECONCILER_METRICS.ticksTotal, {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Job shim — singleton claim + setInterval wrapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start the 60s reconciler poll. Emits
 * `poly.mirror.reconcile.singleton_claim` at boot. Returns a stop fn.
 *
 * @public
 */
export function startOrderReconciler(
  deps: OrderReconcilerDeps
): ReconcilerStopFn {
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

  async function tick(): Promise<void> {
    try {
      await runReconcileOnce(deps);
    } catch (err: unknown) {
      // Belt-and-suspenders: `runReconcileOnce` already catches per-row errors.
      // Anything escaping here is a structural bug (e.g. ledger query threw).
      deps.metrics.incr(RECONCILER_METRICS.errorsTotal, {});
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

  const handle = setInterval(() => {
    void tick();
  }, RECONCILE_POLL_MS);

  return function stop() {
    clearInterval(handle);
    log.info(
      { event: EVENT_NAMES.POLY_MIRROR_RECONCILE_STOPPED },
      "order reconciler stopped"
    );
  };
}
