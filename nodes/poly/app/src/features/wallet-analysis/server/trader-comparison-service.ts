// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/trader-comparison-service`
 * Purpose: Builds the research trader-comparison slice from saved trader observations and Polymarket-native P/L.
 * Scope: Read-only feature service. Caller injects DB and normalized wallet inputs; this module owns no auth or HTTP parsing.
 * Invariants:
 *   - PNL_SINGLE_SOURCE: delegates to `getPnlSlice`, the same Polymarket-native source used by wallet analysis.
 *   - TRADE_FLOW_FROM_OBSERVATIONS: counts/notional are SQL windows over `poly_trader_fills`.
 * Side-effects: DB reads plus the upstream P/L read performed by `getPnlSlice`.
 * Links: nodes/poly/packages/node-contracts/src/poly.research-trader-comparison.v1.contract.ts
 * @public
 */

import { PolymarketClobPublicClient } from "@cogni/poly-market-provider/adapters/polymarket";
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
import pLimit from "p-limit";
import { coalesce } from "./coalesce";
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

type TradeSizePnlFillRow = {
  condition_id: string | null;
  token_id: string | null;
  side: string | null;
  price: string | number | null;
  shares: string | number | null;
  size_usdc: string | number | null;
  observed_at: Date | string | null;
};

type TradeSizePnlFill = {
  conditionId: string;
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  shares: number;
  sizeUsdc: number;
  observedAt: Date;
};

type ResolutionReader = (
  conditionId: string
) => Promise<MarketResolutionInput | null>;

const SIZE_BUCKET_STEP = 5;
const SIZE_BUCKET_COUNT = 100 / SIZE_BUCKET_STEP;
const SLICE_TTL_MS = 30_000;
const upstreamLimit = pLimit(4);
let clobPublicClient: PolymarketClobPublicClient | undefined;

export async function getTraderComparison(
  db: Db,
  wallets: readonly TraderComparisonInput[],
  interval: PolyWalletOverviewInterval,
  opts: { readResolution?: ResolutionReader | undefined } = {}
): Promise<PolyResearchTraderComparisonResponse> {
  const capturedAt = new Date().toISOString();
  const warnings: PolyResearchTraderComparisonWarning[] = [];
  const windowStartIso = windowStartFor(interval).toISOString();
  const readResolution = opts.readResolution ?? defaultReadResolution;

  const traders = await Promise.all(
    wallets.slice(0, 3).map(async (wallet) => {
      const address = wallet.address.toLowerCase();
      const [summary, tradeSizePnl, pnlResult] = await Promise.all([
        readTradeSummary(db, address, windowStartIso),
        readTradeSizePnl(db, address, windowStartIso, readResolution),
        getPnlSlice(address, interval),
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
  const rows = (await db.execute(sql`
    SELECT
      f.condition_id,
      f.token_id,
      f.side,
      f.price,
      f.shares,
      f.size_usdc,
      f.observed_at
    FROM poly_trader_wallets w
    INNER JOIN poly_trader_fills f
      ON f.trader_wallet_id = w.id
    WHERE w.wallet_address = ${address}
    ORDER BY f.observed_at ASC
  `)) as unknown as TradeSizePnlFillRow[];
  const fills = rows.flatMap(toTradeSizePnlFill);
  if (fills.length === 0) return emptyTradeSizePnl();

  const resolutions = new Map<string, MarketResolutionInput>();
  const conditionIds = [...new Set(fills.map((fill) => fill.conditionId))];
  await Promise.all(
    conditionIds.map((conditionId) =>
      readResolution(conditionId).then((resolution) => {
        if (resolution) resolutions.set(conditionId, resolution);
      })
    )
  );

  return buildTradeSizePnl(fills, resolutions, new Date(windowStartIso));
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
  fills: readonly TradeSizePnlFill[],
  resolutions: ReadonlyMap<string, MarketResolutionInput>,
  windowStart: Date
): PolyResearchTraderSizePnl {
  const hedgeTokenIds = classifyHedgeTokenIds(fills);
  const tokenPnls = computeTokenPnls(fills, resolutions);
  const buys = fills
    .filter((fill) => fill.side === "BUY" && fill.observedAt >= windowStart)
    .sort((a, b) => a.sizeUsdc - b.sizeUsdc);
  const buckets = emptyTradeSizePnl().buckets.map((bucket) => ({ ...bucket }));

  buys.forEach((fill, index) => {
    const bucketIndex = Math.min(
      SIZE_BUCKET_COUNT - 1,
      Math.floor((index / Math.max(1, buys.length)) * SIZE_BUCKET_COUNT)
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
  fills: readonly TradeSizePnlFill[],
  resolutions: ReadonlyMap<string, MarketResolutionInput>
): Map<string, { buyUsdc: number; pnl: number; resolved: boolean }> {
  const tokens = new Map<
    string,
    {
      conditionId: string;
      buyUsdc: number;
      sellUsdc: number;
      buyShares: number;
      sellShares: number;
    }
  >();
  for (const fill of fills) {
    const existing = tokens.get(fill.tokenId) ?? {
      conditionId: fill.conditionId,
      buyUsdc: 0,
      sellUsdc: 0,
      buyShares: 0,
      sellShares: 0,
    };
    if (fill.side === "BUY") {
      existing.buyUsdc += fill.sizeUsdc;
      existing.buyShares += fill.shares;
    } else {
      existing.sellUsdc += fill.sizeUsdc;
      existing.sellShares += fill.shares;
    }
    tokens.set(fill.tokenId, existing);
  }

  const out = new Map<
    string,
    { buyUsdc: number; pnl: number; resolved: boolean }
  >();
  for (const [tokenId, token] of tokens.entries()) {
    const resolution = resolutions.get(token.conditionId);
    const tokenInfo = resolution?.tokens.find((x) => x.token_id === tokenId);
    if (!resolution?.closed || !tokenInfo) {
      out.set(tokenId, {
        buyUsdc: token.buyUsdc,
        pnl: 0,
        resolved: false,
      });
      continue;
    }
    const held = token.buyShares - token.sellShares;
    const payout = held > 0 && tokenInfo.winner ? held : 0;
    out.set(tokenId, {
      buyUsdc: token.buyUsdc,
      pnl: token.sellUsdc + payout - token.buyUsdc,
      resolved: true,
    });
  }
  return out;
}

function classifyHedgeTokenIds(
  fills: readonly TradeSizePnlFill[]
): ReadonlySet<string> {
  const byCondition = new Map<string, Map<string, number>>();
  for (const fill of fills) {
    if (fill.side !== "BUY") continue;
    const condition =
      byCondition.get(fill.conditionId) ?? new Map<string, number>();
    condition.set(
      fill.tokenId,
      (condition.get(fill.tokenId) ?? 0) + fill.sizeUsdc
    );
    byCondition.set(fill.conditionId, condition);
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

function toTradeSizePnlFill(row: TradeSizePnlFillRow): TradeSizePnlFill[] {
  if (!row.condition_id || !row.token_id) return [];
  const side = row.side === "BUY" || row.side === "SELL" ? row.side : null;
  const observedAt =
    row.observed_at instanceof Date
      ? row.observed_at
      : row.observed_at
        ? new Date(row.observed_at)
        : null;
  const price = toNumber(row.price);
  const shares = toNumber(row.shares);
  const sizeUsdc = toNumber(row.size_usdc);
  if (
    !side ||
    !observedAt ||
    Number.isNaN(observedAt.getTime()) ||
    price <= 0 ||
    shares <= 0 ||
    sizeUsdc <= 0
  ) {
    return [];
  }
  return [
    {
      conditionId: row.condition_id,
      tokenId: row.token_id,
      side,
      price,
      shares,
      sizeUsdc,
      observedAt,
    },
  ];
}

async function defaultReadResolution(
  conditionId: string
): Promise<MarketResolutionInput | null> {
  if (!clobPublicClient) clobPublicClient = new PolymarketClobPublicClient();
  return coalesce(
    `research-resolution:${conditionId}`,
    () =>
      upstreamLimit(
        () =>
          clobPublicClient?.getMarketResolution(conditionId) ??
          Promise.resolve(null)
      ),
    SLICE_TTL_MS
  );
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
