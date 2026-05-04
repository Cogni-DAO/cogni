// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/market-exposure-service`
 * Purpose: Build the dashboard market aggregation read model from our live
 *   execution positions plus observed active copy-target current positions.
 * Scope: Feature service. Caller injects DB and already-fetched live positions.
 *   No upstream Polymarket calls.
 * Invariants:
 *   - OUR_POSITIONS_ANCHOR_GROUPS: only markets/events where the caller holds a
 *     live position are returned.
 *   - HEDGE_IS_RELATIVE_POSITION: a hedge is the smaller cost-basis leg of a
 *     two-token active condition for one wallet, not a persisted flag.
 * Side-effects: DB read for copy-target current positions.
 * Links: docs/design/poly-dashboard-balance-and-positions.md,
 *        docs/design/poly-hedge-followup-policy.md
 * @internal
 */

import type {
  WalletExecutionMarketGroup,
  WalletExecutionMarketParticipantPosition,
  WalletExecutionPosition,
} from "@cogni/poly-node-contracts";
import { type SQL, sql } from "drizzle-orm";

type Db = {
  execute(query: SQL): Promise<unknown>;
};

type HedgeRole = WalletExecutionMarketParticipantPosition["hedgeRole"];

type TargetPositionRow = {
  wallet_address: string | null;
  label: string | null;
  condition_id: string | null;
  token_id: string | null;
  market_title: string | null;
  event_title: string | null;
  market_slug: string | null;
  event_slug: string | null;
  outcome: string | null;
  shares: string | number | null;
  cost_basis_usdc: string | number | null;
  current_value_usdc: string | number | null;
  avg_price: string | number | null;
  hedge_role: HedgeRole | null;
  last_observed_at: Date | string | null;
};

export async function buildMarketExposureGroups(params: {
  db: Db;
  billingAccountId: string;
  walletAddress: string;
  livePositions: readonly WalletExecutionPosition[];
}): Promise<WalletExecutionMarketGroup[]> {
  if (params.livePositions.length === 0) return [];

  const ourPositions = buildOurMarketPositions(
    params.livePositions,
    params.walletAddress
  );
  const targetPositions = await readTargetMarketPositions({
    db: params.db,
    billingAccountId: params.billingAccountId,
    conditions: [...new Set(ourPositions.map((p) => p.conditionId))],
  });

  return groupMarketPositions([...ourPositions, ...targetPositions]);
}

function buildOurMarketPositions(
  positions: readonly WalletExecutionPosition[],
  walletAddress: string
): WalletExecutionMarketParticipantPosition[] {
  const roles = hedgeRolesByCondition(
    positions.map((position) => ({
      conditionId: position.conditionId,
      tokenId: position.asset,
      costBasisUsdc: costBasisFromExecutionPosition(position),
    }))
  );

  return positions.map((position) => {
    const costBasisUsdc = costBasisFromExecutionPosition(position);
    return {
      side: "our_wallet",
      source: "ledger",
      label: "Our wallet",
      walletAddress: walletAddress.toLowerCase(),
      conditionId: position.conditionId,
      tokenId: position.asset,
      marketTitle: position.marketTitle,
      eventTitle: position.eventTitle ?? null,
      marketSlug: position.marketSlug ?? null,
      eventSlug: position.eventSlug ?? null,
      outcome: position.outcome,
      shares: position.size,
      costBasisUsdc,
      currentValueUsdc: position.currentValue,
      vwap: position.entryPrice > 0 ? position.entryPrice : null,
      avgPrice: position.entryPrice > 0 ? position.entryPrice : null,
      hedgeRole:
        roles.get(`${position.conditionId}:${position.asset}`) ?? "single",
      lastObservedAt: position.openedAt,
    };
  });
}

async function readTargetMarketPositions(params: {
  db: Db;
  billingAccountId: string;
  conditions: readonly string[];
}): Promise<WalletExecutionMarketParticipantPosition[]> {
  if (params.conditions.length === 0) return [];

  const conditionList = sql.join(
    params.conditions.map((condition) => sql`${condition}`),
    sql`, `
  );
  const rows = (await params.db.execute(sql`
    WITH active_targets AS (
      SELECT
        lower(t.target_wallet) AS wallet_address,
        w.id AS trader_wallet_id,
        COALESCE(NULLIF(w.label, ''), 'Copy target') AS label
      FROM poly_copy_trade_targets t
      JOIN poly_trader_wallets w ON lower(w.wallet_address) = lower(t.target_wallet)
      WHERE t.billing_account_id = ${params.billingAccountId}
        AND t.disabled_at IS NULL
        AND w.disabled_at IS NULL
    ),
    target_positions AS (
      SELECT
        a.wallet_address,
        a.label,
        p.trader_wallet_id,
        p.condition_id,
        p.token_id,
        p.shares::numeric AS shares,
        p.cost_basis_usdc::numeric AS cost_basis_usdc,
        p.current_value_usdc::numeric AS current_value_usdc,
        p.avg_price::numeric AS avg_price,
        p.last_observed_at,
        COALESCE(NULLIF(p.raw->>'title', ''), 'Polymarket') AS market_title,
        NULLIF(p.raw->>'eventTitle', '') AS event_title,
        NULLIF(p.raw->>'slug', '') AS market_slug,
        NULLIF(p.raw->>'eventSlug', '') AS event_slug,
        COALESCE(NULLIF(p.raw->>'outcome', ''), 'UNKNOWN') AS outcome
      FROM poly_trader_current_positions p
      JOIN active_targets a ON a.trader_wallet_id = p.trader_wallet_id
      WHERE p.active = true
        AND p.current_value_usdc > 0
        AND p.condition_id IN (${conditionList})
    ),
    ranked AS (
      SELECT
        p.*,
        COUNT(*) OVER (
          PARTITION BY p.trader_wallet_id, p.condition_id
        ) AS active_legs,
        ROW_NUMBER() OVER (
          PARTITION BY p.trader_wallet_id, p.condition_id
          ORDER BY p.cost_basis_usdc ASC, p.token_id ASC
        ) AS cost_rank
      FROM target_positions p
    )
    SELECT
      wallet_address,
      label,
      condition_id,
      token_id,
      market_title,
      event_title,
      market_slug,
      event_slug,
      outcome,
      shares,
      cost_basis_usdc,
      current_value_usdc,
      avg_price,
      CASE
        WHEN active_legs = 2 AND cost_rank = 1 THEN 'hedge'
        WHEN active_legs = 2 THEN 'primary'
        ELSE 'single'
      END AS hedge_role,
      last_observed_at
    FROM ranked
    ORDER BY current_value_usdc DESC
  `)) as unknown as TargetPositionRow[];

  return rows.flatMap((row) => {
    if (
      row.wallet_address === null ||
      row.condition_id === null ||
      row.token_id === null
    ) {
      return [];
    }

    const shares = toNumber(row.shares);
    const costBasisUsdc = toNumber(row.cost_basis_usdc);
    const avgPrice = nullableNumber(row.avg_price);

    return [
      {
        side: "copy_target" as const,
        source: "trader_current_positions" as const,
        label: row.label ?? "Copy target",
        walletAddress: row.wallet_address.toLowerCase(),
        conditionId: row.condition_id,
        tokenId: row.token_id,
        marketTitle: row.market_title ?? "Polymarket",
        eventTitle: row.event_title,
        marketSlug: row.market_slug,
        eventSlug: row.event_slug,
        outcome: row.outcome ?? "UNKNOWN",
        shares,
        costBasisUsdc,
        currentValueUsdc: toNumber(row.current_value_usdc),
        vwap: positionVwap(costBasisUsdc, shares, avgPrice),
        avgPrice,
        hedgeRole: row.hedge_role ?? "single",
        lastObservedAt: isoOrNull(row.last_observed_at),
      },
    ];
  });
}

function groupMarketPositions(
  positions: readonly WalletExecutionMarketParticipantPosition[]
): WalletExecutionMarketGroup[] {
  const linesByCondition = new Map<
    string,
    WalletExecutionMarketParticipantPosition[]
  >();
  for (const position of positions) {
    const existing = linesByCondition.get(position.conditionId) ?? [];
    existing.push(position);
    linesByCondition.set(position.conditionId, existing);
  }

  const groupBuckets = new Map<
    string,
    {
      eventTitle: string | null;
      eventSlug: string | null;
      lines: WalletExecutionMarketGroup["lines"];
    }
  >();

  for (const [conditionId, linePositions] of linesByCondition.entries()) {
    const anchor = pickAnchorPosition(linePositions);
    const eventSlug =
      linePositions.find((position) => position.eventSlug !== null)
        ?.eventSlug ?? null;
    const eventTitle =
      linePositions.find((position) => position.eventTitle !== null)
        ?.eventTitle ?? null;
    const groupKey = eventSlug
      ? `event:${eventSlug}`
      : `condition:${conditionId}`;
    const line = {
      conditionId,
      marketTitle: anchor.marketTitle,
      marketSlug: anchor.marketSlug,
      resolvesAt: null,
      ourValueUsdc: roundMoney(sumSide(linePositions, "our_wallet")),
      targetValueUsdc: roundMoney(sumSide(linePositions, "copy_target")),
      ourVwap: weightedVwap(
        linePositions.filter((position) => position.side === "our_wallet")
      ),
      targetVwap: weightedVwap(
        linePositions.filter((position) => position.side === "copy_target")
      ),
      hedgeCount: linePositions.filter(
        (position) => position.hedgeRole === "hedge"
      ).length,
      positions: [...linePositions].sort(compareParticipantPosition),
    };
    const bucket = groupBuckets.get(groupKey) ?? {
      eventTitle,
      eventSlug,
      lines: [],
    };
    if (bucket.eventTitle === null && eventTitle !== null) {
      bucket.eventTitle = eventTitle;
    }
    bucket.lines.push(line);
    groupBuckets.set(groupKey, bucket);
  }

  return [...groupBuckets.entries()]
    .map(([groupKey, bucket]) => {
      const lines = bucket.lines.sort(compareLine);
      return {
        groupKey,
        eventTitle: bucket.eventTitle,
        eventSlug: bucket.eventSlug,
        marketCount: lines.length,
        ourValueUsdc: roundMoney(
          lines.reduce((sum, line) => sum + line.ourValueUsdc, 0)
        ),
        targetValueUsdc: roundMoney(
          lines.reduce((sum, line) => sum + line.targetValueUsdc, 0)
        ),
        pnlUsd: roundMoney(
          lines.reduce(
            (sum, line) =>
              sum +
              line.positions
                .filter((position) => position.side === "our_wallet")
                .reduce(
                  (lineSum, position) =>
                    lineSum +
                    (position.currentValueUsdc - position.costBasisUsdc),
                  0
                ),
            0
          )
        ),
        hedgeCount: lines.reduce((sum, line) => sum + line.hedgeCount, 0),
        lines,
      };
    })
    .sort((left, right) => right.ourValueUsdc - left.ourValueUsdc);
}

type HedgeInput = {
  conditionId: string;
  tokenId: string;
  costBasisUsdc: number;
};

function hedgeRolesByCondition(
  positions: readonly HedgeInput[]
): Map<string, HedgeRole> {
  const grouped = new Map<string, HedgeInput[]>();
  for (const position of positions) {
    const existing = grouped.get(position.conditionId) ?? [];
    grouped.set(position.conditionId, [...existing, position]);
  }
  const roles = new Map<string, HedgeRole>();
  for (const [conditionId, conditionPositions] of grouped.entries()) {
    if (conditionPositions.length !== 2) {
      for (const position of conditionPositions) {
        roles.set(`${conditionId}:${position.tokenId}`, "single");
      }
      continue;
    }
    const sorted = [...conditionPositions].sort((left, right) =>
      left.costBasisUsdc === right.costBasisUsdc
        ? left.tokenId.localeCompare(right.tokenId)
        : left.costBasisUsdc - right.costBasisUsdc
    );
    const [hedge, primary] = sorted;
    if (!hedge || !primary) continue;
    roles.set(`${conditionId}:${hedge.tokenId}`, "hedge");
    roles.set(`${conditionId}:${primary.tokenId}`, "primary");
  }
  return roles;
}

function pickAnchorPosition(
  positions: readonly WalletExecutionMarketParticipantPosition[]
): WalletExecutionMarketParticipantPosition {
  return (
    positions.find((position) => position.side === "our_wallet") ??
    positions[0] ??
    fallbackPosition
  );
}

const fallbackPosition: WalletExecutionMarketParticipantPosition = {
  side: "our_wallet",
  source: "ledger",
  label: "Our wallet",
  walletAddress: "0x0000000000000000000000000000000000000000",
  conditionId: "unknown",
  tokenId: "unknown",
  marketTitle: "Polymarket",
  eventTitle: null,
  marketSlug: null,
  eventSlug: null,
  outcome: "UNKNOWN",
  shares: 0,
  costBasisUsdc: 0,
  currentValueUsdc: 0,
  vwap: null,
  avgPrice: null,
  hedgeRole: "single",
  lastObservedAt: null,
};

function costBasisFromExecutionPosition(
  position: WalletExecutionPosition
): number {
  return roundMoney(Math.max(0, position.currentValue - position.pnlUsd));
}

function weightedVwap(
  positions: readonly WalletExecutionMarketParticipantPosition[]
): number | null {
  const withVwap = positions.filter(
    (position) => position.vwap !== null && position.shares > 0
  );
  const shares = withVwap.reduce((sum, position) => sum + position.shares, 0);
  if (shares <= 0) return null;
  return roundPrice(
    withVwap.reduce(
      (sum, position) => sum + (position.vwap ?? 0) * position.shares,
      0
    ) / shares
  );
}

function sumSide(
  positions: readonly WalletExecutionMarketParticipantPosition[],
  side: WalletExecutionMarketParticipantPosition["side"]
): number {
  return positions
    .filter((position) => position.side === side)
    .reduce((sum, position) => sum + position.currentValueUsdc, 0);
}

function compareLine(
  left: WalletExecutionMarketGroup["lines"][number],
  right: WalletExecutionMarketGroup["lines"][number]
): number {
  return (
    right.ourValueUsdc - left.ourValueUsdc ||
    right.targetValueUsdc - left.targetValueUsdc ||
    left.marketTitle.localeCompare(right.marketTitle)
  );
}

function compareParticipantPosition(
  left: WalletExecutionMarketParticipantPosition,
  right: WalletExecutionMarketParticipantPosition
): number {
  if (left.side !== right.side) return left.side === "our_wallet" ? -1 : 1;
  return (
    right.currentValueUsdc - left.currentValueUsdc ||
    left.label.localeCompare(right.label) ||
    left.outcome.localeCompare(right.outcome)
  );
}

function isoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(
  value: string | number | null | undefined
): number | null {
  const parsed = toNumber(value);
  return parsed > 0 ? parsed : null;
}

function positionVwap(
  costBasisUsdc: number,
  shares: number,
  fallback: number | null
): number | null {
  if (costBasisUsdc > 0 && shares > 0) {
    return roundPrice(costBasisUsdc / shares);
  }
  return fallback;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPrice(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
