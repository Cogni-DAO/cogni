// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/jobs/price-history.job`
 * Purpose: Process-local scheduler for the per-asset price-history mirror that
 *          backs `getExecutionSlice` per-position timeline charts. Sibling of
 *          `trader-observation.job.ts`.
 * Scope: Wiring + cadence only. Caller injects DB/clients/logger/metrics; the
 *        feature service owns the tick body.
 * Invariants:
 *   - PRICE_HISTORY_DB_ONLY: this is the only writer to `poly_market_price_history`. Page-load reads go through `readPriceHistoryFromDb`.
 *   - TICK_IS_SELF_HEALING: escaped errors are logged and the interval continues.
 *   - WRITERS_RESPECT_CLOB_RATE_LIMITS: per-asset upstream calls go through the service's `pLimit(4)` cap.
 * Side-effects: starts a timer, performs IO through injected deps.
 * Links: work/items/task.5018, work/items/task.5012
 * @internal
 */

import type { LoggerPort, MetricsPort } from "@cogni/poly-market-provider";
import type { PolymarketClobPublicClient } from "@cogni/poly-market-provider/adapters/polymarket";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { runPriceHistoryTick } from "@/features/wallet-analysis/server/price-history-service";

type Db =
  | NodePgDatabase<Record<string, unknown>>
  | PostgresJsDatabase<Record<string, unknown>>;

const DEFAULT_POLL_MS = 5 * 60 * 1000;

export type PriceHistoryJobStopFn = () => void;

export interface PriceHistoryJobDeps {
  db: Db;
  clobClient?: PolymarketClobPublicClient;
  logger: LoggerPort;
  metrics: MetricsPort;
  pollMs?: number;
}

export function startPriceHistoryJob(
  deps: PriceHistoryJobDeps
): PriceHistoryJobStopFn {
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  const log = deps.logger.child({ component: "trader-price-history-job" });
  let running = false;

  log.info(
    {
      event: "poly.market-price-history.job_start",
      poll_ms: pollMs,
    },
    "price-history job starting"
  );

  async function tick(): Promise<void> {
    if (running) {
      log.warn(
        { event: "poly.market-price-history.tick_skipped_running" },
        "price-history tick skipped; previous tick still running"
      );
      return;
    }
    running = true;
    try {
      await runPriceHistoryTick(deps);
    } catch (err: unknown) {
      log.error(
        {
          event: "poly.market-price-history.tick_error",
          err: err instanceof Error ? err.message : String(err),
        },
        "price-history tick escaped"
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
      { event: "poly.market-price-history.job_stop" },
      "price-history job stopped"
    );
  };
}
