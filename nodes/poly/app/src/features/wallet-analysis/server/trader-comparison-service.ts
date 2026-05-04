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

import type {
  PolyResearchTraderComparisonResponse,
  PolyResearchTraderComparisonTrader,
  PolyResearchTraderComparisonWarning,
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

export async function getTraderComparison(
  db: Db,
  wallets: readonly TraderComparisonInput[],
  interval: PolyWalletOverviewInterval
): Promise<PolyResearchTraderComparisonResponse> {
  const capturedAt = new Date().toISOString();
  const warnings: PolyResearchTraderComparisonWarning[] = [];
  const windowStartIso = windowStartFor(interval).toISOString();

  const traders = await Promise.all(
    wallets.slice(0, 3).map(async (wallet) => {
      const address = wallet.address.toLowerCase();
      const [summary, pnlResult] = await Promise.all([
        readTradeSummary(db, address, windowStartIso),
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
  };
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

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
