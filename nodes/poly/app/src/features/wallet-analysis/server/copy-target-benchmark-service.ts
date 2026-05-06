// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/copy-target-benchmark-service`
 * Purpose: Query saved observed trader facts into the wallet research benchmark slice.
 * Scope: Read-only aggregation. Caller injects DB; this module does not fetch upstream APIs.
 * Invariants:
 *   - QUERY_WINDOWS_NOT_INGESTION_WINDOWS: 1D/1W/1M are SQL windows over saved observations.
 *   - SAME_OBSERVED_TRADE_TABLE: target and Cogni VWAP use `poly_trader_fills`.
 * Side-effects: DB reads only.
 * Links: docs/design/poly-copy-target-performance-benchmark.md, work/items/task.5005
 * @public
 */

import {
  polyTraderIngestionCursors,
  polyTraderWallets,
} from "@cogni/poly-db-schema/trader-activity";
import type {
  PolyWalletOverviewInterval,
  WalletAnalysisBenchmark,
  WalletAnalysisWarning,
} from "@cogni/poly-node-contracts";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { liveCurrentPositionSql } from "./current-position-staleness";
import type { SliceResult } from "./wallet-analysis-service";

type Db =
  | NodePgDatabase<Record<string, unknown>>
  | PostgresJsDatabase<Record<string, unknown>>;

type BenchmarkMarketRow = {
  condition_id: string;
  token_id: string;
  target_vwap: string | number | null;
  cogni_vwap: string | number | null;
  target_size_usdc: string | number | null;
  cogni_size_usdc: string | number | null;
};

type ActiveGapRow = {
  condition_id: string;
  token_id: string;
  target_current_value_usdc: string | number | null;
};

type HedgePolicyRow = {
  target_hedged_conditions: string | number | null;
  target_hedges_passing_gate: string | number | null;
  lowest_passing_hedge_ratio: string | number | null;
};

type SummaryRow = {
  target_open_value_usdc: string | number | null;
  cogni_open_value_usdc: string | number | null;
  target_trades: string | number | null;
  cogni_trades: string | number | null;
};

const AS_BUILT_MIN_TARGET_HEDGE_RATIO = 0.02;
const AS_BUILT_MIN_TARGET_HEDGE_USDC = 5;

export async function getBenchmarkSlice(
  db: Db,
  addr: string,
  interval: PolyWalletOverviewInterval,
  opts: { comparisonWalletAddress?: string | null } = {}
): Promise<SliceResult<WalletAnalysisBenchmark>> {
  try {
    return {
      kind: "ok",
      value: await readBenchmark(db, addr.toLowerCase(), interval, opts),
    };
  } catch (err) {
    return {
      kind: "warn",
      warning: {
        slice: "benchmark",
        code: "benchmark_unavailable",
        message: err instanceof Error ? err.message : String(err),
      } satisfies WalletAnalysisWarning,
    };
  }
}

async function readBenchmark(
  db: Db,
  addr: string,
  interval: PolyWalletOverviewInterval,
  opts: { comparisonWalletAddress?: string | null }
): Promise<WalletAnalysisBenchmark> {
  const walletRows = await db
    .select({
      id: polyTraderWallets.id,
      walletAddress: polyTraderWallets.walletAddress,
      kind: polyTraderWallets.kind,
      label: polyTraderWallets.label,
      firstObservedAt: polyTraderWallets.firstObservedAt,
      lastSuccessAt: polyTraderIngestionCursors.lastSuccessAt,
      status: polyTraderIngestionCursors.status,
    })
    .from(polyTraderWallets)
    .leftJoin(
      polyTraderIngestionCursors,
      and(
        eq(polyTraderIngestionCursors.traderWalletId, polyTraderWallets.id),
        eq(polyTraderIngestionCursors.source, "data-api-trades")
      )
    )
    .where(eq(polyTraderWallets.walletAddress, addr))
    .limit(1);

  const wallet = walletRows[0];
  const computedAt = new Date().toISOString();
  const windowStartIso = windowStartFor(interval).toISOString();
  const comparisonWallet = opts.comparisonWalletAddress
    ? await readObservedWallet(db, opts.comparisonWalletAddress.toLowerCase())
    : null;
  if (!wallet) {
    return emptyBenchmark({
      interval,
      computedAt,
      isObserved: false,
      traderKind: null,
      label: null,
    });
  }

  const [summaryRows, marketRows, gapRows, hedgePolicyRows] = await Promise.all(
    [
      readSummary(db, wallet.id, comparisonWallet?.id ?? null, windowStartIso),
      wallet.kind === "copy_target"
        ? readMarketRows(
            db,
            wallet.id,
            comparisonWallet?.id ?? null,
            windowStartIso
          )
        : Promise.resolve([]),
      wallet.kind === "copy_target"
        ? readActiveGaps(db, wallet.id, comparisonWallet?.id ?? null)
        : [],
      wallet.kind === "copy_target"
        ? readHedgePolicyRows(db, wallet.id)
        : Promise.resolve([]),
    ]
  );

  const summary = summaryRows[0] ?? {
    target_open_value_usdc: 0,
    cogni_open_value_usdc: 0,
    target_trades: 0,
    cogni_trades: 0,
  };
  const targetSizeUsdc = marketRows.reduce(
    (sum, row) => sum + toNumber(row.target_size_usdc),
    0
  );
  const cogniSizeUsdc = marketRows.reduce(
    (sum, row) => sum + toNumber(row.cogni_size_usdc),
    0
  );

  return {
    isObserved: true,
    traderKind:
      wallet.kind === "copy_target" || wallet.kind === "cogni_wallet"
        ? wallet.kind
        : null,
    label: wallet.label,
    window: interval,
    coverage: {
      observedSince: wallet.firstObservedAt?.toISOString() ?? null,
      lastSuccessAt: wallet.lastSuccessAt?.toISOString() ?? null,
      status: wallet.status,
      targetTrades: Number(toNumber(summary.target_trades).toFixed(0)),
      cogniTrades: Number(toNumber(summary.cogni_trades).toFixed(0)),
    },
    summary: {
      targetSizeUsdc,
      cogniSizeUsdc,
      copyCaptureRatio:
        targetSizeUsdc > 0
          ? Number((cogniSizeUsdc / targetSizeUsdc).toFixed(4))
          : null,
      targetOpenValueUsdc: toNumber(summary.target_open_value_usdc),
      cogniOpenValueUsdc: toNumber(summary.cogni_open_value_usdc),
    },
    hedgePolicy: hedgePolicyFromRows(hedgePolicyRows),
    markets: marketRows.slice(0, 50).map((row) => {
      const targetSize = toNumber(row.target_size_usdc);
      const cogniSize = toNumber(row.cogni_size_usdc);
      return {
        conditionId: row.condition_id,
        tokenId: row.token_id,
        targetVwap: nullableNumber(row.target_vwap),
        cogniVwap: nullableNumber(row.cogni_vwap),
        targetSizeUsdc: targetSize,
        cogniSizeUsdc: cogniSize,
        status:
          cogniSize <= 0
            ? "missed"
            : cogniSize >= targetSize * 0.8
              ? "copied"
              : "partial",
        reason: cogniSize > 0 ? "observed_cogni_fill" : "no_response_yet",
      };
    }),
    activeGaps: gapRows.slice(0, 25).map((row) => ({
      conditionId: row.condition_id,
      tokenId: row.token_id,
      targetCurrentValueUsdc: toNumber(row.target_current_value_usdc),
      reason: "no_matching_cogni_position",
    })),
    computedAt,
  };
}

async function readObservedWallet(
  db: Db,
  walletAddress: string
): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: polyTraderWallets.id })
    .from(polyTraderWallets)
    .where(eq(polyTraderWallets.walletAddress, walletAddress))
    .limit(1);
  return rows[0] ?? null;
}

function emptyBenchmark(params: {
  interval: PolyWalletOverviewInterval;
  computedAt: string;
  isObserved: boolean;
  traderKind: "copy_target" | "cogni_wallet" | null;
  label: string | null;
}): WalletAnalysisBenchmark {
  return {
    isObserved: params.isObserved,
    traderKind: params.traderKind,
    label: params.label,
    window: params.interval,
    coverage: {
      observedSince: null,
      lastSuccessAt: null,
      status: null,
      targetTrades: 0,
      cogniTrades: 0,
    },
    summary: {
      targetSizeUsdc: 0,
      cogniSizeUsdc: 0,
      copyCaptureRatio: null,
      targetOpenValueUsdc: 0,
      cogniOpenValueUsdc: 0,
    },
    hedgePolicy: hedgePolicyFromRows([]),
    markets: [],
    activeGaps: [],
    computedAt: params.computedAt,
  };
}

function hedgePolicyFromRows(
  rows: HedgePolicyRow[]
): WalletAnalysisBenchmark["hedgePolicy"] {
  const row = rows[0];
  return {
    minTargetHedgeRatio: AS_BUILT_MIN_TARGET_HEDGE_RATIO,
    minTargetHedgeUsdc: AS_BUILT_MIN_TARGET_HEDGE_USDC,
    targetHedgedConditions: Number(
      toNumber(row?.target_hedged_conditions).toFixed(0)
    ),
    targetHedgesPassingGate: Number(
      toNumber(row?.target_hedges_passing_gate).toFixed(0)
    ),
    lowestPassingHedgeRatio: nullableNumber(row?.lowest_passing_hedge_ratio),
  };
}

async function readSummary(
  db: Db,
  targetWalletId: string,
  comparisonWalletId: string | null,
  windowStartIso: string
): Promise<SummaryRow[]> {
  return (await db.execute(sql`
    WITH latest_positions AS (
      SELECT DISTINCT ON (p.trader_wallet_id, p.condition_id, p.token_id)
        p.trader_wallet_id,
        p.current_value_usdc::numeric AS current_value_usdc,
        w.kind
      FROM poly_trader_current_positions p
      JOIN poly_trader_wallets w ON w.id = p.trader_wallet_id
      WHERE ${liveCurrentPositionSql("p")}
      ORDER BY p.trader_wallet_id, p.condition_id, p.token_id, p.last_observed_at DESC
    )
      SELECT
        COALESCE(SUM(current_value_usdc) FILTER (WHERE trader_wallet_id = ${targetWalletId}), 0) AS target_open_value_usdc,
        COALESCE(SUM(current_value_usdc) FILTER (WHERE trader_wallet_id = ${comparisonWalletId}), 0) AS cogni_open_value_usdc,
        (SELECT COUNT(*) FROM poly_trader_fills WHERE trader_wallet_id = ${targetWalletId} AND observed_at >= ${windowStartIso}::timestamptz) AS target_trades,
        (SELECT COUNT(*) FROM poly_trader_fills WHERE trader_wallet_id = ${comparisonWalletId} AND observed_at >= ${windowStartIso}::timestamptz) AS cogni_trades
      FROM latest_positions
  `)) as unknown as SummaryRow[];
}

async function readMarketRows(
  db: Db,
  targetWalletId: string,
  comparisonWalletId: string | null,
  windowStartIso: string
): Promise<BenchmarkMarketRow[]> {
  return (await db.execute(sql`
    WITH target AS (
      SELECT
        condition_id,
        token_id,
        SUM(size_usdc::numeric) AS size_usdc,
        SUM(shares::numeric) AS shares,
        SUM(size_usdc::numeric) / NULLIF(SUM(shares::numeric), 0) AS vwap
      FROM poly_trader_fills
      WHERE trader_wallet_id = ${targetWalletId}
        AND observed_at >= ${windowStartIso}::timestamptz
      GROUP BY condition_id, token_id
    ),
    cogni AS (
      SELECT
        f.condition_id,
        f.token_id,
        SUM(f.size_usdc::numeric) AS size_usdc,
        SUM(f.shares::numeric) AS shares,
        SUM(f.size_usdc::numeric) / NULLIF(SUM(f.shares::numeric), 0) AS vwap
      FROM poly_trader_fills f
      WHERE f.trader_wallet_id = ${comparisonWalletId}
        AND f.observed_at >= ${windowStartIso}::timestamptz
      GROUP BY f.condition_id, f.token_id
    )
    SELECT
      target.condition_id,
      target.token_id,
      target.vwap AS target_vwap,
      cogni.vwap AS cogni_vwap,
      target.size_usdc AS target_size_usdc,
      COALESCE(cogni.size_usdc, 0) AS cogni_size_usdc
    FROM target
    LEFT JOIN cogni ON cogni.condition_id = target.condition_id
      AND cogni.token_id = target.token_id
    ORDER BY target.size_usdc DESC
    LIMIT 100
  `)) as unknown as BenchmarkMarketRow[];
}

async function readActiveGaps(
  db: Db,
  targetWalletId: string,
  comparisonWalletId: string | null
): Promise<ActiveGapRow[]> {
  return (await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (p.trader_wallet_id, p.condition_id, p.token_id)
        p.trader_wallet_id,
        p.condition_id,
        p.token_id,
        p.current_value_usdc::numeric AS current_value_usdc,
        w.kind
      FROM poly_trader_current_positions p
      JOIN poly_trader_wallets w ON w.id = p.trader_wallet_id
      WHERE ${liveCurrentPositionSql("p")}
      ORDER BY p.trader_wallet_id, p.condition_id, p.token_id, p.last_observed_at DESC
    ),
    cogni AS (
      SELECT condition_id, token_id, SUM(current_value_usdc) AS current_value_usdc
      FROM latest
      WHERE trader_wallet_id = ${comparisonWalletId}
      GROUP BY condition_id, token_id
    )
    SELECT
      target.condition_id,
      target.token_id,
      target.current_value_usdc AS target_current_value_usdc
    FROM latest target
    LEFT JOIN cogni ON cogni.condition_id = target.condition_id
      AND cogni.token_id = target.token_id
    WHERE target.trader_wallet_id = ${targetWalletId}
      AND target.current_value_usdc >= 5
      AND COALESCE(cogni.current_value_usdc, 0) < 1
    ORDER BY target.current_value_usdc DESC
    LIMIT 50
  `)) as unknown as ActiveGapRow[];
}

async function readHedgePolicyRows(
  db: Db,
  targetWalletId: string
): Promise<HedgePolicyRow[]> {
  return (await db.execute(sql`
    WITH active_target AS (
      SELECT
        p.condition_id,
        p.token_id,
        p.cost_basis_usdc::numeric AS cost_basis_usdc
      FROM poly_trader_current_positions p
      WHERE p.trader_wallet_id = ${targetWalletId}
        AND ${liveCurrentPositionSql("p")}
        AND p.cost_basis_usdc > 0
    ),
    binary_conditions AS (
      SELECT
        condition_id,
        COUNT(*) AS legs,
        MAX(cost_basis_usdc) AS primary_cost_usdc,
        MIN(cost_basis_usdc) AS hedge_cost_usdc
      FROM active_target
      GROUP BY condition_id
      HAVING COUNT(*) = 2
    )
    SELECT
      COUNT(*) AS target_hedged_conditions,
      COUNT(*) FILTER (
        WHERE hedge_cost_usdc >= ${AS_BUILT_MIN_TARGET_HEDGE_USDC}
          AND hedge_cost_usdc / NULLIF(primary_cost_usdc, 0) >= ${AS_BUILT_MIN_TARGET_HEDGE_RATIO}
      ) AS target_hedges_passing_gate,
      MIN(hedge_cost_usdc / NULLIF(primary_cost_usdc, 0)) FILTER (
        WHERE hedge_cost_usdc >= ${AS_BUILT_MIN_TARGET_HEDGE_USDC}
          AND hedge_cost_usdc / NULLIF(primary_cost_usdc, 0) >= ${AS_BUILT_MIN_TARGET_HEDGE_RATIO}
      ) AS lowest_passing_hedge_ratio
    FROM binary_conditions
  `)) as unknown as HedgePolicyRow[];
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

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function nullableNumber(
  value: string | number | null | undefined
): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
