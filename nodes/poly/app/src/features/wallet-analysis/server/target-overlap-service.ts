// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/target-overlap-service`
 * Purpose: Aggregate saved RN1/swisstony current positions and fill volume into
 * a shared-vs-solo market research slice.
 * Scope: Read-only service. Caller injects DB; this module does not fetch
 * upstream Polymarket APIs.
 * Invariants:
 *   - ACTIVE_POSITIONS_DEFINE_OVERLAP: a market is shared when both wallets
 *     currently have any active saved position for the same condition_id.
 *   - SOLO_BUCKET_METRICS_ARE_OWNER_ONLY: RN1-only and swisstony-only buckets
 *     aggregate fill volume only for the wallet that currently owns the bucket.
 *   - WINDOW_ONLY_APPLIES_TO_VOLUME: active value and PnL are current-position
 *     facts; fill volume is filtered by the selected interval.
 *   - PNL_FROM_VENDOR_CASHPNL: per-position PnL reads Polymarket's authoritative
 *     `cashPnl` from the persisted `/positions` payload (`raw->>'cashPnl'`).
 *     On a fresh position (no realized fills), this matches the prior
 *     `currentValue - costBasis` derivation; the invariant exists to make the
 *     vendor field the source of truth so any future divergence (Polymarket
 *     redefining cashPnl, stale row drift) does not silently mis-aggregate.
 *     COALESCE retains the prior derivation as a defensive fallback when `raw`
 *     is null or lacks `cashPnl`.
 *   - FRESH_OBSERVATION_ONLY: aggregations exclude rows whose
 *     `last_observed_at` is older than `STALE_POSITION_TTL` (6h). Phantom
 *     rows accumulate when /positions pagination caps out for big wallets
 *     and the writer skips its complete-only deactivation path
 *     (trader-observation-service.ts:656-658). Filtering at read-time keeps
 *     the bucket honest without depending on the writer being fixed
 *     (bug.5025 owns the upstream fix). A wallet whose observation tick has
 *     stalled for >6h reports zero counts here — preferable to summing
 *     stale frozen values.
 * Side-effects: DB reads only.
 * Links: docs/design/poly-copy-target-performance-benchmark.md, work/items/task.5005
 * @public
 */

import { polyTraderWallets } from "@cogni/poly-db-schema/trader-activity";
import type {
  PolyResearchTargetOverlapBucket,
  PolyResearchTargetOverlapPolicy,
  PolyResearchTargetOverlapResponse,
  PolyWalletOverviewInterval,
} from "@cogni/poly-node-contracts";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

type Db =
  | NodePgDatabase<Record<string, unknown>>
  | PostgresJsDatabase<Record<string, unknown>>;

const STALE_POSITION_TTL = "6 hours";

const RN1 = {
  label: "RN1" as const,
  address: "0x2005d16a84ceefa912d4e380cd32e7ff827875ea",
};
const SWISSTONY = {
  label: "swisstony" as const,
  address: "0x204f72f35326db932158cba6adff0b9a1da95e14",
};

type BucketKey = PolyResearchTargetOverlapBucket["key"];

type OverlapAggRow = {
  bucket: BucketKey;
  market_count: string | number | null;
  position_count: string | number | null;
  current_value_usdc: string | number | null;
  cost_basis_usdc: string | number | null;
  pnl_usdc: string | number | null;
  fill_volume_usdc: string | number | null;
  rn1_market_count: string | number | null;
  rn1_position_count: string | number | null;
  rn1_current_value_usdc: string | number | null;
  rn1_pnl_usdc: string | number | null;
  rn1_fill_volume_usdc: string | number | null;
  swisstony_market_count: string | number | null;
  swisstony_position_count: string | number | null;
  swisstony_current_value_usdc: string | number | null;
  swisstony_pnl_usdc: string | number | null;
  swisstony_fill_volume_usdc: string | number | null;
};

export async function getTargetOverlapSlice(
  db: Db,
  interval: PolyWalletOverviewInterval
): Promise<PolyResearchTargetOverlapResponse> {
  const [rn1, swisstony] = await Promise.all([
    readWalletId(db, RN1.address),
    readWalletId(db, SWISSTONY.address),
  ]);
  const windowStartIso = windowStartFor(interval).toISOString();
  const rows = await readOverlapRows(
    db,
    rn1?.id ?? null,
    swisstony?.id ?? null,
    windowStartIso
  );
  const buckets = buildBuckets(rows);
  return {
    window: interval,
    computedAt: new Date().toISOString(),
    wallets: {
      rn1: { ...RN1, observed: rn1 !== null },
      swisstony: { ...SWISSTONY, observed: swisstony !== null },
    },
    buckets,
    policy: buildTargetOverlapPolicy(buckets),
  };
}

async function readWalletId(
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

async function readOverlapRows(
  db: Db,
  rn1WalletId: string | null,
  swisstonyWalletId: string | null,
  windowStartIso: string
): Promise<OverlapAggRow[]> {
  return (await db.execute(sql`
    WITH current_positions AS (
      SELECT
        CASE
          WHEN p.trader_wallet_id = ${rn1WalletId} THEN 'rn1'
          WHEN p.trader_wallet_id = ${swisstonyWalletId} THEN 'swisstony'
        END AS wallet_key,
        p.condition_id,
        p.token_id,
        p.current_value_usdc::numeric AS current_value_usdc,
        p.cost_basis_usdc::numeric AS cost_basis_usdc,
        COALESCE(
          (p.raw->>'cashPnl')::numeric,
          p.current_value_usdc::numeric - p.cost_basis_usdc::numeric
        ) AS pnl_usdc
      FROM poly_trader_current_positions p
      WHERE p.active = true
        AND p.last_observed_at >= NOW() - INTERVAL '${sql.raw(STALE_POSITION_TTL)}'
        AND p.trader_wallet_id IN (${rn1WalletId}, ${swisstonyWalletId})
    ),
    markets AS (
      SELECT
        condition_id,
        CASE
          WHEN bool_or(wallet_key = 'rn1') AND bool_or(wallet_key = 'swisstony') THEN 'shared'
          WHEN bool_or(wallet_key = 'rn1') THEN 'rn1_only'
          ELSE 'swisstony_only'
        END AS bucket,
        bool_or(wallet_key = 'rn1') AS rn1_active,
        bool_or(wallet_key = 'swisstony') AS swisstony_active,
        COUNT(*) AS position_count,
        COUNT(*) FILTER (WHERE wallet_key = 'rn1') AS rn1_position_count,
        COUNT(*) FILTER (WHERE wallet_key = 'swisstony') AS swisstony_position_count,
        COALESCE(SUM(current_value_usdc), 0) AS current_value_usdc,
        COALESCE(SUM(cost_basis_usdc), 0) AS cost_basis_usdc,
        COALESCE(SUM(pnl_usdc), 0) AS pnl_usdc,
        COALESCE(SUM(current_value_usdc) FILTER (WHERE wallet_key = 'rn1'), 0) AS rn1_current_value_usdc,
        COALESCE(SUM(pnl_usdc) FILTER (WHERE wallet_key = 'rn1'), 0) AS rn1_pnl_usdc,
        COALESCE(SUM(current_value_usdc) FILTER (WHERE wallet_key = 'swisstony'), 0) AS swisstony_current_value_usdc,
        COALESCE(SUM(pnl_usdc) FILTER (WHERE wallet_key = 'swisstony'), 0) AS swisstony_pnl_usdc
      FROM current_positions
      WHERE wallet_key IS NOT NULL
      GROUP BY condition_id
    ),
    volumes AS (
      SELECT
        m.bucket,
        COALESCE(SUM(f.size_usdc::numeric) FILTER (
          WHERE (m.bucket = 'rn1_only' OR m.bucket = 'shared')
            AND f.trader_wallet_id = ${rn1WalletId}
        ), 0)
        + COALESCE(SUM(f.size_usdc::numeric) FILTER (
          WHERE (m.bucket = 'swisstony_only' OR m.bucket = 'shared')
            AND f.trader_wallet_id = ${swisstonyWalletId}
        ), 0) AS fill_volume_usdc,
        COALESCE(SUM(f.size_usdc::numeric) FILTER (
          WHERE (m.bucket = 'rn1_only' OR m.bucket = 'shared')
            AND f.trader_wallet_id = ${rn1WalletId}
        ), 0) AS rn1_fill_volume_usdc,
        COALESCE(SUM(f.size_usdc::numeric) FILTER (
          WHERE (m.bucket = 'swisstony_only' OR m.bucket = 'shared')
            AND f.trader_wallet_id = ${swisstonyWalletId}
        ), 0) AS swisstony_fill_volume_usdc
      FROM markets m
      JOIN poly_trader_fills f ON f.condition_id = m.condition_id
        AND f.trader_wallet_id IN (${rn1WalletId}, ${swisstonyWalletId})
        AND f.observed_at >= ${windowStartIso}::timestamptz
      GROUP BY m.bucket
    )
    SELECT
      m.bucket,
      COUNT(*) AS market_count,
      COALESCE(SUM(m.position_count), 0) AS position_count,
      COALESCE(SUM(m.current_value_usdc), 0) AS current_value_usdc,
      COALESCE(SUM(m.cost_basis_usdc), 0) AS cost_basis_usdc,
      COALESCE(SUM(m.pnl_usdc), 0) AS pnl_usdc,
      COALESCE(MAX(v.fill_volume_usdc), 0) AS fill_volume_usdc,
      COUNT(*) FILTER (WHERE m.rn1_active) AS rn1_market_count,
      COALESCE(SUM(m.rn1_position_count), 0) AS rn1_position_count,
      COALESCE(SUM(m.rn1_current_value_usdc), 0) AS rn1_current_value_usdc,
      COALESCE(SUM(m.rn1_pnl_usdc), 0) AS rn1_pnl_usdc,
      COALESCE(MAX(v.rn1_fill_volume_usdc), 0) AS rn1_fill_volume_usdc,
      COUNT(*) FILTER (WHERE m.swisstony_active) AS swisstony_market_count,
      COALESCE(SUM(m.swisstony_position_count), 0) AS swisstony_position_count,
      COALESCE(SUM(m.swisstony_current_value_usdc), 0) AS swisstony_current_value_usdc,
      COALESCE(SUM(m.swisstony_pnl_usdc), 0) AS swisstony_pnl_usdc,
      COALESCE(MAX(v.swisstony_fill_volume_usdc), 0) AS swisstony_fill_volume_usdc
    FROM markets m
    LEFT JOIN volumes v ON v.bucket = m.bucket
    GROUP BY m.bucket
  `)) as unknown as OverlapAggRow[];
}

function buildBuckets(
  rows: readonly OverlapAggRow[]
): PolyResearchTargetOverlapBucket[] {
  const byBucket = new Map(rows.map((row) => [row.bucket, row]));
  return (["rn1_only", "shared", "swisstony_only"] as const).map((key) => {
    const row = byBucket.get(key);
    return {
      key,
      label:
        key === "rn1_only"
          ? "RN1 only"
          : key === "shared"
            ? "Shared"
            : "swisstony only",
      marketCount: int(row?.market_count),
      positionCount: int(row?.position_count),
      currentValueUsdc: number(row?.current_value_usdc),
      costBasisUsdc: number(row?.cost_basis_usdc),
      pnlUsdc: number(row?.pnl_usdc),
      fillVolumeUsdc: number(row?.fill_volume_usdc),
      rn1: {
        marketCount: int(row?.rn1_market_count),
        positionCount: int(row?.rn1_position_count),
        currentValueUsdc: number(row?.rn1_current_value_usdc),
        pnlUsdc: number(row?.rn1_pnl_usdc),
        fillVolumeUsdc: number(row?.rn1_fill_volume_usdc),
      },
      swisstony: {
        marketCount: int(row?.swisstony_market_count),
        positionCount: int(row?.swisstony_position_count),
        currentValueUsdc: number(row?.swisstony_current_value_usdc),
        pnlUsdc: number(row?.swisstony_pnl_usdc),
        fillVolumeUsdc: number(row?.swisstony_fill_volume_usdc),
      },
    };
  });
}

export function buildTargetOverlapPolicy(
  buckets: readonly PolyResearchTargetOverlapBucket[]
): PolyResearchTargetOverlapPolicy {
  const shared = buckets.find((bucket) => bucket.key === "shared");
  const solo = buckets.filter((bucket) => bucket.key !== "shared");
  const sharedRate = pnlPerDollar(shared);
  const soloCost = solo.reduce((sum, bucket) => sum + bucket.costBasisUsdc, 0);
  const soloPnl = solo.reduce((sum, bucket) => sum + bucket.pnlUsdc, 0);
  const soloRate = soloCost > 0 ? soloPnl / soloCost : null;
  if (sharedRate === null || soloRate === null) {
    return {
      signal: "insufficient",
      sharedPnlPerDollar: sharedRate,
      soloPnlPerDollar: soloRate,
      note: "Need active shared and solo exposure before policy comparison.",
    };
  }
  if (sharedRate > soloRate) {
    return {
      signal: "shared_outperforms",
      sharedPnlPerDollar: sharedRate,
      soloPnlPerDollar: soloRate,
      note: "Shared active markets are outperforming solo exposure.",
    };
  }
  return {
    signal: "solo_outperforms",
    sharedPnlPerDollar: sharedRate,
    soloPnlPerDollar: soloRate,
    note: "Solo active markets are outperforming shared exposure.",
  };
}

function pnlPerDollar(
  bucket: PolyResearchTargetOverlapBucket | undefined
): number | null {
  if (!bucket || bucket.costBasisUsdc <= 0) return null;
  return bucket.pnlUsdc / bucket.costBasisUsdc;
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

function int(value: string | number | null | undefined): number {
  return Math.round(number(value));
}

function number(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
