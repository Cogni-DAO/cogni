// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/jobs/trader-observation.job`
 * Purpose: Process-local scheduler for live-forward observed trader wallet collection.
 * Scope: Wiring + cadence only. Caller injects DB/client/logger/metrics; the feature service owns the tick body.
 * Invariants:
 *   - LIVE_FORWARD_COLLECTION: every tick observes configured `active_for_research` wallets from current watermarks.
 *   - TICK_IS_SELF_HEALING: escaped errors are logged and the interval continues.
 * Side-effects: starts a timer, performs IO through injected deps.
 * Links: docs/design/poly-copy-target-performance-benchmark.md, work/items/task.5005
 * @internal
 */

import type { LoggerPort, MetricsPort } from "@cogni/poly-market-provider";
import type { PolymarketDataApiClient } from "@cogni/poly-market-provider/adapters/polymarket";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { runTraderObservationTick } from "@/features/wallet-analysis/server/trader-observation-service";

type Db =
  | NodePgDatabase<Record<string, unknown>>
  | PostgresJsDatabase<Record<string, unknown>>;

const OBSERVATION_POLL_MS = 30_000;

export type TraderObservationJobStopFn = () => void;

export interface TraderObservationJobDeps {
  db: Db;
  client: PolymarketDataApiClient;
  logger: LoggerPort;
  metrics: MetricsPort;
  pollMs?: number;
}

export function startTraderObservationJob(
  deps: TraderObservationJobDeps
): TraderObservationJobStopFn {
  const pollMs = deps.pollMs ?? OBSERVATION_POLL_MS;
  const log = deps.logger.child({ component: "trader-observation-job" });
  let running = false;

  log.info(
    {
      event: "poly.trader.observe",
      phase: "job_start",
      poll_ms: pollMs,
    },
    "trader observation job starting"
  );

  async function tick(): Promise<void> {
    if (running) {
      log.warn(
        { event: "poly.trader.observe", phase: "tick_skipped_running" },
        "trader observation tick skipped; previous tick still running"
      );
      return;
    }
    running = true;
    try {
      await runTraderObservationTick(deps);
    } catch (err: unknown) {
      log.error(
        {
          event: "poly.trader.observe",
          phase: "tick_error",
          err: err instanceof Error ? err.message : String(err),
        },
        "trader observation tick escaped"
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
      { event: "poly.trader.observe", phase: "job_stop" },
      "trader observation job stopped"
    );
  };
}
