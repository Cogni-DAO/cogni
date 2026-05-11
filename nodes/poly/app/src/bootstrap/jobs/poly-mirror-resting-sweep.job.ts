// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/jobs/poly-mirror-resting-sweep`
 * Purpose: Per-process TTL sweeper. Cancels resting mirror orders older than
 *   `MIRROR_RESTING_TTL_MINUTES` (default 2). Bounds dust accumulation AND
 *   stale-fill risk when the target never sends a SELL signal. The prior 20
 *   minute default was tuned for political-style markets where prices move
 *   slowly; for live sports markets a single goal can move price 10pp+ in
 *   seconds, so a 20-min stale window leaves us exposed to filling at the
 *   target's entry price long after that price has become unattractive.
 *   Worst-case stale window with 2-min TTL + 60s sweep interval ≈ 3 min.
 * Scope: setInterval cadence + per-tenant cancel dispatch.
 * Invariants:
 *   - Single global `findStaleOpen` query → app-side groupBy on
 *     `billing_account_id`. No N+1.
 *   - Cancel routes through the per-tenant executor (404-idempotent).
 *   - Pending rows (no `order_id` yet) are skipped — race with in-flight
 *     placement is acceptable for v0.
 * Side-effects: setInterval, HTTPS to Polymarket CLOB (cancel), Postgres UPDATE.
 * Links: work/items/task.5001
 * @public
 */

import { EVENT_NAMES } from "@cogni/node-shared";
import type { LoggerPort, MetricsPort } from "@cogni/poly-market-provider";

import type { OrderLedger } from "@/features/trading";

export const MIRROR_RESTING_SWEEP_METRICS = {
  /** Counter — one increment per row whose CLOB cancel + ledger mark succeeded. */
  sweptTotal: "poly_mirror_resting_swept_total",
} as const;

export interface RestingSweepDeps {
  ledger: OrderLedger;
  cancelOrderFor: (
    billing_account_id: string
  ) => Promise<(order_id: string) => Promise<void>>;
  logger: LoggerPort;
  metrics: MetricsPort;
  /** Sweep cadence (ms). Default 60_000 (1 min). */
  intervalMs?: number;
  /** Max age (minutes) for an open mirror order. Default 2. */
  ttlMinutes?: number;
}

export type RestingSweepStopFn = () => void;

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_TTL_MINUTES = 2;

/**
 * Start the TTL sweep. Returns a stop fn.
 *
 * @public
 */
export function startRestingSweep(deps: RestingSweepDeps): RestingSweepStopFn {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const ttlMinutes = deps.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  const log = deps.logger.child({
    component: "mirror-resting-sweep",
    interval_ms: intervalMs,
    ttl_minutes: ttlMinutes,
  });

  log.info(
    {
      event: EVENT_NAMES.POLY_MIRROR_POLL_SINGLETON_CLAIM,
      job: "mirror-resting-sweep",
    },
    "mirror resting-sweep starting"
  );

  let stopped = false;

  async function tick(): Promise<void> {
    if (stopped) return;
    let rows: Awaited<ReturnType<typeof deps.ledger.findStaleOpen>>;
    try {
      rows = await deps.ledger.findStaleOpen({ max_age_minutes: ttlMinutes });
    } catch (err: unknown) {
      log.error(
        {
          event: EVENT_NAMES.POLY_MIRROR_DECISION,
          phase: "sweep_tick_error",
          err: err instanceof Error ? err.message : String(err),
        },
        "mirror resting-sweep: findStaleOpen failed; skipping tick"
      );
      return;
    }
    if (rows.length === 0) return;

    const byTenant = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byTenant.get(r.billing_account_id) ?? [];
      list.push(r);
      byTenant.set(r.billing_account_id, list);
    }

    for (const [billing_account_id, tenantRows] of byTenant) {
      let cancel: (order_id: string) => Promise<void>;
      try {
        cancel = await deps.cancelOrderFor(billing_account_id);
      } catch (err: unknown) {
        log.error(
          {
            event: EVENT_NAMES.POLY_MIRROR_DECISION,
            phase: "executor_resolve_failed",
            billing_account_id,
            err: err instanceof Error ? err.message : String(err),
          },
          "mirror resting-sweep: failed to resolve tenant executor"
        );
        continue;
      }

      for (const row of tenantRows) {
        if (row.order_id === null) continue;
        try {
          await cancel(row.order_id);
          await deps.ledger.markCanceled({
            client_order_id: row.client_order_id,
            reason: "ttl_expired",
          });
          deps.metrics.incr(MIRROR_RESTING_SWEEP_METRICS.sweptTotal, {
            reason: "ttl_expired",
          });
          log.info(
            {
              event: EVENT_NAMES.POLY_MIRROR_DECISION,
              phase: "swept",
              client_order_id: row.client_order_id,
              order_id: row.order_id,
              market_id: row.market_id,
            },
            "mirror resting-sweep: canceled stale resting order"
          );
        } catch (err: unknown) {
          log.error(
            {
              event: EVENT_NAMES.POLY_MIRROR_DECISION,
              phase: "sweep_cancel_failed",
              client_order_id: row.client_order_id,
              order_id: row.order_id,
              err: err instanceof Error ? err.message : String(err),
            },
            "mirror resting-sweep: cancel failed; row stays open for next tick"
          );
        }
      }
    }
  }

  void tick();
  const handle = setInterval(() => {
    void tick();
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}
