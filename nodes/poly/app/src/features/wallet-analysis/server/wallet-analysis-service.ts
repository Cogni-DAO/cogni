// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/wallet-analysis-service`
 * Purpose: Service layer feeding `/api/v1/poly/wallets/[addr]` (snapshot, trades, balance, pnl slices) and `/api/v1/poly/wallet/execution` (live/closed position split). Fetches via `PolymarketDataApiClient`, the public CLOB client, and Polymarket's public user-pnl service. All upstream calls are bounded by a process-wide `p-limit(4)` and per-(slice, addr) coalesced under a 30 s TTL.
 * Scope: Compute + I/O only. Does not authenticate, does not parse HTTP. Returns Zod-validated slice values per the wallet-analysis v1 and execution v1 contracts.
 * Invariants:
 *   - REUSE_PACKAGE_CLIENTS: all upstream HTTP goes through `@cogni/poly-market-provider` clients — no fetch in this file.
 *   - DETERMINISTIC_METRICS: snapshot math is identical to `computeWalletMetrics` (spike.0323 v3) for the trade-derived fields it surfaces (winrate, duration, activity counts). PnL-class outputs (`realizedPnlUsdc` etc.) of `computeWalletMetrics` are deliberately not surfaced; PnL is sourced from the `pnl` slice (task.0389).
 *   - PNL_NOT_IN_SNAPSHOT: `getSnapshotSlice` does not return any PnL field. Headline PnL on the wallet research surface is derived from `getPnlSlice` (Polymarket `user-pnl-api`) — single source, reconciles with the chart by construction.
 *   - PARTIAL_FAILURE_NEVER_THROWS: each slice returns a `{ value | warning }` result; the route surfaces warnings without 5xx-ing.
 *   - CLOB_HISTORY_OPEN_ONLY: `getPriceHistory` is fetched only for open/redeemable positions; closed positions use trade-derived timelines only.
 * Side-effects: IO (Polymarket Data API + Polymarket CLOB public + Polymarket user-pnl).
 * Notes: Cache is process-scoped — see `instrumentation.ts` single-replica boot assert.
 * Links: docs/design/wallet-analysis-components.md, nodes/poly/packages/market-provider/src/analysis/wallet-metrics.ts, nodes/poly/packages/node-contracts/src/poly.wallet-analysis.v1.contract.ts, nodes/poly/packages/node-contracts/src/poly.wallet.execution.v1.contract.ts
 * @public
 */

import {
  polyTraderFills,
  polyTraderWallets,
} from "@cogni/poly-db-schema/trader-activity";
import {
  PolymarketClobPublicClient,
  PolymarketDataApiClient,
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
import { asc, eq } from "drizzle-orm";
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
const EXECUTION_TRADE_FETCH_LIMIT = 10_000;
const EXECUTION_POSITION_FETCH_LIMIT = 500;
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
 * Module-singleton clients — created lazily so test code can `vi.mock` either of them
 * before first use. Public-only access; no auth/credentials involved.
 */
let dataApiClient: PolymarketDataApiClient | undefined;
let clobPublicClient: PolymarketClobPublicClient | undefined;

function getDataApiClient(): PolymarketDataApiClient {
  if (!dataApiClient) dataApiClient = new PolymarketDataApiClient();
  return dataApiClient;
}
function getClobPublicClient(): PolymarketClobPublicClient {
  if (!clobPublicClient) clobPublicClient = new PolymarketClobPublicClient();
  return clobPublicClient;
}

/** Test-only: replace the module-singleton clients with stubs. */
export function __setClientsForTests(opts: {
  dataApi?: PolymarketDataApiClient;
  clobPublic?: PolymarketClobPublicClient;
}): void {
  dataApiClient = opts.dataApi ?? dataApiClient;
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
    clearTtlCacheByPrefix(`trades:${address}`);
    clearTtlCacheByPrefix(`execution-trades:${address}`);
    clearTtlCacheByPrefix(`pnl:${address}:`);
  }
}

/** Fetch + return the trades slice. Coalesced + p-limited. */
export async function getTradesSlice(
  addr: string
): Promise<SliceResult<WalletAnalysisTrades>> {
  try {
    const trades = await coalesce(
      `trades:${addr}`,
      () =>
        upstreamLimit(() =>
          getDataApiClient().listUserActivity(addr, {
            limit: TRADE_FETCH_LIMIT,
          })
        ),
      SLICE_TTL_MS
    );
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

/** Compute the snapshot (deterministic metrics) slice. Coalesced + p-limited. */
export async function getSnapshotSlice(
  addr: string
): Promise<SliceResult<WalletAnalysisSnapshot>> {
  try {
    const trades = await coalesce(
      `trades:${addr}`,
      () =>
        upstreamLimit(() =>
          getDataApiClient().listUserActivity(addr, {
            limit: TRADE_FETCH_LIMIT,
          })
        ),
      SLICE_TTL_MS
    );

    const cids = [...new Set(trades.map((t) => t.conditionId))];
    const resolutions = new Map<string, MarketResolutionInput>();
    await Promise.all(
      cids.map((cid) =>
        coalesce(
          `resolution:${cid}`,
          () =>
            upstreamLimit(() => getClobPublicClient().getMarketResolution(cid)),
          // Resolutions are immutable once `closed=true`, but we keep a short
          // TTL so we re-poll markets that aren't closed yet.
          SLICE_TTL_MS
        ).then((r) => {
          if (r) resolutions.set(cid, r);
        })
      )
    );

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
 * outcome split. Reuses the `trades:${addr}` + `resolution:${cid}` cache
 * entries populated by `getSnapshotSlice` so a request that includes both
 * slices triggers exactly one upstream fan-out per (wallet, market).
 *
 * `historical` reads every saved observation for rostered research wallets;
 * `live` keeps the arbitrary-address on-demand path.
 */
export async function getDistributionsSlice(
  addr: string,
  mode: "live" | "historical",
  opts: { db?: Db | undefined } = {}
): Promise<SliceResult<WalletAnalysisDistributions>> {
  if (mode === "historical") {
    if (!opts.db) {
      return {
        kind: "warn",
        warning: {
          slice: "distributions",
          code: "distributions_unavailable",
          message: "historical mode requires a service database handle",
        },
      };
    }
    return getHistoricalDistributionsSlice(addr, opts.db);
  }
  try {
    const trades = await coalesce(
      `trades:${addr}`,
      () =>
        upstreamLimit(() =>
          getDataApiClient().listUserActivity(addr, {
            limit: TRADE_FETCH_LIMIT,
          })
        ),
      SLICE_TTL_MS
    );

    const cids = [...new Set(trades.map((t) => t.conditionId))];
    const resolutions = new Map<string, MarketResolutionInput>();
    await Promise.all(
      cids.map((cid) =>
        coalesce(
          `resolution:${cid}`,
          () =>
            upstreamLimit(() => getClobPublicClient().getMarketResolution(cid)),
          SLICE_TTL_MS
        ).then((r) => {
          if (r) resolutions.set(cid, r);
        })
      )
    );

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

async function getHistoricalDistributionsSlice(
  addr: string,
  db: Db
): Promise<SliceResult<WalletAnalysisDistributions>> {
  try {
    const trades = await coalesce(
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

    const cids = [...new Set(trades.map((t) => t.conditionId))];
    const resolutions = new Map<string, MarketResolutionInput>();
    await Promise.all(
      cids.map((cid) =>
        coalesce(
          `resolution:${cid}`,
          () =>
            upstreamLimit(() => getClobPublicClient().getMarketResolution(cid)),
          SLICE_TTL_MS
        ).then((r) => {
          if (r) resolutions.set(cid, r);
        })
      )
    );

    const summary = summariseOrderFlow(trades, resolutions);
    return {
      kind: "ok",
      value: {
        mode: "historical",
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
 * Balance slice — positions for any wallet.
 *
 * Post-Stage-4 (OPERATOR_BRANCH_DORMANT): the single-operator "available +
 * locked" breakdown that used to run for `addr === POLY_PROTO_WALLET_ADDRESS`
 * has been purged. `isOperator` stays in the contract shape as `false` so
 * callers that still branch on it compile — a per-tenant replacement lives
 * with the Money page rework and will go through `PolyTradeExecutor`, not
 * this helper.
 */
export async function getBalanceSlice(
  addr: string
): Promise<SliceResult<WalletAnalysisBalance>> {
  try {
    const positions = await coalesce(
      `positions:${addr}`,
      () =>
        upstreamLimit(() =>
          getDataApiClient().listUserPositions(addr, {
            limit: EXECUTION_POSITION_FETCH_LIMIT,
          })
        ),
      SLICE_TTL_MS
    );
    const positionsValue = positions.reduce(
      (s, p) => s + (p.currentValue ?? 0),
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

/** Profit/loss slice — Polymarket-native user P/L history for any wallet. */
export async function getPnlSlice(
  addr: string,
  interval: PolyWalletOverviewInterval
): Promise<SliceResult<WalletAnalysisPnl>> {
  const computedAt = new Date().toISOString();
  try {
    const history = await coalesce(
      `pnl:${addr}:${interval}`,
      () =>
        upstreamLimit(() =>
          getTradingWalletPnlHistory({
            address: addr as `0x${string}`,
            interval,
            capturedAt: computedAt,
          })
        ),
      SLICE_TTL_MS
    );

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
  addr: string,
  opts: {
    /** Skip public CLOB price history for refresh paths that only need trade cadence. */
    includePriceHistory?: boolean;
    /** Skip the expensive `/trades` read when the caller only needs current holdings. */
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
      `positions:${addr}`,
      () =>
        upstreamLimit(() =>
          getDataApiClient().listUserPositions(addr, {
            limit: EXECUTION_POSITION_FETCH_LIMIT,
          })
        ),
      SLICE_TTL_MS
    ),
    includeTrades
      ? coalesce(
          `execution-trades:${addr}`,
          () =>
            upstreamLimit(() =>
              getDataApiClient().listUserTrades(addr, {
                limit: EXECUTION_TRADE_FETCH_LIMIT,
              })
            ),
          SLICE_TTL_MS
        )
      : Promise.resolve([]),
  ]);

  const positions =
    positionsResult.status === "fulfilled" ? positionsResult.value : [];
  const trades = tradesResult.status === "fulfilled" ? tradesResult.value : [];

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
    // Fetch CLOB price history for live positions only.
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

function optionalField<TKey extends string>(
  key: TKey,
  value: string | undefined
): { [K in TKey]: string } | Record<string, never> {
  return value === undefined
    ? {}
    : ({ [key]: value } as { [K in TKey]: string });
}

function buildDailyCounts(
  trades: ReadonlyArray<{ timestamp: number }>,
  windowDays: number
): WalletExecutionDailyCount[] {
  const SEC_PER_DAY = 86_400;
  const nowSec = Math.floor(Date.now() / 1000);
  const buckets = new Map<string, number>();
  for (const t of trades) {
    const day = new Date(t.timestamp * 1_000).toISOString().slice(0, 10);
    buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  const out: Array<{ day: string; n: number }> = [];
  for (let i = windowDays - 1; i >= 0; i--) {
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
