// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/market-exposure-service`
 * Purpose: Build the dashboard market aggregation read model from our live
 *   execution positions plus observed active copy-target current positions,
 *   pivoted into one row per (wallet, conditionId) with a primary leg + an
 *   optional hedge leg + a `net` summary.
 * Scope: Feature service. Caller injects DB and already-fetched live positions.
 *   No upstream Polymarket calls.
 * Invariants:
 *   - OUR_POSITIONS_ANCHOR_GROUPS: only markets/events where the caller holds a
 *     live position are returned.
 *   - HEDGE_IS_RELATIVE_POSITION: a hedge is the smaller cost-basis leg of a
 *     two-token active condition for one wallet, not a persisted flag.
 *   - SERVER_SIDE_PIVOT: per-participant primary/hedge/net shape is computed
 *     here, never client-side. Same shape will feed Research views once
 *     `poly_market_outcomes` is populated.
 *   - LIFECYCLE_DEFAULTS_UNKNOWN: leg `lifecycle` is `unknown` until the
 *     outcomes backfill (handoff item #4) lands; the join slot is reserved.
 * Side-effects: DB read for copy-target current positions.
 * Links: docs/design/poly-dashboard-market-aggregation.md,
 *        docs/design/poly-hedge-followup-policy.md,
 *        .context/market-aggregation-research-handoff.md
 * @internal
 */

import type {
  WalletExecutionMarketGroup,
  WalletExecutionMarketLeg,
  WalletExecutionMarketParticipantRow,
  WalletExecutionPosition,
} from "@cogni/poly-node-contracts";
import { type SQL, sql } from "drizzle-orm";

type Db = {
  execute(query: SQL): Promise<unknown>;
};

type ParticipantSide = WalletExecutionMarketParticipantRow["side"];
type ParticipantSource = WalletExecutionMarketParticipantRow["source"];

type RawLeg = {
  side: ParticipantSide;
  source: ParticipantSource;
  label: string;
  walletAddress: string;
  conditionId: string;
  tokenId: string;
  marketTitle: string;
  eventTitle: string | null;
  marketSlug: string | null;
  eventSlug: string | null;
  outcome: string;
  shares: number;
  costBasisUsdc: number;
  currentValueUsdc: number;
  vwap: number | null;
  avgPrice: number | null;
  lifecycle: WalletExecutionMarketLeg["lifecycle"];
  lastObservedAt: string | null;
};

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
  last_observed_at: Date | string | null;
};

export async function buildMarketExposureGroups(params: {
  db: Db;
  billingAccountId: string;
  walletAddress: string;
  livePositions: readonly WalletExecutionPosition[];
}): Promise<WalletExecutionMarketGroup[]> {
  if (params.livePositions.length === 0) return [];

  const ourLegs = buildOurLegs(params.livePositions, params.walletAddress);
  const targetLegs = await readTargetLegs({
    db: params.db,
    billingAccountId: params.billingAccountId,
    conditions: [...new Set(ourLegs.map((leg) => leg.conditionId))],
  });

  return groupParticipants([...ourLegs, ...targetLegs]);
}

function buildOurLegs(
  positions: readonly WalletExecutionPosition[],
  walletAddress: string
): RawLeg[] {
  return positions.map((position) => {
    const costBasisUsdc = costBasisFromExecutionPosition(position);
    const vwap = position.entryPrice > 0 ? position.entryPrice : null;
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
      vwap,
      avgPrice: vwap,
      lifecycle: "active",
      lastObservedAt: position.openedAt,
    };
  });
}

async function readTargetLegs(params: {
  db: Db;
  billingAccountId: string;
  conditions: readonly string[];
}): Promise<RawLeg[]> {
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
    )
    SELECT
      a.wallet_address,
      a.label,
      p.condition_id,
      p.token_id,
      COALESCE(NULLIF(p.raw->>'title', ''), 'Polymarket') AS market_title,
      NULLIF(p.raw->>'eventTitle', '') AS event_title,
      NULLIF(p.raw->>'slug', '') AS market_slug,
      NULLIF(p.raw->>'eventSlug', '') AS event_slug,
      COALESCE(NULLIF(p.raw->>'outcome', ''), 'UNKNOWN') AS outcome,
      p.shares::numeric AS shares,
      p.cost_basis_usdc::numeric AS cost_basis_usdc,
      p.current_value_usdc::numeric AS current_value_usdc,
      p.avg_price::numeric AS avg_price,
      p.last_observed_at
    FROM poly_trader_current_positions p
    JOIN active_targets a ON a.trader_wallet_id = p.trader_wallet_id
    WHERE p.active = true
      AND p.current_value_usdc > 0
      AND p.condition_id IN (${conditionList})
    ORDER BY p.current_value_usdc DESC
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
        side: "copy_target",
        source: "trader_current_positions",
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
        lifecycle: "active" as const,
        lastObservedAt: isoOrNull(row.last_observed_at),
      },
    ];
  });
}

function groupParticipants(
  legs: readonly RawLeg[]
): WalletExecutionMarketGroup[] {
  const byCondition = new Map<string, RawLeg[]>();
  for (const leg of legs) {
    const list = byCondition.get(leg.conditionId) ?? [];
    list.push(leg);
    byCondition.set(leg.conditionId, list);
  }

  const groupBuckets = new Map<
    string,
    {
      eventTitle: string | null;
      eventSlug: string | null;
      lines: WalletExecutionMarketGroup["lines"];
    }
  >();

  for (const [conditionId, conditionLegs] of byCondition.entries()) {
    const participants = pivotParticipants(conditionLegs);
    const anchor = pickAnchor(conditionLegs);
    if (anchor === null) continue;
    const eventSlug =
      conditionLegs.find((leg) => leg.eventSlug !== null)?.eventSlug ?? null;
    const eventTitle =
      conditionLegs.find((leg) => leg.eventTitle !== null)?.eventTitle ?? null;
    const groupKey = eventSlug
      ? `event:${eventSlug}`
      : `condition:${conditionId}`;

    const ourValueUsdc = roundMoney(
      sumValueBySide(conditionLegs, "our_wallet")
    );
    const targetValueUsdc = roundMoney(
      sumValueBySide(conditionLegs, "copy_target")
    );

    const line = {
      conditionId,
      marketTitle: anchor.marketTitle,
      marketSlug: anchor.marketSlug,
      resolvesAt: null,
      ourValueUsdc,
      targetValueUsdc,
      ourVwap: weightedVwap(
        conditionLegs.filter((leg) => leg.side === "our_wallet")
      ),
      targetVwap: weightedVwap(
        conditionLegs.filter((leg) => leg.side === "copy_target")
      ),
      hedgeCount: participants.filter((p) => p.hedge !== null).length,
      participants,
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
              line.participants
                .filter((p) => p.side === "our_wallet")
                .reduce((rowSum, p) => rowSum + p.net.pnlUsdc, 0),
            0
          )
        ),
        hedgeCount: lines.reduce((sum, line) => sum + line.hedgeCount, 0),
        lines,
      };
    })
    .sort((left, right) => right.ourValueUsdc - left.ourValueUsdc);
}

// Per-condition: pivot one row per (wallet) with primary + optional hedge legs.
// Hedge classification: when a wallet holds two legs of one condition, the
// smaller cost-basis leg is the hedge; the other is primary. Singletons go to
// primary with hedge=null.
function pivotParticipants(
  legs: readonly RawLeg[]
): WalletExecutionMarketParticipantRow[] {
  const byWallet = new Map<string, RawLeg[]>();
  for (const leg of legs) {
    const key = leg.walletAddress;
    const list = byWallet.get(key) ?? [];
    list.push(leg);
    byWallet.set(key, list);
  }

  const rows: WalletExecutionMarketParticipantRow[] = [];
  for (const [walletAddress, walletLegs] of byWallet.entries()) {
    const primaryLeg = pickPrimary(walletLegs);
    if (primaryLeg === null) continue;
    const hedgeLeg =
      walletLegs.length === 2 ? pickHedge(walletLegs, primaryLeg) : null;
    const anchor = primaryLeg;

    const primary = toContractLeg(primaryLeg);
    const hedge = hedgeLeg ? toContractLeg(hedgeLeg) : null;

    const lastObservedAt =
      [primaryLeg.lastObservedAt, hedgeLeg?.lastObservedAt ?? null]
        .filter((value): value is string => value !== null)
        .sort()
        .pop() ?? null;

    rows.push({
      side: anchor.side,
      source: anchor.source,
      label: anchor.label,
      walletAddress,
      conditionId: anchor.conditionId,
      primary,
      hedge,
      net: {
        currentValueUsdc: roundMoney(
          (primary?.currentValueUsdc ?? 0) + (hedge?.currentValueUsdc ?? 0)
        ),
        costBasisUsdc: roundMoney(
          (primary?.costBasisUsdc ?? 0) + (hedge?.costBasisUsdc ?? 0)
        ),
        pnlUsdc: roundMoney((primary?.pnlUsdc ?? 0) + (hedge?.pnlUsdc ?? 0)),
      },
      lastObservedAt,
    });
  }

  return rows.sort(compareParticipantRow);
}

function toContractLeg(leg: RawLeg): WalletExecutionMarketLeg {
  return {
    tokenId: leg.tokenId,
    outcome: leg.outcome,
    shares: leg.shares,
    currentValueUsdc: roundMoney(leg.currentValueUsdc),
    costBasisUsdc: roundMoney(leg.costBasisUsdc),
    vwap: leg.vwap,
    pnlUsdc: roundMoney(leg.currentValueUsdc - leg.costBasisUsdc),
    lifecycle: leg.lifecycle,
  };
}

function pickPrimary(legs: readonly RawLeg[]): RawLeg | null {
  // Larger cost-basis leg is primary; deterministic tiebreak by tokenId.
  return (
    [...legs].sort((left, right) =>
      left.costBasisUsdc === right.costBasisUsdc
        ? right.tokenId.localeCompare(left.tokenId)
        : right.costBasisUsdc - left.costBasisUsdc
    )[0] ?? null
  );
}

function pickHedge(legs: readonly RawLeg[], primary: RawLeg): RawLeg | null {
  const others = legs.filter((leg) => leg.tokenId !== primary.tokenId);
  return others[0] ?? null;
}

function pickAnchor(legs: readonly RawLeg[]): RawLeg | null {
  return legs.find((leg) => leg.side === "our_wallet") ?? legs[0] ?? null;
}

function sumValueBySide(
  legs: readonly RawLeg[],
  side: ParticipantSide
): number {
  return legs
    .filter((leg) => leg.side === side)
    .reduce((sum, leg) => sum + leg.currentValueUsdc, 0);
}

function compareParticipantRow(
  left: WalletExecutionMarketParticipantRow,
  right: WalletExecutionMarketParticipantRow
): number {
  if (left.side !== right.side) return left.side === "our_wallet" ? -1 : 1;
  return (
    right.net.currentValueUsdc - left.net.currentValueUsdc ||
    left.label.localeCompare(right.label) ||
    left.walletAddress.localeCompare(right.walletAddress)
  );
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

function costBasisFromExecutionPosition(
  position: WalletExecutionPosition
): number {
  return roundMoney(Math.max(0, position.currentValue - position.pnlUsd));
}

function weightedVwap(legs: readonly RawLeg[]): number | null {
  const withVwap = legs.filter((leg) => leg.vwap !== null && leg.shares > 0);
  const shares = withVwap.reduce((sum, leg) => sum + leg.shares, 0);
  if (shares <= 0) return null;
  return roundPrice(
    withVwap.reduce((sum, leg) => sum + (leg.vwap ?? 0) * leg.shares, 0) /
      shares
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
