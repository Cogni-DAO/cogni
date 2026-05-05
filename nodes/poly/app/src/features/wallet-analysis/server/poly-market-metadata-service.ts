// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/poly-market-metadata-service`
 * Purpose: Refresh `poly_market_metadata` rows from Polymarket Gamma's
 *   `/markets?condition_ids=...` endpoint. Owns the only writes to the
 *   `poly_market_metadata` table; readers JOIN on `condition_id`.
 * Scope: Pure server service. Caller owns DB + HTTP client; this module
 *   batches, parses, and upserts.
 * Invariants:
 *   - SINGLE_SOURCE_OF_TRUTH: every Gamma response we successfully parse
 *     becomes one upsert into `poly_market_metadata`. No JSONB-scrape
 *     fallback writes; readers handle the empty-row case via COALESCE.
 *   - BATCH_BOUND: per-call request size capped at `BATCH_SIZE` so we stay
 *     under Polymarket's URL-length and per-request limits regardless of
 *     how large the input set grows.
 *   - PARTIAL_FAILURE_SOFT: a failed batch logs + continues to the next
 *     batch — one bad chunk never poisons the whole sweep. The result
 *     reports counts so callers can metric on `fetched / requested`.
 *   - PERSIST_WHAT_WE_FETCH: every Gamma call writes its outcome. We never
 *     hold the full response only in memory — that violates the "if we
 *     touch Polymarket, persist it" rule from the dev-direction memo.
 * Side-effects: HTTP fetch (Gamma), DB write (`poly_market_metadata`).
 * Links: nodes/poly/packages/db-schema/src/trader-activity.ts (table),
 *        nodes/poly/packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts (client).
 * @internal
 */

import { polyMarketMetadata } from "@cogni/poly-db-schema/trader-activity";
import type {
  GammaMarket,
  PolymarketDataApiClient,
} from "@cogni/poly-market-provider/adapters/polymarket";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

type Db =
  | NodePgDatabase<Record<string, unknown>>
  | PostgresJsDatabase<Record<string, unknown>>;

type LoggerPort = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

/** Polymarket Gamma comfortably handles ~100 condition_ids per request. */
const DEFAULT_BATCH_SIZE = 100;

export type RefreshMarketMetadataResult = {
  /** condition_ids the caller asked us to refresh. */
  requested: number;
  /** Markets returned by Gamma (may be < requested if Polymarket has none). */
  fetched: number;
  /** Rows upserted into `poly_market_metadata`. */
  written: number;
  /** Batches that failed mid-sweep (logged but did not abort the run). */
  failedBatches: number;
};

/**
 * Refresh `poly_market_metadata` for a list of condition_ids. Fetches in
 * batches from Gamma `/markets?condition_ids=...`, upserts what comes back,
 * and returns count metrics. Idempotent: rerunning with the same input is
 * a no-op modulo the `fetched_at` timestamp.
 */
export async function refreshMarketMetadata(deps: {
  db: Db;
  client: PolymarketDataApiClient;
  conditionIds: readonly string[];
  logger: LoggerPort;
  batchSize?: number;
}): Promise<RefreshMarketMetadataResult> {
  const dedup = [...new Set(deps.conditionIds.filter((id) => id.length > 0))];
  if (dedup.length === 0) {
    return { requested: 0, fetched: 0, written: 0, failedBatches: 0 };
  }
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const fetchedAt = new Date();
  let fetched = 0;
  let written = 0;
  let failedBatches = 0;

  for (let i = 0; i < dedup.length; i += batchSize) {
    const batch = dedup.slice(i, i + batchSize);
    let markets: GammaMarket[];
    try {
      markets = await deps.client.getMarketsByConditionIds(batch);
    } catch (err: unknown) {
      failedBatches += 1;
      deps.logger.warn(
        {
          event: "poly.market_metadata.refresh",
          phase: "batch_fetch_error",
          batch_size: batch.length,
          err: err instanceof Error ? err.message : String(err),
        },
        "gamma metadata fetch failed for batch"
      );
      continue;
    }
    fetched += markets.length;
    const rows = gammaMarketsToMetadataRows(markets, fetchedAt);
    if (rows.length === 0) continue;
    // Dedupe by conditionId before the bulk upsert. Postgres rejects
    // `INSERT ... ON CONFLICT` if the VALUES list touches the conflict
    // target row twice in one statement ("cannot affect row a second
    // time"). Gamma occasionally returns the same conditionId across
    // multi-event markets; keeping the last occurrence matches the
    // upsert semantics if it had been processed serially.
    const dedupedRows = dedupeRowsByConditionId(rows);
    try {
      await deps.db
        .insert(polyMarketMetadata)
        .values(dedupedRows)
        .onConflictDoUpdate({
          target: polyMarketMetadata.conditionId,
          set: {
            marketTitle: sql`excluded.market_title`,
            marketSlug: sql`excluded.market_slug`,
            eventTitle: sql`excluded.event_title`,
            eventSlug: sql`excluded.event_slug`,
            endDate: sql`excluded.end_date`,
            raw: sql`excluded.raw`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
      written += dedupedRows.length;
    } catch (err: unknown) {
      // PARTIAL_FAILURE_SOFT — a write failure for one batch must not
      // poison subsequent batches. Increment counter, log, continue.
      failedBatches += 1;
      deps.logger.warn(
        {
          event: "poly.market_metadata.refresh",
          phase: "batch_write_error",
          batch_size: dedupedRows.length,
          err: err instanceof Error ? err.message : String(err),
        },
        "gamma metadata upsert failed for batch"
      );
    }
  }
  deps.logger.info(
    {
      event: "poly.market_metadata.refresh",
      phase: "tick_ok",
      requested: dedup.length,
      fetched,
      written,
      failed_batches: failedBatches,
      batch_size: batchSize,
    },
    "market metadata refresh complete"
  );
  return {
    requested: dedup.length,
    fetched,
    written,
    failedBatches,
  };
}

function parseEndDate(value: string | null): Date | null {
  if (value === null) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * Last-write-wins dedup of metadata rows by `conditionId`. See call site for
 * the Postgres "ON CONFLICT cannot affect row a second time" rationale.
 * Exported for unit-testing.
 */
export function dedupeRowsByConditionId<T extends { conditionId: string }>(
  rows: readonly T[]
): T[] {
  const byCondition = new Map<string, T>();
  for (const row of rows) byCondition.set(row.conditionId, row);
  return [...byCondition.values()];
}

/**
 * Map a list of Gamma `GammaMarket` records into upsert-ready
 * `poly_market_metadata` rows. Drops markets with missing / empty
 * `conditionId` (Gamma occasionally returns these for malformed routes).
 * Exported for unit-testing the parse/null-handling without mocking the DB.
 */
export function gammaMarketsToMetadataRows(
  markets: readonly GammaMarket[],
  fetchedAt: Date
): Array<{
  conditionId: string;
  marketTitle: string | null;
  marketSlug: string | null;
  eventTitle: string | null;
  eventSlug: string | null;
  endDate: Date | null;
  raw: Record<string, unknown>;
  fetchedAt: Date;
}> {
  return markets
    .filter(
      (m): m is GammaMarket & { conditionId: string } =>
        typeof m.conditionId === "string" && m.conditionId.length > 0
    )
    .map((m) => ({
      conditionId: m.conditionId,
      marketTitle: m.question ?? null,
      marketSlug: m.slug ?? null,
      eventTitle: m.events?.[0]?.title ?? null,
      eventSlug: m.events?.[0]?.slug ?? null,
      endDate: parseEndDate(m.endDate ?? null),
      raw: m as unknown as Record<string, unknown>,
      fetchedAt,
    }));
}
