// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/price-history-service`
 * Purpose: Mirror Polymarket CLOB `/prices-history` into a per-asset DB read
 *          model so `getExecutionSlice` per-position timeline charts read from
 *          our DB, not from a synchronous CLOB call on page-load.
 * Scope: Tick writer + retention + DB reader. Reader is page-load safe (no
 *        outbound HTTP); writer runs in the price-history bootstrap job only.
 * Invariants:
 *   - PAGE_LOAD_DB_ONLY (task.5018): `readPriceHistoryFromDb` performs no outbound HTTP.
 *   - PRICE_HISTORY_TIMESERIES_KEYED: PK `(asset, fidelity, ts)`. Two fidelities: `1h` covers windows ≤ ~1 month, `1d` covers everything beyond.
 *   - WRITER_TARGETS_OPEN_AND_RECENT_CLOSED: enumerate distinct assets from `poly_trader_current_positions WHERE active=true` UNION `poly_trader_fills` observed in last 7 days.
 *   - WRITERS_RESPECT_CLOB_RATE_LIMITS: per-asset upstream calls go through `pLimit(4)` per spike.5001's measured 24 rps ceiling.
 *   - DEDUPE_BY_TS: PK collision-safe — duplicate `(asset, fidelity, ts)` rows from a single payload are deduped last-wins before upsert.
 *   - RETENTION_BOUNDED: `1h` rows older than 35 days are pruned by the same job; `1d` kept indefinitely.
 *   - EMPTY_IS_HONEST: zero stored rows for a freshly-opened position returns `[]` — `mapExecutionPositions` handles missing history.
 * Side-effects:
 *   - Writer: IO (CLOB `/prices-history`) + DB upsert.
 *   - Reader: DB read.
 * Links: nodes/poly/packages/db-schema/src/trader-activity.ts, work/items/task.5018, work/items/task.5012
 * @public
 */

import {
  polyMarketPriceHistory,
  polyTraderCurrentPositions,
  polyTraderFills,
} from "@cogni/poly-db-schema/trader-activity";
import type { LoggerPort, MetricsPort } from "@cogni/poly-market-provider";
import {
  type ClobPriceHistoryPoint,
  PolymarketClobPublicClient,
  type PriceHistoryOutboundLogger,
} from "@cogni/poly-market-provider/adapters/polymarket";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import pLimit from "p-limit";

type Db =
  | NodePgDatabase<Record<string, unknown>>
  | PostgresJsDatabase<Record<string, unknown>>;

export type PriceHistoryFidelity = "1h" | "1d";
const HOUR_FIDELITY: PriceHistoryFidelity = "1h";
const DAY_FIDELITY: PriceHistoryFidelity = "1d";

/** `1h` rows older than this are pruned by the writer's tick. */
const HOUR_FIDELITY_RETENTION_DAYS = 35;

/** Distinct-asset enumeration uses fills observed in this window. */
const RECENT_FILLS_WINDOW_DAYS = 7;

/** Per-process upstream concurrency cap — design invariant `pLimit(4)` (spike.5001). */
const DEFAULT_CONCURRENCY = 4;

let clobPublicClient: PolymarketClobPublicClient | undefined;
function getClobPublicClient(): PolymarketClobPublicClient {
  if (!clobPublicClient) clobPublicClient = new PolymarketClobPublicClient();
  return clobPublicClient;
}

export function __setPriceHistoryClobClientForTests(
  client: PolymarketClobPublicClient | undefined
): void {
  clobPublicClient = client;
}

export interface PriceHistoryTickDeps {
  db: Db;
  clobClient?: PolymarketClobPublicClient;
  logger: LoggerPort;
  metrics: MetricsPort;
  concurrency?: number;
}

export interface PriceHistoryTickResult {
  assets: number;
  upserted: number;
  prunedHourPoints: number;
  errors: number;
}

/**
 * Writer tick — sibling of `runMarketOutcomeTick` and `runTraderObservationTick`.
 * Polls each asset at two fidelities (`1h@interval=1m` and `1d@interval=max`),
 * dedupes, upserts, then prunes stale `1h` rows.
 */
export async function runPriceHistoryTick(
  deps: PriceHistoryTickDeps
): Promise<PriceHistoryTickResult> {
  const log = deps.logger.child({
    component: "trader-price-history",
  });
  const client = deps.clobClient ?? getClobPublicClient();
  const limit = pLimit(deps.concurrency ?? DEFAULT_CONCURRENCY);
  const outboundLogger: PriceHistoryOutboundLogger = {
    info: (payload: {
      event: "poly.market-price-history.outbound";
      component: string;
      asset: string;
      interval?: string;
      fidelity?: number;
    }) => log.info(payload, "price-history outbound"),
  };

  const assets = await listAssetsToPoll(deps.db);
  const upsertedPerCall: number[] = [];
  let errors = 0;

  await Promise.all(
    assets.map((asset) =>
      limit(async () => {
        try {
          const hourPoints = await client.getPriceHistory(
            asset,
            { fidelity: 60, interval: "1m" },
            { logger: outboundLogger, component: "trader-price-history" }
          );
          upsertedPerCall.push(
            await upsertPriceHistory(deps.db, asset, HOUR_FIDELITY, hourPoints)
          );
        } catch (err: unknown) {
          errors += 1;
          log.error(
            {
              event: "poly.market-price-history.error",
              phase: "fetch_hour_error",
              asset,
              err: err instanceof Error ? err.message : String(err),
            },
            "price-history hour fetch failed"
          );
        }
        try {
          const dayPoints = await client.getPriceHistory(
            asset,
            { fidelity: 1440, interval: "max" },
            { logger: outboundLogger, component: "trader-price-history" }
          );
          upsertedPerCall.push(
            await upsertPriceHistory(deps.db, asset, DAY_FIDELITY, dayPoints)
          );
        } catch (err: unknown) {
          errors += 1;
          log.error(
            {
              event: "poly.market-price-history.error",
              phase: "fetch_day_error",
              asset,
              err: err instanceof Error ? err.message : String(err),
            },
            "price-history day fetch failed"
          );
        }
      })
    )
  );
  const upserted = upsertedPerCall.reduce((sum, n) => sum + n, 0);

  let prunedHourPoints = 0;
  try {
    const prune = await pruneOldPriceHistory(deps.db);
    prunedHourPoints = prune.deleted;
  } catch (err: unknown) {
    log.warn(
      {
        event: "poly.market-price-history.error",
        phase: "prune_error",
        err: err instanceof Error ? err.message : String(err),
      },
      "price-history prune failed"
    );
  }

  log.info(
    {
      event: "poly.market-price-history.tick_ok",
      assets: assets.length,
      polled: assets.length * 2,
      upserted,
      errors,
      pruned_hour_points: prunedHourPoints,
    },
    "price-history tick complete"
  );

  return {
    assets: assets.length,
    upserted,
    prunedHourPoints,
    errors,
  };
}

/**
 * Distinct asset enumeration: every asset (token_id) currently held active
 * by an observed wallet, plus every asset traded in the last 7 days. Bounded
 * set; one mirror per asset.
 */
async function listAssetsToPoll(db: Db): Promise<string[]> {
  const cutoff = new Date(Date.now() - RECENT_FILLS_WINDOW_DAYS * 86_400_000);
  const activeRows = await db
    .selectDistinct({ asset: polyTraderCurrentPositions.tokenId })
    .from(polyTraderCurrentPositions)
    .where(eq(polyTraderCurrentPositions.active, true));
  const recentRows = await db
    .selectDistinct({ asset: polyTraderFills.tokenId })
    .from(polyTraderFills)
    .where(gte(polyTraderFills.observedAt, cutoff));
  const assets = new Set<string>();
  for (const row of activeRows) {
    if (row.asset) assets.add(row.asset);
  }
  for (const row of recentRows) {
    if (row.asset) assets.add(row.asset);
  }
  return [...assets];
}

/**
 * Dedupe by `t` (last-wins) before INSERT … ON CONFLICT. Polymarket may return
 * the current bucket twice in a single payload; PG ON CONFLICT DO UPDATE
 * rejects a batch that hits the same conflict target twice ("command cannot
 * affect row a second time"). Mirrors the bug.5011 fix in CP1's user-pnl writer
 * (CP2 will extract this into `dedupeByKey`; inlined here until that lands).
 */
async function upsertPriceHistory(
  db: Db,
  asset: string,
  fidelity: PriceHistoryFidelity,
  points: readonly ClobPriceHistoryPoint[]
): Promise<number> {
  if (points.length === 0) return 0;
  const dedupedByT = new Map<number, ClobPriceHistoryPoint>();
  for (const point of points) {
    if (!Number.isFinite(point.t) || !Number.isFinite(point.p)) continue;
    if (point.p < 0) continue;
    dedupedByT.set(point.t, point);
  }
  if (dedupedByT.size === 0) return 0;
  const rows = Array.from(dedupedByT.values()).map((point) => ({
    asset,
    fidelity,
    ts: new Date(point.t * 1_000),
    price: point.p.toFixed(8),
  }));
  await db
    .insert(polyMarketPriceHistory)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        polyMarketPriceHistory.asset,
        polyMarketPriceHistory.fidelity,
        polyMarketPriceHistory.ts,
      ],
      set: {
        price: sql`excluded.price`,
        observedAt: sql`now()`,
      },
    });
  return rows.length;
}

/** Retention helper: prune `1h` rows older than 35 days. `1d` kept indefinitely. */
export async function pruneOldPriceHistory(
  db: Db
): Promise<{ deleted: number }> {
  const cutoff = new Date(
    Date.now() - HOUR_FIDELITY_RETENTION_DAYS * 86_400_000
  );
  const result = await db
    .delete(polyMarketPriceHistory)
    .where(
      and(
        eq(polyMarketPriceHistory.fidelity, HOUR_FIDELITY),
        sql`${polyMarketPriceHistory.ts} < ${cutoff}`
      )
    );
  const rowCount =
    (result as unknown as { rowCount?: number; count?: number }).rowCount ??
    (result as unknown as { rowCount?: number; count?: number }).count ??
    0;
  return { deleted: rowCount };
}

/**
 * DB read for the price-history reader swap. Returns rows sorted by `ts` for
 * the requested `(asset, fidelity)` over `[startTs, endTs]` (Unix seconds, inclusive).
 * Empty array when no rows are stored — caller treats this as "cold start gap"
 * and `mapExecutionPositions` renders a flat/empty timeline.
 */
export async function readPriceHistoryFromDb(
  db: Db,
  asset: string,
  startTs: number,
  endTs: number,
  fidelity: PriceHistoryFidelity
): Promise<ClobPriceHistoryPoint[]> {
  const startMs = Math.max(0, Math.floor(startTs * 1_000));
  const endMs = Math.max(startMs, Math.floor(endTs * 1_000));
  const rows = await db
    .select({
      ts: polyMarketPriceHistory.ts,
      price: polyMarketPriceHistory.price,
    })
    .from(polyMarketPriceHistory)
    .where(
      and(
        eq(polyMarketPriceHistory.asset, asset),
        eq(polyMarketPriceHistory.fidelity, fidelity),
        gte(polyMarketPriceHistory.ts, new Date(startMs)),
        lte(polyMarketPriceHistory.ts, new Date(endMs))
      )
    )
    .orderBy(asc(polyMarketPriceHistory.ts));
  return rows.map((row) => ({
    t: Math.floor(row.ts.getTime() / 1_000),
    p: Number(row.price),
  }));
}

/**
 * Map an execution-slice window to the densest stored fidelity that covers
 * it — `1h` for windows up to ~1 month, `1d` for longer. Mirrors the simplified
 * heuristic from `pickPriceHistoryFidelity` (drops the 5m / 6h / 1y middle tiers
 * since we only store two fidelities).
 */
export function pickStoredPriceHistoryFidelity(
  startTs: number,
  endTs: number
): PriceHistoryFidelity {
  const spanDays = Math.max(1, (endTs - startTs) / 86_400);
  return spanDays > 30 ? DAY_FIDELITY : HOUR_FIDELITY;
}
