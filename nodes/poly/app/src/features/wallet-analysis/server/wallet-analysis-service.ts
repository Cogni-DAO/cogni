// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/wallet-analysis-service`
 * Purpose: Service layer feeding `/api/v1/poly/wallets/[addr]` (snapshot, trades, balance, pnl slices) and `/api/v1/poly/wallet/execution` (live/closed position split). The `pnl`, `trades`, `balance`, and `execution` (positions+trades) slices are DB-only reads (PAGE_LOAD_DB_ONLY — task.5012 CP1/CP2/CP5). Snapshot and distributions(live) still hit Data API + CLOB; CP4 moves those to DB. CLOB `getPriceHistory` per open position remains live (`PAGE_LOAD_DB_ONLY_EXCEPT_PRICE_HISTORY`, closed by CP7).
 * Scope: Compute + I/O only. Does not authenticate, does not parse HTTP. Returns Zod-validated slice values per the wallet-analysis v1 and execution v1 contracts.
 * Invariants:
 *   - REUSE_PACKAGE_CLIENTS: all upstream HTTP goes through `@cogni/poly-market-provider` clients — no fetch in this file.
 *   - DETERMINISTIC_METRICS: snapshot math is identical to `computeWalletMetrics` (spike.0323 v3) for the trade-derived fields it surfaces (winrate, duration, activity counts). PnL-class outputs (`realizedPnlUsdc` etc.) of `computeWalletMetrics` are deliberately not surfaced; PnL is sourced from the `pnl` slice (task.0389).
 *   - PNL_NOT_IN_SNAPSHOT: `getSnapshotSlice` does not return any PnL field. Headline PnL on the wallet research surface is derived from `getPnlSlice` (DB-backed `poly_trader_user_pnl_points`, written by the trader-observation tick) — single source, reconciles with the chart by construction.
 *   - PAGE_LOAD_DB_ONLY (task.5012): every slice except `getExecutionSlice`'s CLOB price-history call is DB-only. `getPnlSlice` reads `poly_trader_user_pnl_points`; `getTradesSlice` + `getSnapshotSlice` + `getDistributionsSlice` read `poly_trader_fills` + `poly_market_outcomes`; `getBalanceSlice` + `getExecutionSlice` read `poly_trader_current_positions` + `poly_trader_fills`. Conditions absent from `poly_market_outcomes` are treated as unresolved (open positions).
 *   - PAGE_LOAD_DB_ONLY_EXCEPT_PRICE_HISTORY (task.5012 CP5): `getExecutionSlice` still calls CLOB `getPriceHistory` per open position — bounded v0 carve-out, removed by CP7's `poly_market_price_history` mirror.
 *   - PARTIAL_FAILURE_NEVER_THROWS: each slice returns a `{ value | warning }` result; the route surfaces warnings without 5xx-ing.
 *   - CLOB_HISTORY_OPEN_ONLY: `getPriceHistory` is fetched only for open/redeemable positions; closed positions use trade-derived timelines only.
 * Side-effects: IO (Polymarket Data API + Polymarket CLOB public + DB read for trader mirrors).
 * Notes: Cache is process-scoped — see `instrumentation.ts` single-replica boot assert.
 * Links: docs/design/wallet-analysis-components.md, nodes/poly/packages/market-provider/src/analysis/wallet-metrics.ts, nodes/poly/packages/node-contracts/src/poly.wallet-analysis.v1.contract.ts, nodes/poly/packages/node-contracts/src/poly.wallet.execution.v1.contract.ts, work/items/task.5012, work/items/task.5015
 * @public
 */

import {
  polyMarketOutcomes,
  polyTraderCurrentPositions,
  polyTraderFills,
  polyTraderWallets,
} from "@cogni/poly-db-schema/trader-activity";
import {
  PolymarketClobPublicClient,
  type PolymarketUserPosition,
  type PolymarketUserTrade,
} from "@cogni/poly-market-provider/adapters/polymarket";
import {
  computeWalletMetrics,
  type MarketResolutionInput,
  mapExecutionPositions,
  type OrderFlowTrade,
  summariseOrderFlow,
} from "@cogni/poly-market-provider/analysis";
import type {
  PolyWalletExecutionOutput,
  PolyWalletOverviewInterval,
  WalletAnalysisBalance,
  WalletAnalysisDistributions,
  WalletAnalysisPnl,
  WalletAnalysisSnapshot,
  WalletAnalysisTrades,
  WalletAnalysisWarning,
  WalletExecutionDailyCount,
  WalletExecutionPosition,
  WalletExecutionWarning,
} from "@cogni/poly-node-contracts";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import pLimit from "p-limit";
import { clearTtlCacheByPrefix, coalesce } from "./coalesce";
import { getTradingWalletPnlHistory } from "./trading-wallet-overview-service";

/** Cache TTL for every slice. Matches design doc 30 s. */
const SLICE_TTL_MS = 30_000;

/** Per-process upstream concurrency cap — design invariant `p-limit(4)`. */
const upstreamLimit = pLimit(4);

/** Trades fetched per analysis request (`computeWalletMetrics` accepts up to ~500 per the Data API cap). */
const TRADE_FETCH_LIMIT = 500;
/** Max open/redeemable rows returned in live_positions. */
const EXECUTION_OPEN_LIMIT = 18;
/** Max closed rows returned in closed_positions. */
const EXECUTION_HISTORY_LIMIT = 30;
const EXECUTION_HISTORY_WINDOW_DAYS = 14;
type Db =
  | NodePgDatabase<Record<string, unknown>>
  | PostgresJsDatabase<Record<string, unknown>>;

type HistoricalFillRow = {
  conditionId: string;
  tokenId: string;
  side: string;
  price: string | number;
  shares: string | number;
  observedAt: Date;
  raw: Record<string, unknown> | null;
};

/**
 * Module-singleton CLOB public client — created lazily so test code can swap
 * it via `__setClientsForTests` before first use. Public-only access; no
 * auth/credentials involved. Used only by `getExecutionSlice`'s price-history
 * call (PAGE_LOAD_DB_ONLY_EXCEPT_PRICE_HISTORY carve-out, closed by CP7).
 */
let clobPublicClient: PolymarketClobPublicClient | undefined;

function getClobPublicClient(): PolymarketClobPublicClient {
  if (!clobPublicClient) clobPublicClient = new PolymarketClobPublicClient();
  return clobPublicClient;
}

/** Test-only: replace the module-singleton CLOB client with a stub. */
export function __setClientsForTests(opts: {
  clobPublic?: PolymarketClobPublicClient;
}): void {
  clobPublicClient = opts.clobPublic ?? clobPublicClient;
}

export type SliceResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "warn"; warning: WalletAnalysisWarning };

/**
 * Evict wallet-scoped slices after a close/redeem write so the next dashboard
 * refetch does not reuse stale process cache entries.
 */
export function invalidateWalletAnalysisCaches(addr: string): void {
  const addressVariants = new Set([addr, addr.toLowerCase()]);
  for (const address of addressVariants) {
    clearTtlCacheByPrefix(`positions:${address}`);
    clearTtlCacheByPrefix(`db-positions:${address}`);
    clearTtlCacheByPrefix(`db-balance:${address}`);
    clearTtlCacheByPrefix(`db-execution-trades:${address}`);
    clearTtlCacheByPrefix(`trades:${address}`);
    clearTtlCacheByPrefix(`execution-trades:${address}`);
    clearTtlCacheByPrefix(`pnl:${address}:`);
  }
}

/**
 * DB-backed trades slice — reads `poly_trader_fills` (populated by the
 * trader-observation tick). PAGE_LOAD_DB_ONLY (task.5012 CP2).
 *
 * Market title is recovered from the per-row `raw` jsonb that the writer
 * preserves at ingest. When `raw.attributes.title` is absent or empty the
 * recent-trade row falls back to `null` (chart already handles this).
 */
export async function getTradesSlice(
  db: Db,
  addr: string
): Promise<SliceResult<WalletAnalysisTrades>> {
  try {
    const rows = await db
      .select({
        observedAt: polyTraderFills.observedAt,
        side: polyTraderFills.side,
        conditionId: polyTraderFills.conditionId,
        tokenId: polyTraderFills.tokenId,
        shares: polyTraderFills.shares,
        price: polyTraderFills.price,
        raw: polyTraderFills.raw,
      })
      .from(polyTraderFills)
      .innerJoin(
        polyTraderWallets,
        eq(polyTraderFills.traderWalletId, polyTraderWallets.id)
      )
      .where(eq(polyTraderWallets.walletAddress, addr.toLowerCase()))
      .orderBy(desc(polyTraderFills.observedAt))
      .limit(TRADE_FETCH_LIMIT);

    const trades = rows.map((row) => ({
      timestamp: Math.floor(row.observedAt.getTime() / 1_000),
      side: row.side as "BUY" | "SELL",
      conditionId: row.conditionId,
      asset: row.tokenId,
      size: Number(row.shares),
      price: Number(row.price),
      title: extractTitle(row.raw),
    }));

    const dailyCounts = buildDailyCounts(trades, 14);
    const topMarkets = buildTopMarkets(trades, 4);
    const recent = trades.slice(0, 50).map((t) => ({
      timestampSec: t.timestamp,
      side: t.side,
      conditionId: t.conditionId,
      asset: t.asset,
      size: t.size,
      price: t.price,
      marketTitle: t.title || null,
    }));
    return {
      kind: "ok",
      value: {
        recent,
        dailyCounts,
        topMarkets,
        computedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return {
      kind: "warn",
      warning: warning("trades", err),
    };
  }
}

function extractTitle(raw: Record<string, unknown> | null): string {
  if (!raw) return "";
  const attrs = (raw as { attributes?: Record<string, unknown> }).attributes;
  if (!attrs) return "";
  const title = attrs.title;
  return typeof title === "string" ? title : "";
}

/**
 * Compute the snapshot (deterministic metrics) slice. PAGE_LOAD_DB_ONLY (task.5012 CP4):
 * trades come from `poly_trader_fills`, resolutions come from `poly_market_outcomes`.
 * Conditions missing from the outcomes table are treated as unresolved by
 * `computeWalletMetrics` (they remain in `openPositions`).
 */
export async function getSnapshotSlice(
  db: Db,
  addr: string
): Promise<SliceResult<WalletAnalysisSnapshot>> {
  try {
    const trades = await readDbFillsAsOrderFlowTrades(db, addr);
    const cids = [...new Set(trades.map((t) => t.conditionId))];
    const resolutions = await readResolutionsForConditions(db, cids);

    const m = computeWalletMetrics(trades, resolutions);
    return {
      kind: "ok",
      value: {
        resolvedPositions: m.resolvedPositions,
        wins: m.wins,
        losses: m.losses,
        trueWinRatePct: m.trueWinRatePct,
        medianDurationHours: m.medianDurationHours,
        openPositions: m.openPositions,
        openNetCostUsdc: m.openNetCostUsdc,
        uniqueMarkets: m.uniqueMarkets,
        tradesPerDay30d: m.tradesPerDay30d,
        daysSinceLastTrade: Number.isFinite(m.daysSinceLastTrade)
          ? m.daysSinceLastTrade
          : 0,
        topMarkets: [...m.topMarkets],
        dailyCounts: m.dailyCounts.map((d) => ({ day: d.day, n: d.n })),
        computedAt: new Date().toISOString(),
        // task.0333 swaps this for a Dolt read; null is a fine v0 default.
        hypothesisMd: null,
      },
    };
  } catch (err) {
    return {
      kind: "warn",
      warning: warning("snapshot", err),
    };
  }
}

/**
 * Distributions slice — order-flow histograms (DCA depth, trade size, entry
 * price, DCA window, hour-of-day, event clustering) with won/lost/pending
 * outcome split. PAGE_LOAD_DB_ONLY (task.5012 CP4): trades from
 * `poly_trader_fills`, resolutions from `poly_market_outcomes`. The legacy
 * `live` mode is collapsed into `historical` — both modes now read DB only;
 * `mode` is preserved on the response for contract continuity.
 */
export async function getDistributionsSlice(
  db: Db,
  addr: string,
  mode: "live" | "historical"
): Promise<SliceResult<WalletAnalysisDistributions>> {
  try {
    const trades = await readDbFillsAsOrderFlowTrades(db, addr);
    const cids = [...new Set(trades.map((t) => t.conditionId))];
    const resolutions = await readResolutionsForConditions(db, cids);

    const summary = summariseOrderFlow(trades, resolutions);
    return {
      kind: "ok",
      value: {
        mode,
        range: summary.range,
        dcaDepth: { buckets: [...summary.dcaDepth.buckets] },
        tradeSize: { buckets: [...summary.tradeSize.buckets] },
        entryPrice: { buckets: [...summary.entryPrice.buckets] },
        dcaWindow: { buckets: [...summary.dcaWindow.buckets] },
        hourOfDay: { buckets: [...summary.hourOfDay.buckets] },
        eventClustering: { buckets: [...summary.eventClustering.buckets] },
        topEvents: [...summary.topEvents],
        pendingShare: summary.pendingShare,
        quantiles: summary.quantiles,
        computedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return {
      kind: "warn",
      warning: warning("distributions", err),
    };
  }
}

/**
 * Read every observed fill for a wallet from `poly_trader_fills` and project
 * into the structural `OrderFlowTrade` shape (which extends `WalletTradeInput`,
 * so the same rows feed `computeWalletMetrics`). Returns `[]` when the wallet
 * has no rows (cold-start before observation tick).
 */
async function readDbFillsAsOrderFlowTrades(
  db: Db,
  addr: string
): Promise<OrderFlowTrade[]> {
  return coalesce(
    `historical-trader-fills:${addr}`,
    async () => {
      const rows = (await db
        .select({
          conditionId: polyTraderFills.conditionId,
          tokenId: polyTraderFills.tokenId,
          side: polyTraderFills.side,
          price: polyTraderFills.price,
          shares: polyTraderFills.shares,
          observedAt: polyTraderFills.observedAt,
          raw: polyTraderFills.raw,
        })
        .from(polyTraderFills)
        .innerJoin(
          polyTraderWallets,
          eq(polyTraderWallets.id, polyTraderFills.traderWalletId)
        )
        .where(eq(polyTraderWallets.walletAddress, addr.toLowerCase()))
        .orderBy(asc(polyTraderFills.observedAt))) as HistoricalFillRow[];
      return rows.map(historicalFillToOrderFlowTrade);
    },
    SLICE_TTL_MS
  );
}

/**
 * Read `poly_market_outcomes` rows for the given conditionIds and group into
 * the `MarketResolutionInput` shape `computeWalletMetrics` / `summariseOrderFlow`
 * expect. A condition is `closed=true` only when ALL its observed token rows
 * carry a non-`unknown` outcome. Conditions absent from the table do not appear
 * in the returned map — downstream math then treats them as open/unresolved.
 */
async function readResolutionsForConditions(
  db: Db,
  conditionIds: ReadonlyArray<string>
): Promise<Map<string, MarketResolutionInput>> {
  const out = new Map<string, MarketResolutionInput>();
  if (conditionIds.length === 0) return out;

  const rows = (await db
    .select({
      conditionId: polyMarketOutcomes.conditionId,
      tokenId: polyMarketOutcomes.tokenId,
      outcome: polyMarketOutcomes.outcome,
    })
    .from(polyMarketOutcomes)
    .where(
      inArray(polyMarketOutcomes.conditionId, [...conditionIds])
    )) as Array<{
    conditionId: string;
    tokenId: string;
    outcome: string;
  }>;

  const grouped = new Map<
    string,
    Array<{ token_id: string; winner: boolean; resolved: boolean }>
  >();
  for (const row of rows) {
    const list = grouped.get(row.conditionId) ?? [];
    list.push({
      token_id: row.tokenId,
      winner: row.outcome === "winner",
      resolved: row.outcome !== "unknown",
    });
    grouped.set(row.conditionId, list);
  }

  for (const [cid, tokens] of grouped) {
    const closed = tokens.length > 0 && tokens.every((t) => t.resolved);
    out.set(cid, {
      closed,
      tokens: tokens.map((t) => ({ token_id: t.token_id, winner: t.winner })),
    });
  }
  return out;
}

type DbFillRow = HistoricalFillRow;

async function readFillsFromDb(db: Db, addr: string): Promise<DbFillRow[]> {
  const rows = await db
    .select({
      conditionId: polyTraderFills.conditionId,
      tokenId: polyTraderFills.tokenId,
      side: polyTraderFills.side,
      price: polyTraderFills.price,
      shares: polyTraderFills.shares,
      observedAt: polyTraderFills.observedAt,
      raw: polyTraderFills.raw,
    })
    .from(polyTraderFills)
    .innerJoin(
      polyTraderWallets,
      eq(polyTraderWallets.id, polyTraderFills.traderWalletId)
    )
    .where(eq(polyTraderWallets.walletAddress, addr.toLowerCase()))
    .orderBy(asc(polyTraderFills.observedAt));
  return rows as DbFillRow[];
}

/**
 * Project a `poly_trader_current_positions` row into the
 * `PolymarketUserPosition` shape `mapExecutionPositions` expects. The fields
 * not stored on the DB row (eventId, oppositeAsset, …) are filled with the
 * permissive defaults from `PolymarketUserPositionSchema` so downstream
 * mapping is lossless for the dashboard slice.
 */
function dbPositionToUserPosition(
  row: DbCurrentPositionRow
): PolymarketUserPosition {
  const raw = isRecord(row.raw) ? row.raw : {};
  const shares = toFiniteNumber(row.shares);
  const costBasis = toFiniteNumber(row.costBasisUsdc);
  const currentValue = toFiniteNumber(row.currentValueUsdc);
  const avgPrice = toFiniteNumber(row.avgPrice);
  const rawCurPrice = readOptionalNumber(raw, "curPrice");
  const curPrice = rawCurPrice ?? (shares > 0 ? currentValue / shares : 0);
  const cashPnl = currentValue - costBasis;
  const percentPnl = costBasis > 0 ? (cashPnl / costBasis) * 100 : 0;
  const redeemable = readOptionalBoolean(raw, "redeemable") ?? false;
  const attributes = isRecord(raw.attributes) ? raw.attributes : {};
  return {
    proxyWallet: readOptionalString(raw, "proxyWallet") ?? "",
    asset: row.tokenId,
    conditionId: row.conditionId,
    size: shares,
    avgPrice,
    initialValue: costBasis,
    currentValue,
    cashPnl,
    percentPnl,
    totalBought: readOptionalNumber(raw, "totalBought") ?? 0,
    realizedPnl: readOptionalNumber(raw, "realizedPnl") ?? 0,
    percentRealizedPnl: readOptionalNumber(raw, "percentRealizedPnl") ?? 0,
    curPrice,
    redeemable,
    mergeable: readOptionalBoolean(raw, "mergeable") ?? false,
    title:
      readOptionalString(raw, "title") ??
      readOptionalString(attributes, "title") ??
      "",
    slug:
      readOptionalString(raw, "slug") ??
      readOptionalString(attributes, "slug") ??
      "",
    icon: readOptionalString(raw, "icon") ?? "",
    eventId: readOptionalString(raw, "eventId") ?? "",
    eventSlug:
      readOptionalString(raw, "eventSlug") ??
      readOptionalString(attributes, "event_slug") ??
      "",
    outcome: readOptionalString(raw, "outcome") ?? "",
    outcomeIndex: readOptionalNumber(raw, "outcomeIndex") ?? 0,
    oppositeOutcome: readOptionalString(raw, "oppositeOutcome") ?? "",
    oppositeAsset: readOptionalString(raw, "oppositeAsset") ?? "",
    endDate: readOptionalString(raw, "endDate") ?? "",
    negativeRisk: readOptionalBoolean(raw, "negativeRisk") ?? false,
  };
}

/**
 * Project a `poly_trader_fills` row into the `PolymarketUserTrade` shape
 * `mapExecutionPositions` expects. Mirrors the historical-distributions
 * projection (`historicalFillToOrderFlowTrade`) but emits the trade-shape
 * fields the position-timeline mapper needs.
 */
function dbFillToUserTrade(row: DbFillRow): PolymarketUserTrade {
  const raw = isRecord(row.raw) ? row.raw : {};
  const attributes = isRecord(raw.attributes) ? raw.attributes : {};
  const side = row.side === "SELL" ? "SELL" : "BUY";
  return {
    proxyWallet: readOptionalString(raw, "proxyWallet") ?? "",
    side,
    asset: row.tokenId,
    conditionId: row.conditionId,
    size: toFiniteNumber(row.shares),
    price: toFiniteNumber(row.price),
    timestamp: Math.floor(row.observedAt.getTime() / 1000),
    title:
      readOptionalString(raw, "title") ??
      readOptionalString(attributes, "title") ??
      "",
    slug:
      readOptionalString(raw, "slug") ??
      readOptionalString(attributes, "slug") ??
      "",
    eventSlug:
      readOptionalString(raw, "eventSlug") ??
      readOptionalString(attributes, "event_slug") ??
      "",
    icon: readOptionalString(raw, "icon") ?? "",
    outcome: readOptionalString(raw, "outcome") ?? "",
    outcomeIndex: readOptionalNumber(raw, "outcomeIndex") ?? 0,
    transactionHash:
      readOptionalString(raw, "transactionHash") ??
      readOptionalString(raw, "txHash") ??
      "",
  };
}

function historicalFillToOrderFlowTrade(
  row: HistoricalFillRow
): OrderFlowTrade {
  const raw = isRecord(row.raw) ? row.raw : {};
  const attributes = isRecord(raw.attributes) ? raw.attributes : {};
  const shares = toFiniteNumber(row.shares);
  const price = toFiniteNumber(row.price);
  return {
    side: row.side,
    asset: row.tokenId,
    conditionId: row.conditionId,
    size: shares,
    price,
    timestamp: Math.floor(row.observedAt.getTime() / 1000),
    ...optionalField("title", readOptionalString(attributes, "title")),
    ...optionalField("outcome", readOptionalString(raw, "outcome")),
    ...optionalField("slug", readOptionalString(attributes, "slug")),
    ...optionalField("eventSlug", readOptionalString(attributes, "event_slug")),
  };
}

/**
 * Balance slice — positions for any wallet, sourced from the DB-backed
 * `poly_trader_current_positions` mirror written by the trader-observation
 * tick (task.5005). PAGE_LOAD_DB_ONLY (task.5012 CP5) — no outbound HTTP.
 *
 * Post-Stage-4 (OPERATOR_BRANCH_DORMANT): the single-operator "available +
 * locked" breakdown that used to run for `addr === POLY_PROTO_WALLET_ADDRESS`
 * has been purged. `isOperator` stays in the contract shape as `false` so
 * callers that still branch on it compile — a per-tenant replacement lives
 * with the Money page rework and will go through `PolyTradeExecutor`, not
 * this helper.
 */
export async function getBalanceSlice(
  db: Db,
  addr: string
): Promise<SliceResult<WalletAnalysisBalance>> {
  try {
    const rows = await coalesce(
      `db-balance:${addr}`,
      () => readCurrentPositionsFromDb(db, addr),
      SLICE_TTL_MS
    );
    const positionsValue = rows.reduce(
      (sum, row) => sum + toFiniteNumber(row.currentValueUsdc),
      0
    );

    return {
      kind: "ok",
      value: {
        positions: positionsValue,
        total: positionsValue,
        isOperator: false,
        computedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return {
      kind: "warn",
      warning: warning("balance", err),
    };
  }
}

type DbCurrentPositionRow = {
  conditionId: string;
  tokenId: string;
  shares: string | number;
  costBasisUsdc: string | number;
  currentValueUsdc: string | number;
  avgPrice: string | number;
  lastObservedAt: Date;
  firstObservedAt: Date;
  raw: Record<string, unknown> | null;
};

async function readCurrentPositionsFromDb(
  db: Db,
  addr: string
): Promise<DbCurrentPositionRow[]> {
  const rows = await db
    .select({
      conditionId: polyTraderCurrentPositions.conditionId,
      tokenId: polyTraderCurrentPositions.tokenId,
      shares: polyTraderCurrentPositions.shares,
      costBasisUsdc: polyTraderCurrentPositions.costBasisUsdc,
      currentValueUsdc: polyTraderCurrentPositions.currentValueUsdc,
      avgPrice: polyTraderCurrentPositions.avgPrice,
      lastObservedAt: polyTraderCurrentPositions.lastObservedAt,
      firstObservedAt: polyTraderCurrentPositions.firstObservedAt,
      raw: polyTraderCurrentPositions.raw,
    })
    .from(polyTraderCurrentPositions)
    .innerJoin(
      polyTraderWallets,
      eq(polyTraderWallets.id, polyTraderCurrentPositions.traderWalletId)
    )
    .where(
      and(
        eq(polyTraderWallets.walletAddress, addr.toLowerCase()),
        eq(polyTraderCurrentPositions.active, true)
      )
    );
  return rows as DbCurrentPositionRow[];
}

/**
 * Profit/loss slice — DB-backed Polymarket user P/L history. Reads from
 * `poly_trader_user_pnl_points`; the trader-observation tick is the only
 * caller that hits the live `/user-pnl` API. PAGE_LOAD_DB_ONLY (task.5012).
 */
export async function getPnlSlice(
  db: Db,
  addr: string,
  interval: PolyWalletOverviewInterval
): Promise<SliceResult<WalletAnalysisPnl>> {
  const computedAt = new Date().toISOString();
  try {
    const history = await getTradingWalletPnlHistory({
      db,
      address: addr as `0x${string}`,
      interval,
      capturedAt: computedAt,
    });
    return {
      kind: "ok",
      value: {
        interval,
        history,
        computedAt,
      },
    };
  } catch (err) {
    return {
      kind: "warn",
      warning: warning("pnl", err),
    };
  }
}

export async function getExecutionSlice(
  db: Db,
  addr: string,
  opts: {
    /** Skip public CLOB price history for refresh paths that only need trade cadence. */
    includePriceHistory?: boolean;
    /** Skip the expensive trade read when the caller only needs current holdings. */
    includeTrades?: boolean;
    /** Optional asset allowlist for DB-row enrichment callers. */
    assets?: readonly string[];
  } = {}
): Promise<PolyWalletExecutionOutput> {
  const capturedAt = new Date().toISOString();
  const warnings: WalletExecutionWarning[] = [];
  const includeTrades = opts.includeTrades ?? true;

  const [positionsResult, tradesResult] = await Promise.allSettled([
    coalesce(
      `db-positions:${addr}`,
      () => readCurrentPositionsFromDb(db, addr),
      SLICE_TTL_MS
    ),
    includeTrades
      ? coalesce(
          `db-execution-trades:${addr}`,
          () => readFillsFromDb(db, addr),
          SLICE_TTL_MS
        )
      : Promise.resolve([] as DbFillRow[]),
  ]);

  const positionRows =
    positionsResult.status === "fulfilled" ? positionsResult.value : [];
  const fillRows =
    tradesResult.status === "fulfilled" ? tradesResult.value : [];

  if (positionsResult.status === "rejected") {
    warnings.push({
      code: "positions_unavailable",
      message:
        positionsResult.reason instanceof Error
          ? positionsResult.reason.message
          : String(positionsResult.reason),
    });
  }
  if (tradesResult.status === "rejected") {
    warnings.push({
      code: "trades_unavailable",
      message:
        tradesResult.reason instanceof Error
          ? tradesResult.reason.message
          : String(tradesResult.reason),
    });
  }

  const positions = positionRows.map(dbPositionToUserPosition);
  const trades = fillRows.map(dbFillToUserTrade);

  const dailyTradeCountsResult = buildDailyCounts(
    trades,
    EXECUTION_HISTORY_WINDOW_DAYS
  );

  // Split all mapped positions into open/redeemable (live) vs closed before
  // fetching CLOB price history. Closed positions have a complete trade-derived
  // timeline; CLOB history is only needed for live holdings.
  const allMapped = mapExecutionPositions({
    positions,
    trades,
    asOfIso: capturedAt,
  });

  const allowedAssets = opts.assets !== undefined ? new Set(opts.assets) : null;
  const liveCandidates = allMapped
    .filter((p) => p.status === "open" || p.status === "redeemable")
    .filter((p) => allowedAssets === null || allowedAssets.has(p.asset));
  const livePreview =
    allowedAssets === null
      ? liveCandidates.slice(0, EXECUTION_OPEN_LIMIT)
      : liveCandidates;
  const closedCandidates = allMapped
    .filter((p) => p.status === "closed")
    .filter((p) => allowedAssets === null || allowedAssets.has(p.asset));
  const closedPreview =
    allowedAssets === null
      ? closedCandidates.slice(0, EXECUTION_HISTORY_LIMIT)
      : closedCandidates;

  let liveForResponse = livePreview;
  if (opts.includePriceHistory ?? true) {
    // TODO(v1): move CLOB price-history into a DB read-model writer.
    // PAGE_LOAD_DB_ONLY_EXCEPT_PRICE_HISTORY exception per task.5012 — bounded by
    // open-position count (~10s per wallet); positions/trades above are DB reads.
    const priceHistoryByAsset = new Map<
      string,
      Awaited<ReturnType<PolymarketClobPublicClient["getPriceHistory"]>>
    >();

    await Promise.all(
      livePreview.map(async (position) => {
        const startTs = Math.max(
          0,
          Math.floor(new Date(position.openedAt).getTime() / 1000) - 3600
        );
        const endTs = Math.floor(new Date(capturedAt).getTime() / 1000);
        const fidelity = pickPriceHistoryFidelity(startTs, endTs);

        const history = await coalesce(
          `execution-price-history:${position.asset}:${startTs}:${endTs}:${fidelity}`,
          () =>
            upstreamLimit(() =>
              getClobPublicClient().getPriceHistory(position.asset, {
                startTs,
                endTs,
                fidelity,
              })
            ),
          SLICE_TTL_MS
        );
        if (history.length > 0) {
          priceHistoryByAsset.set(position.asset, history);
        }
      })
    );

    // Re-map live positions with fetched price history timelines.
    const liveAssets = new Set(livePreview.map((p) => p.asset));
    liveForResponse = mapExecutionPositions({
      positions,
      trades,
      priceHistoryByAsset,
      asOfIso: capturedAt,
      assets: [...liveAssets],
    });
  }

  return {
    address: addr.toLowerCase() as PolyWalletExecutionOutput["address"],
    freshness: "live",
    capturedAt,
    dailyTradeCounts: dailyTradeCountsResult,
    live_positions: liveForResponse.map(toExecutionContractPosition),
    market_groups: [],
    closed_positions: closedPreview.map(toExecutionContractPosition),
    warnings,
  };
}

function warning(
  slice: WalletAnalysisWarning["slice"],
  err: unknown
): WalletAnalysisWarning {
  return {
    slice,
    code: "upstream_failed",
    message: err instanceof Error ? err.message : String(err),
  };
}

function toFiniteNumber(value: string | number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readOptionalNumber(
  record: Record<string, unknown>,
  key: string
): number | undefined {
  const value = record[key];
  if (value === null || value === undefined) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function readOptionalBoolean(
  record: Record<string, unknown>,
  key: string
): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function optionalField<TKey extends string>(
  key: TKey,
  value: string | undefined
): { [K in TKey]: string } | Record<string, never> {
  return value === undefined
    ? {}
    : ({ [key]: value } as { [K in TKey]: string });
}

/**
 * Bucket trades by day and emit one row per day from `min(oldestTrade, today
 * minus minWindowDays)` through today. `minWindowDays` is a floor — fresh
 * wallets still show that many bars (mostly zeros) so the chart shape is
 * stable — but older history is never truncated. Returns an empty array when
 * `minWindowDays <= 0` and there are no trades.
 */
function buildDailyCounts(
  trades: ReadonlyArray<{ timestamp: number }>,
  minWindowDays: number
): WalletExecutionDailyCount[] {
  const SEC_PER_DAY = 86_400;
  const nowSec = Math.floor(Date.now() / 1000);
  const buckets = new Map<string, number>();
  let oldestTradeSec = Number.POSITIVE_INFINITY;
  for (const t of trades) {
    const day = new Date(t.timestamp * 1_000).toISOString().slice(0, 10);
    buckets.set(day, (buckets.get(day) ?? 0) + 1);
    if (t.timestamp < oldestTradeSec) oldestTradeSec = t.timestamp;
  }
  const minWindowStartSec =
    minWindowDays > 0 ? nowSec - (minWindowDays - 1) * SEC_PER_DAY : nowSec;
  const startSec = Number.isFinite(oldestTradeSec)
    ? Math.min(minWindowStartSec, oldestTradeSec)
    : minWindowStartSec;
  const totalDays =
    Math.max(0, Math.floor((nowSec - startSec) / SEC_PER_DAY)) + 1;
  if (totalDays <= 0) return [];
  const out: Array<{ day: string; n: number }> = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const day = new Date((nowSec - i * SEC_PER_DAY) * 1_000)
      .toISOString()
      .slice(0, 10);
    out.push({ day, n: buckets.get(day) ?? 0 });
  }
  return out;
}

function toExecutionContractPosition(
  position: ReturnType<typeof mapExecutionPositions>[number]
): WalletExecutionPosition {
  return {
    positionId: position.positionId,
    conditionId: position.conditionId,
    asset: position.asset,
    marketTitle: position.marketTitle,
    marketSlug: position.marketSlug,
    eventSlug: position.eventSlug,
    marketUrl: position.marketUrl,
    outcome: position.outcome,
    status: position.status,
    lifecycleState: null,
    openedAt: position.openedAt,
    closedAt: position.closedAt ?? null,
    resolvesAt: position.resolvesAt ?? null,
    heldMinutes: position.heldMinutes,
    entryPrice: position.entryPrice,
    currentPrice: position.currentPrice,
    size: position.size,
    currentValue: position.currentValue,
    pnlUsd: position.pnlUsd,
    pnlPct: position.pnlPct,
    timeline: [...position.timeline],
    events: [...position.events],
  };
}

function pickPriceHistoryFidelity(startTs: number, endTs: number): number {
  const spanDays = Math.max(1, (endTs - startTs) / 86_400);
  if (spanDays > 365) return 4320;
  if (spanDays > 90) return 1440;
  if (spanDays > 21) return 360;
  if (spanDays > 3) return 60;
  return 5;
}

function buildTopMarkets(
  trades: ReadonlyArray<{
    conditionId: string;
    title: string;
    timestamp: number;
  }>,
  limit: number
): string[] {
  // Newest-first dedupe by conditionId.
  const seen = new Set<string>();
  const out: string[] = [];
  const sorted = [...trades].sort((a, b) => b.timestamp - a.timestamp);
  for (const t of sorted) {
    if (seen.has(t.conditionId) || !t.title) continue;
    seen.add(t.conditionId);
    out.push(t.title);
    if (out.length >= limit) break;
  }
  return out;
}
