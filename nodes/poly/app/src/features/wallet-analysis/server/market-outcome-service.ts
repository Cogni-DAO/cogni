// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/market-outcome-service`
 * Purpose: Sibling tick to `runTraderObservationTick` that polls Polymarket CLOB
 *          `/markets/{conditionId}` for resolution outcomes and writes them into
 *          `poly_market_outcomes`. Iterates conditions (not wallets) so the table
 *          stays fresh for every `(condition_id, token_id)` touched by an active
 *          wallet — current open positions plus fills observed within the last
 *          30 days.
 * Scope: Feature service. Caller injects DB/clobClient/logger/metrics; the
 *        bootstrap job owns scheduling.
 * Invariants:
 *   - DEDUPE_BEFORE_UPSERT: rows are deduped by `(condition_id, token_id)` before
 *     `INSERT … ON CONFLICT DO UPDATE` to avoid Postgres "command cannot affect
 *     row a second time" failures (bug.5011).
 *   - PLIMIT_4_IS_SAFE: spike.5001 measured zero 429s up to 250 calls at
 *     `pLimit(4)` (~24 rps); higher concurrency hits a 37% 429 cliff.
 *   - BATCH_BOUNDED: per-tick batch capped (default 100) to bound runtime.
 *     Remaining stale conditions roll over to the next tick.
 *   - BACKFILL_ONCE: when `includeBackfill=true` the tick drops the 30-day
 *     observed-fills filter and walks the full historical condition set;
 *     callers flip the flag back to false after the first complete run.
 * Side-effects: IO via injected DB + injected CLOB client.
 * Links: work/items/task.5012, work/items/task.5016, work/items/spike.5001
 * @public
 */

import { polyMarketOutcomes } from "@cogni/poly-db-schema";
import type { LoggerPort, MetricsPort } from "@cogni/poly-market-provider";
import type { PolymarketClobPublicClient } from "@cogni/poly-market-provider/adapters/polymarket";
import type { MarketResolutionInput } from "@cogni/poly-market-provider/analysis";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import pLimit from "p-limit";

type Db =
  | NodePgDatabase<Record<string, unknown>>
  | PostgresJsDatabase<Record<string, unknown>>;

const DEFAULT_BATCH_SIZE = 100;

// TODO(task.5014, PR #1245): replace inline dedupe with `dedupeByKey`
// from `./observation-helpers` once CP2 lands on main.
function dedupeByKey<T, K>(rows: readonly T[], keyFn: (row: T) => K): T[] {
  const map = new Map<K, T>();
  for (const row of rows) {
    map.set(keyFn(row), row);
  }
  return Array.from(map.values());
}

export interface MarketOutcomeTickDeps {
  db: Db;
  clobClient: Pick<PolymarketClobPublicClient, "getMarketResolution">;
  logger: LoggerPort;
  metrics: MetricsPort;
  /** Per-tick cap on upstream calls. Default 100. */
  batchSize?: number;
  /** When true, drop the 30-day fills filter for a one-time historical fill. */
  includeBackfill?: boolean;
}

export interface MarketOutcomeTickResult {
  conditions: number;
  polled: number;
  upserted: number;
  errors: number;
}

interface ConditionTokenRow {
  condition_id: string;
  token_id: string;
}

interface UpsertRow {
  conditionId: string;
  tokenId: string;
  outcome: "winner" | "loser" | "unknown";
  payout: string | null;
  resolvedAt: Date | null;
  raw: Record<string, unknown>;
}

export async function runMarketOutcomeTick(
  deps: MarketOutcomeTickDeps
): Promise<MarketOutcomeTickResult> {
  const log = deps.logger.child({ component: "trader-market-outcome" });
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const includeBackfill = deps.includeBackfill ?? false;

  const fillsFilter = includeBackfill
    ? sql``
    : sql`WHERE observed_at > now() - INTERVAL '30 days'`;
  // In backfill mode, the drain criterion is "every active condition has been
  // resolved at least once" — so we filter to never-resolved rows only. This
  // is reachable: once every active condition has an outcome row, the query
  // returns 0 candidates and the job flips backfillPending → false. In normal
  // mode we also refresh active markets older than 5 min so resolution status
  // stays fresh post-drain.
  const stalenessFilter = includeBackfill
    ? sql`m.updated_at IS NULL`
    : sql`m.updated_at IS NULL OR m.updated_at < now() - INTERVAL '5 minutes'`;

  const candidates = (await deps.db.execute(sql`
    WITH active_conditions AS (
      SELECT DISTINCT condition_id, token_id
      FROM poly_trader_current_positions
      WHERE active = true
      UNION
      SELECT DISTINCT condition_id, token_id
      FROM poly_trader_fills
      ${fillsFilter}
    )
    SELECT a.condition_id, a.token_id
    FROM active_conditions a
    LEFT JOIN poly_market_outcomes m
      ON m.condition_id = a.condition_id
     AND m.token_id = a.token_id
    WHERE ${stalenessFilter}
    -- Oldest stale (or never-resolved) rows first so the historical
    -- backfill drains progressively across ticks. Previously
    -- ORDER BY condition_id meant the tick re-processed the same
    -- alphabetically-first 100 every cycle, capping resolution at
    -- one batch per pod restart regardless of how long the job ran.
    ORDER BY m.updated_at ASC NULLS FIRST, a.condition_id, a.token_id
    LIMIT ${batchSize}
  `)) as unknown as ConditionTokenRow[];

  const totalConditions = candidates.length;

  if (totalConditions === 0) {
    log.info(
      {
        event: "poly.market-outcome.tick_ok",
        phase: "ok",
        conditions: 0,
        polled: 0,
        upserted: 0,
        errors: 0,
        backfill: includeBackfill,
      },
      "market outcome tick — no stale conditions"
    );
    return { conditions: 0, polled: 0, upserted: 0, errors: 0 };
  }

  const upstreamLimit = pLimit(4);
  let polled = 0;
  let errors = 0;
  const distinctConditions = Array.from(
    new Set(candidates.map((row) => row.condition_id))
  );

  const resolutionsByCondition = new Map<
    string,
    MarketResolutionInput | null
  >();

  await Promise.all(
    distinctConditions.map((conditionId) =>
      upstreamLimit(async () => {
        const startedAt = Date.now();
        let statusCode: "ok" | "null" | "error" = "ok";
        let resolution: MarketResolutionInput | null = null;
        try {
          resolution = await deps.clobClient.getMarketResolution(conditionId);
          statusCode = resolution === null ? "null" : "ok";
          polled += 1;
        } catch (err: unknown) {
          statusCode = "error";
          errors += 1;
          log.error(
            {
              event: "poly.market-outcome.outbound",
              phase: "error",
              conditionId,
              status_code: "error",
              latency_ms: Date.now() - startedAt,
              err: err instanceof Error ? err.message : String(err),
            },
            "market outcome upstream call failed"
          );
        }
        resolutionsByCondition.set(conditionId, resolution);
        if (statusCode !== "error") {
          log.info(
            {
              event: "poly.market-outcome.outbound",
              phase: "ok",
              conditionId,
              status_code: statusCode,
              latency_ms: Date.now() - startedAt,
            },
            "market outcome upstream call"
          );
        }
      })
    )
  );

  const upsertRows = candidates.flatMap((row): UpsertRow[] => {
    const resolution = resolutionsByCondition.get(row.condition_id);
    if (!resolution) return [];
    const tokenEntry = resolution.tokens.find(
      (t) => t.token_id === row.token_id
    );
    if (!tokenEntry) return [];
    const outcome: UpsertRow["outcome"] = !resolution.closed
      ? "unknown"
      : tokenEntry.winner
        ? "winner"
        : "loser";
    return [
      {
        conditionId: row.condition_id,
        tokenId: row.token_id,
        outcome,
        payout: null,
        resolvedAt: null,
        raw: resolution as unknown as Record<string, unknown>,
      },
    ];
  });

  const deduped = dedupeByKey(
    upsertRows,
    (r) => `${r.conditionId}:${r.tokenId}`
  );

  let upserted = 0;
  if (deduped.length > 0) {
    await deps.db
      .insert(polyMarketOutcomes)
      .values(
        deduped.map((row) => ({
          conditionId: row.conditionId,
          tokenId: row.tokenId,
          outcome: row.outcome,
          payout: row.payout,
          resolvedAt: row.resolvedAt,
          raw: row.raw,
        }))
      )
      .onConflictDoUpdate({
        target: [polyMarketOutcomes.conditionId, polyMarketOutcomes.tokenId],
        set: {
          outcome: sql`EXCLUDED.outcome`,
          payout: sql`EXCLUDED.payout`,
          resolvedAt: sql`EXCLUDED.resolved_at`,
          raw: sql`EXCLUDED.raw`,
          updatedAt: sql`now()`,
        },
      });
    upserted = deduped.length;
  }

  log.info(
    {
      event: "poly.market-outcome.tick_ok",
      phase: "ok",
      conditions: totalConditions,
      polled,
      upserted,
      errors,
      backfill: includeBackfill,
    },
    "market outcome tick complete"
  );

  return { conditions: totalConditions, polled, upserted, errors };
}
