// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@bootstrap/jobs/market-outcome.job`
 * Purpose: Process-local scheduler for the condition-iterating market outcome
 *          tick. Sibling to `trader-observation.job` — wallet-iterating tick
 *          writes fills/positions, this tick writes resolutions.
 * Scope: Wiring + cadence only. Caller injects DB/clobClient/logger/metrics; the
 *        feature service owns the tick body.
 * Invariants:
 *   - TICK_IS_SELF_HEALING: escaped errors are logged and the interval continues.
 *   - DEFAULT_5_MIN_CADENCE: spike.5001 confirmed `pLimit(4)` at 24 rps is safe;
 *     200–500 active conditions @ 5-min interval = ~100 calls/min, well below
 *     the 7,200/min ceiling.
 *   - BACKFILL_UNTIL_DRAINED: ticks run with `includeBackfill = true` until
 *     a tick returns `conditions === 0`, signalling the historical condition
 *     set is fully resolved. Only then does the job switch to the 30-day
 *     filter. Previous behaviour flipped the flag after the first tick
 *     regardless of progress, which capped the backfill at one batch
 *     (`batchSize`) per pod-restart and left ~95% of historical conditions
 *     unresolved indefinitely. State is process-local (no DB cursor) —
 *     restart re-runs the backfill loop.
 * Side-effects: starts a timer, performs IO through injected deps.
 * Links: work/items/task.5012, work/items/task.5016, work/items/spike.5001
 * @internal
 */

import type { LoggerPort, MetricsPort } from "@cogni/poly-market-provider";
import type { PolymarketClobPublicClient } from "@cogni/poly-market-provider/adapters/polymarket";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { runMarketOutcomeTick } from "@/features/wallet-analysis/server/market-outcome-service";

type Db =
  | NodePgDatabase<Record<string, unknown>>
  | PostgresJsDatabase<Record<string, unknown>>;

const MARKET_OUTCOME_POLL_MS = 5 * 60 * 1000;

export type MarketOutcomeJobStopFn = () => void;

export interface MarketOutcomeJobDeps {
  db: Db;
  clobClient: Pick<PolymarketClobPublicClient, "getMarketResolution">;
  logger: LoggerPort;
  metrics: MetricsPort;
  pollMs?: number;
  batchSize?: number;
}

export function startMarketOutcomeJob(
  deps: MarketOutcomeJobDeps
): MarketOutcomeJobStopFn {
  const pollMs = deps.pollMs ?? MARKET_OUTCOME_POLL_MS;
  const log = deps.logger.child({ component: "trader-market-outcome-job" });
  let running = false;
  let backfillPending = true;

  log.info(
    {
      event: "poly.market-outcome.job_start",
      phase: "job_start",
      poll_ms: pollMs,
    },
    "market outcome job starting"
  );

  async function tick(): Promise<void> {
    if (running) {
      log.warn(
        { event: "poly.market-outcome.tick_skipped_running" },
        "market outcome tick skipped; previous tick still running"
      );
      return;
    }
    running = true;
    const isBackfill = backfillPending;
    try {
      const result = await runMarketOutcomeTick({
        db: deps.db,
        clobClient: deps.clobClient,
        logger: deps.logger,
        metrics: deps.metrics,
        ...(deps.batchSize !== undefined ? { batchSize: deps.batchSize } : {}),
        includeBackfill: isBackfill,
      });
      // Drain the historical condition set across multiple ticks. The tick
      // body already caps each run at `batchSize`, so a "complete" backfill
      // is signalled by a tick that finds no stale conditions to process.
      // Flipping the flag earlier (the previous one-tick-and-done behaviour)
      // capped historical resolution at one batch per pod-restart.
      if (isBackfill && result.conditions === 0) {
        backfillPending = false;
        log.info(
          {
            event: "poly.market-outcome.tick_ok",
            phase: "backfill_complete",
          },
          "market outcome backfill complete"
        );
      }
    } catch (err: unknown) {
      log.error(
        {
          event: "poly.market-outcome.tick_error",
          phase: "tick_error",
          err: err instanceof Error ? err.message : String(err),
        },
        "market outcome tick escaped"
      );
    } finally {
      running = false;
    }
  }

  void tick();
  const handle = setInterval(() => {
    void tick();
  }, pollMs);
  handle.unref?.();

  return function stop() {
    clearInterval(handle);
    log.info(
      { event: "poly.market-outcome.job_stop", phase: "job_stop" },
      "market outcome job stopped"
    );
  };
}
