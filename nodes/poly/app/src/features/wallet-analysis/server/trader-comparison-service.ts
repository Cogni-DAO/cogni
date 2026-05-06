// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/trader-comparison-service`
 * Purpose: Builds the research trader-comparison slice from saved trader observations and Polymarket-native P/L.
 * Scope: Read-only feature service. Caller injects DB and normalized wallet inputs; this module owns no auth or HTTP parsing.
 * Invariants:
 *   - PNL_SINGLE_SOURCE: delegates to `getPnlSlice`, the same Polymarket-native source used by wallet analysis.
 *   - TRADE_FLOW_FROM_OBSERVATIONS: counts/notional are SQL windows over `poly_trader_fills`.
 *   - PAGE_LOAD_DB_ONLY: market resolutions read from `poly_market_outcomes` (CP3 writer); no synchronous CLOB call on render.
 * Side-effects: DB reads plus the upstream P/L read performed by `getPnlSlice`.
 * Links: nodes/poly/packages/node-contracts/src/poly.research-trader-comparison.v1.contract.ts, work/items/task.5012
 * @public
 */

import type { MarketResolutionInput } from "@cogni/poly-market-provider/analysis";
import type {
  PolyResearchTraderComparisonResponse,
  PolyResearchTraderComparisonTrader,
  PolyResearchTraderComparisonWarning,
  PolyResearchTraderSizePnl,
  PolyWalletOverviewInterval,
  PolyWalletOverviewPnlPoint,
} from "@cogni/poly-node-contracts";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getPnlSlice } from "./wallet-analysis-service";

type Db =
  | NodePgDatabase<Record<string, unknown>>
  | PostgresJsDatabase<Record<string, unknown>>;

export type TraderComparisonInput = {
  address: string;
  label?: string | undefined;
};

type TradeSummaryRow = {
  id: string;
  label: string;
  kind: string;
  first_observed_at: Date | string | null;
  last_success_at: Date | string | null;
  status: string | null;
  trade_count: string | number | null;
  buy_count: string | number | null;
  sell_count: string | number | null;
  notional_usdc: string | number | null;
  buy_usdc: string | number | null;
  sell_usdc: string | number | null;
  market_count: string | number | null;
};

type TokenAggRow = {
  condition_id: string | null;
  token_id: string | null;
  buy_usdc: string | number | null;
  sell_usdc: string | number | null;
  buy_shares: string | number | null;
  sell_shares: string | number | null;
};

type WindowedBuyRow = {
  condition_id: string | null;
  token_id: string | null;
  size_usdc: string | number | null;
};

type TokenAgg = {
  conditionId: string;
  tokenId: string;
  buyUsdc: number;
  sellUsdc: number;
  buyShares: number;
  sellShares: number;
};

type WindowedBuy = {
  conditionId: string;
  tokenId: string;
  sizeUsdc: number;
};

type ResolutionReader = (
  conditionId: string
) => Promise<MarketResolutionInput | null>;

const SIZE_BUCKET_STEP = 5;
const SIZE_BUCKET_COUNT = 100 / SIZE_BUCKET_STEP;

export async function getTraderComparison(
  db: Db,
  wallets: readonly TraderComparisonInput[],
  interval: PolyWalletOverviewInterval,
  opts: { readResolution?: ResolutionReader | undefined } = {}
): Promise<PolyResearchTraderComparisonResponse> {
  const capturedAt = new Date().toISOString();
  const warnings: PolyResearchTraderComparisonWarning[] = [];
  const windowStartIso = windowStartFor(interval).toISOString();
  const readResolution =
    opts.readResolution ??
    ((conditionId) => readResolutionFromDb(db, conditionId));

  const traders = await Promise.all(
    wallets.slice(0, 3).map(async (wallet) => {
      const address = wallet.address.toLowerCase();
      const [summary, tradeSizePnl, pnlResult] = await Promise.all([
        readTradeSummary(db, address, windowStartIso),
        readTradeSizePnl(db, address, windowStartIso, readResolution),
        getPnlSlice(db, address, interval),
      ]);
      const pnlHistory =
        pnlResult.kind === "ok" ? [...pnlResult.value.history] : [];
      if (pnlResult.kind === "warn") {
        warnings.push({
          wallet: address as `0x${string}`,
          code: pnlResult.warning.code,
          message: pnlResult.warning.message,
        });
      }

      return toTrader({
        address,
        fallbackLabel: wallet.label,
        interval,
        summary,
        tradeSizePnl,
        pnlHistory,
      });
    })
  );

  return {
    interval,
    capturedAt,
    traders,
    warnings,
  };
}

async function readTradeSizePnl(
  db: Db,
  address: string,
  windowStartIso: string,
  readResolution: ResolutionReader
): Promise<PolyResearchTraderSizePnl> {
  // Per-token aggregates over ALL fills (constant cardinality — one row per
  // unique token, ~thousands max regardless of fill count). bug.5012-shape
  // unbounded SELECT eliminated: we never hydrate raw fills in V8.
  const tokenAggRows = (await db.execute(sql`
    SELECT
      f.condition_id,
      f.token_id,
      COALESCE(SUM(f.size_usdc::numeric) FILTER (WHERE f.side = 'BUY'), 0)  AS buy_usdc,
      COALESCE(SUM(f.size_usdc::numeric) FILTER (WHERE f.side = 'SELL'), 0) AS sell_usdc,
      COALESCE(SUM(f.shares::numeric)    FILTER (WHERE f.side = 'BUY'), 0)  AS buy_shares,
      COALESCE(SUM(f.shares::numeric)    FILTER (WHERE f.side = 'SELL'), 0) AS sell_shares
    FROM poly_trader_wallets w
    INNER JOIN poly_trader_fills f
      ON f.trader_wallet_id = w.id
    WHERE w.wallet_address = ${address}
    GROUP BY f.condition_id, f.token_id
  `)) as unknown as TokenAggRow[];
  const tokenAggs = tokenAggRows.flatMap(toTokenAgg);
  if (tokenAggs.length === 0) return emptyTradeSizePnl();

  // Windowed buys for size-percentile bucket assignment. Bounded by the
  // active interval (1D / 1W / 1M / ALL); SELLs and out-of-window fills are
  // filtered at the SQL boundary.
  const windowedBuyRows = (await db.execute(sql`
    SELECT
      f.condition_id,
      f.token_id,
      f.size_usdc
    FROM poly_trader_wallets w
    INNER JOIN poly_trader_fills f
      ON f.trader_wallet_id = w.id
    WHERE w.wallet_address = ${address}
      AND f.side = 'BUY'
      AND f.observed_at >= ${windowStartIso}::timestamptz
    ORDER BY f.size_usdc::numeric ASC
  `)) as unknown as WindowedBuyRow[];
  const windowedBuys = windowedBuyRows.flatMap(toWindowedBuy);

  const resolutions = new Map<string, MarketResolutionInput>();
  const conditionIds = [...new Set(tokenAggs.map((t) => t.conditionId))];
  await Promise.all(
    conditionIds.map((conditionId) =>
      readResolution(conditionId).then((resolution) => {
        if (resolution) resolutions.set(conditionId, resolution);
      })
    )
  );

  return buildTradeSizePnl(tokenAggs, windowedBuys, resolutions);
}

async function readTradeSummary(
  db: Db,
  address: string,
  windowStartIso: string
): Promise<TradeSummaryRow | null> {
  const rows = (await db.execute(sql`
    SELECT
      w.id,
      w.label,
      w.kind,
      w.first_observed_at,
      c.last_success_at,
      c.status,
      COALESCE(COUNT(f.id), 0) AS trade_count,
      COALESCE(COUNT(f.id) FILTER (WHERE f.side = 'BUY'), 0) AS buy_count,
      COALESCE(COUNT(f.id) FILTER (WHERE f.side = 'SELL'), 0) AS sell_count,
      COALESCE(SUM(f.size_usdc::numeric), 0) AS notional_usdc,
      COALESCE(SUM(f.size_usdc::numeric) FILTER (WHERE f.side = 'BUY'), 0) AS buy_usdc,
      COALESCE(SUM(f.size_usdc::numeric) FILTER (WHERE f.side = 'SELL'), 0) AS sell_usdc,
      COALESCE(COUNT(DISTINCT f.condition_id), 0) AS market_count
    FROM poly_trader_wallets w
    LEFT JOIN poly_trader_ingestion_cursors c
      ON c.trader_wallet_id = w.id
      AND c.source = 'data-api-trades'
    LEFT JOIN poly_trader_fills f
      ON f.trader_wallet_id = w.id
      AND f.observed_at >= ${windowStartIso}::timestamptz
    WHERE w.wallet_address = ${address}
    GROUP BY w.id, w.label, w.kind, w.first_observed_at, c.last_success_at, c.status
    LIMIT 1
  `)) as unknown as TradeSummaryRow[];
  return rows[0] ?? null;
}

function toTrader(params: {
  address: string;
  fallbackLabel?: string | undefined;
  interval: PolyWalletOverviewInterval;
  summary: TradeSummaryRow | null;
  tradeSizePnl: PolyResearchTraderSizePnl;
  pnlHistory: PolyWalletOverviewPnlPoint[];
}): PolyResearchTraderComparisonTrader {
  const summary = params.summary;
  const label =
    params.fallbackLabel?.trim() ||
    summary?.label ||
    shortAddress(params.address);
  return {
    address: params.address as `0x${string}`,
    label,
    isObserved: Boolean(summary),
    traderKind:
      summary?.kind === "copy_target" || summary?.kind === "cogni_wallet"
        ? summary.kind
        : null,
    interval: params.interval,
    observedSince: toIsoString(summary?.first_observed_at),
    lastObservedAt: toIsoString(summary?.last_success_at),
    observationStatus: summary?.status ?? null,
    pnl: {
      usdc: computeWindowedPnl(params.pnlHistory),
      history: params.pnlHistory,
    },
    trades: {
      count: toInteger(summary?.trade_count),
      buyCount: toInteger(summary?.buy_count),
      sellCount: toInteger(summary?.sell_count),
      notionalUsdc: toNumber(summary?.notional_usdc),
      buyUsdc: toNumber(summary?.buy_usdc),
      sellUsdc: toNumber(summary?.sell_usdc),
      marketCount: toInteger(summary?.market_count),
    },
    tradeSizePnl: params.tradeSizePnl,
  };
}

function buildTradeSizePnl(
  tokenAggs: readonly TokenAgg[],
  windowedBuys: readonly WindowedBuy[],
  resolutions: ReadonlyMap<string, MarketResolutionInput>
): PolyResearchTraderSizePnl {
  const hedgeTokenIds = classifyHedgeTokenIds(tokenAggs);
  const tokenPnls = computeTokenPnls(tokenAggs, resolutions);
  // windowedBuys is already SQL-sorted ASC by size_usdc.
  const buckets = emptyTradeSizePnl().buckets.map((bucket) => ({ ...bucket }));

  windowedBuys.forEach((fill, index) => {
    const bucketIndex = Math.min(
      SIZE_BUCKET_COUNT - 1,
      Math.floor((index / Math.max(1, windowedBuys.length)) * SIZE_BUCKET_COUNT)
    );
    const bucket = buckets[bucketIndex];
    if (!bucket) return;
    const tokenPnl = tokenPnls.get(fill.tokenId);
    const pnl = tokenPnl
      ? (fill.sizeUsdc / Math.max(tokenPnl.buyUsdc, 1)) * tokenPnl.pnl
      : 0;
    const resolved = Boolean(tokenPnl?.resolved);
    bucket.buyCount += 1;
    bucket.buyUsdc += fill.sizeUsdc;
    bucket.avgSizeUsdc += fill.sizeUsdc;
    bucket.minSizeUsdc =
      bucket.buyCount === 1
        ? fill.sizeUsdc
        : Math.min(bucket.minSizeUsdc, fill.sizeUsdc);
    bucket.maxSizeUsdc = Math.max(bucket.maxSizeUsdc, fill.sizeUsdc);
    if (hedgeTokenIds.has(fill.tokenId)) {
      bucket.hedgeBuyCount += 1;
      bucket.hedgeBuyUsdc += fill.sizeUsdc;
    }
    if (!resolved) {
      bucket.pendingCount += 1;
      return;
    }
    bucket.resolvedCount += 1;
    bucket.pnlUsdc += pnl;
    if (pnl > 0.5) bucket.winCount += 1;
    else if (pnl < -0.5) bucket.lossCount += 1;
    else bucket.flatCount += 1;
  });

  const finalized = buckets.map((bucket) => ({
    ...bucket,
    avgSizeUsdc:
      bucket.buyCount > 0
        ? roundMoney(bucket.avgSizeUsdc / bucket.buyCount)
        : 0,
    minSizeUsdc: bucket.buyCount > 0 ? roundMoney(bucket.minSizeUsdc) : 0,
    maxSizeUsdc: bucket.buyCount > 0 ? roundMoney(bucket.maxSizeUsdc) : 0,
    buyUsdc: roundMoney(bucket.buyUsdc),
    hedgeBuyUsdc: roundMoney(bucket.hedgeBuyUsdc),
    pnlUsdc: roundMoney(bucket.pnlUsdc),
    winRate:
      bucket.winCount + bucket.lossCount > 0
        ? bucket.winCount / (bucket.winCount + bucket.lossCount)
        : null,
  }));

  const totals = finalized.reduce(
    (acc, bucket) => ({
      sampleBuyCount: acc.sampleBuyCount + bucket.buyCount,
      resolvedCount: acc.resolvedCount + bucket.resolvedCount,
      winCount: acc.winCount + bucket.winCount,
      lossCount: acc.lossCount + bucket.lossCount,
      flatCount: acc.flatCount + bucket.flatCount,
      pendingCount: acc.pendingCount + bucket.pendingCount,
      pnlUsdc: acc.pnlUsdc + bucket.pnlUsdc,
      buyUsdc: acc.buyUsdc + bucket.buyUsdc,
      hedgeBuyCount: acc.hedgeBuyCount + bucket.hedgeBuyCount,
      hedgeBuyUsdc: acc.hedgeBuyUsdc + bucket.hedgeBuyUsdc,
    }),
    {
      sampleBuyCount: 0,
      resolvedCount: 0,
      winCount: 0,
      lossCount: 0,
      flatCount: 0,
      pendingCount: 0,
      pnlUsdc: 0,
      buyUsdc: 0,
      hedgeBuyCount: 0,
      hedgeBuyUsdc: 0,
    }
  );

  return {
    bucketStep: SIZE_BUCKET_STEP,
    ...totals,
    pnlUsdc: roundMoney(totals.pnlUsdc),
    buyUsdc: roundMoney(totals.buyUsdc),
    hedgeBuyUsdc: roundMoney(totals.hedgeBuyUsdc),
    winRate:
      totals.winCount + totals.lossCount > 0
        ? totals.winCount / (totals.winCount + totals.lossCount)
        : null,
    buckets: finalized,
  };
}

function emptyTradeSizePnl(): PolyResearchTraderSizePnl {
  const buckets = Array.from({ length: SIZE_BUCKET_COUNT }, (_, index) => {
    const lo = index * SIZE_BUCKET_STEP;
    const hi = lo + SIZE_BUCKET_STEP;
    return {
      key: `p${lo}_p${hi}`,
      label: `p${lo}-p${hi}`,
      loPercentile: lo,
      hiPercentile: hi,
      minSizeUsdc: 0,
      maxSizeUsdc: 0,
      avgSizeUsdc: 0,
      buyCount: 0,
      resolvedCount: 0,
      winCount: 0,
      lossCount: 0,
      flatCount: 0,
      pendingCount: 0,
      winRate: null,
      pnlUsdc: 0,
      buyUsdc: 0,
      hedgeBuyCount: 0,
      hedgeBuyUsdc: 0,
    };
  });
  return {
    bucketStep: SIZE_BUCKET_STEP,
    sampleBuyCount: 0,
    resolvedCount: 0,
    winCount: 0,
    lossCount: 0,
    flatCount: 0,
    pendingCount: 0,
    winRate: null,
    pnlUsdc: 0,
    buyUsdc: 0,
    hedgeBuyCount: 0,
    hedgeBuyUsdc: 0,
    buckets,
  };
}

function computeTokenPnls(
  tokenAggs: readonly TokenAgg[],
  resolutions: ReadonlyMap<string, MarketResolutionInput>
): Map<string, { buyUsdc: number; pnl: number; resolved: boolean }> {
  const out = new Map<
    string,
    { buyUsdc: number; pnl: number; resolved: boolean }
  >();
  for (const token of tokenAggs) {
    const resolution = resolutions.get(token.conditionId);
    const tokenInfo = resolution?.tokens.find(
      (x) => x.token_id === token.tokenId
    );
    if (!resolution?.closed || !tokenInfo) {
      out.set(token.tokenId, {
        buyUsdc: token.buyUsdc,
        pnl: 0,
        resolved: false,
      });
      continue;
    }
    const held = token.buyShares - token.sellShares;
    const payout = held > 0 && tokenInfo.winner ? held : 0;
    out.set(token.tokenId, {
      buyUsdc: token.buyUsdc,
      pnl: token.sellUsdc + payout - token.buyUsdc,
      resolved: true,
    });
  }
  return out;
}

function classifyHedgeTokenIds(
  tokenAggs: readonly TokenAgg[]
): ReadonlySet<string> {
  const byCondition = new Map<string, Map<string, number>>();
  for (const token of tokenAggs) {
    if (token.buyUsdc <= 0) continue;
    const condition =
      byCondition.get(token.conditionId) ?? new Map<string, number>();
    condition.set(token.tokenId, token.buyUsdc);
    byCondition.set(token.conditionId, condition);
  }

  const hedgeTokenIds = new Set<string>();
  for (const tokenCosts of byCondition.values()) {
    if (tokenCosts.size < 2) continue;
    const ranked = [...tokenCosts.entries()].sort((a, b) => a[1] - b[1]);
    const hedge = ranked[0];
    const primary = ranked.at(-1);
    if (hedge && primary && hedge[1] < primary[1]) {
      hedgeTokenIds.add(hedge[0]);
    }
  }
  return hedgeTokenIds;
}

function toTokenAgg(row: TokenAggRow): TokenAgg[] {
  if (!row.condition_id || !row.token_id) return [];
  const buyUsdc = toNumber(row.buy_usdc);
  const sellUsdc = toNumber(row.sell_usdc);
  const buyShares = toNumber(row.buy_shares);
  const sellShares = toNumber(row.sell_shares);
  if (buyUsdc <= 0 && sellUsdc <= 0) return [];
  return [
    {
      conditionId: row.condition_id,
      tokenId: row.token_id,
      buyUsdc,
      sellUsdc,
      buyShares,
      sellShares,
    },
  ];
}

function toWindowedBuy(row: WindowedBuyRow): WindowedBuy[] {
  if (!row.condition_id || !row.token_id) return [];
  const sizeUsdc = toNumber(row.size_usdc);
  if (sizeUsdc <= 0) return [];
  return [
    {
      conditionId: row.condition_id,
      tokenId: row.token_id,
      sizeUsdc,
    },
  ];
}

type MarketOutcomeRow = {
  token_id: string | null;
  outcome: string | null;
};

async function readResolutionFromDb(
  db: Db,
  conditionId: string
): Promise<MarketResolutionInput | null> {
  const rows = (await db.execute(sql`
    SELECT token_id, outcome
    FROM poly_market_outcomes
    WHERE condition_id = ${conditionId}
  `)) as unknown as MarketOutcomeRow[];
  if (rows.length === 0) return null;
  const closed = rows.every(
    (r) => r.outcome !== "unknown" && r.outcome !== null
  );
  const tokens = rows
    .filter((r): r is { token_id: string; outcome: string } =>
      Boolean(r.token_id)
    )
    .map((r) => ({ token_id: r.token_id, winner: r.outcome === "winner" }));
  return { closed, tokens };
}

export function computeWindowedPnl(
  history: readonly PolyWalletOverviewPnlPoint[]
): number | null {
  if (history.length < 2) return null;
  const first = history[0];
  const last = history.at(-1);
  if (!first || !last) return null;
  return Number((last.pnl - first.pnl).toFixed(8));
}

function windowStartFor(interval: PolyWalletOverviewInterval): Date {
  const now = Date.now();
  switch (interval) {
    case "1D":
      return new Date(now - 24 * 60 * 60 * 1000);
    case "1W":
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case "1M":
      return new Date(now - 30 * 24 * 60 * 60 * 1000);
    case "1Y":
      return new Date(now - 365 * 24 * 60 * 60 * 1000);
    case "YTD":
      return new Date(new Date().getFullYear(), 0, 1);
    case "ALL":
      return new Date(0);
  }
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toInteger(value: string | number | null | undefined): number {
  return Math.max(0, Math.trunc(toNumber(value)));
}

function roundMoney(value: number): number {
  return Number(value.toFixed(8));
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
