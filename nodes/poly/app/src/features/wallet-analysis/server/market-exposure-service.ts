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
 *   - SNAPSHOTS_ARE_DURABLE_TRUTH: target legs are read from
 *     `poly_trader_position_snapshots` (append-only history) rather than
 *     `poly_trader_current_positions`, because the sync deactivates and zeros
 *     out target rows once Polymarket Data API stops returning a position
 *     (post-resolution / post-redeem). Snapshots preserve the last observed
 *     `(shares, cost_basis_usdc, current_value_usdc)` so attribution survives
 *     target exit by any means.
 *   - TARGET_LEGS_FROM_SNAPSHOTS: every active copy-target whose latest
 *     snapshot covers a condition we hold surfaces as a leg, regardless of
 *     whether we've mirrored a fill from that target on that condition. The
 *     "Markets" lens compares us against the targets we follow — gating on
 *     per-condition fills throws away DB-persisted positions and produces
 *     bogus solo-market percentages.
 *   - SERVER_SIDE_LIFECYCLE: a leg's lifecycle is `"active"` if the latest
 *     snapshot still shows positive current value, otherwise `"inactive"`
 *     (target observed but no longer held). Once `poly_market_outcomes` is
 *     populated, resolved legs get joined in to promote `active`/`inactive`
 *     → `winner`/`loser`/`resolved`.
 *   - EDGE_GAP_NULL_WITHOUT_TARGETS: `edgeGapUsdc` and `edgeGapPct` are null
 *     on lines/groups with zero target legs. "How much we beat (nobody) by"
 *     is undefined, not `-ourPnl`.
 * Side-effects: DB read across `poly_copy_trade_targets`,
 *   `poly_trader_wallets`, `poly_trader_position_snapshots`. No upstream
 *   Polymarket calls.
 * Links: docs/design/poly-dashboard-market-aggregation.md,
 *        docs/design/poly-hedge-followup-policy.md,
 *        .context/market-aggregation-research-handoff.md
 * @internal
 */

import type {
  WalletExecutionMarketGroup,
  WalletExecutionMarketLeg,
  WalletExecutionMarketLineStatus,
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
  /**
   * Status of the originating position when `side === "our_wallet"`.
   * `null` for `copy_target` legs (they have no caller-position concept).
   */
  ourPositionStatus: WalletExecutionMarketLineStatus | null;
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
  lifecycle: string | null;
};

export async function buildMarketExposureGroups(params: {
  db: Db;
  billingAccountId: string;
  walletAddress: string;
  livePositions: readonly WalletExecutionPosition[];
  closedPositions?: readonly WalletExecutionPosition[];
}): Promise<WalletExecutionMarketGroup[]> {
  const closedPositions = params.closedPositions ?? [];
  if (params.livePositions.length === 0 && closedPositions.length === 0) {
    return [];
  }

  const ourLegs = [
    ...buildOurLegs(params.livePositions, params.walletAddress, "live"),
    ...buildOurLegs(closedPositions, params.walletAddress, "closed"),
  ];
  const targetLegs = await readTargetLegs({
    db: params.db,
    billingAccountId: params.billingAccountId,
    conditions: [...new Set(ourLegs.map((leg) => leg.conditionId))],
  });

  return groupParticipants([...ourLegs, ...targetLegs]);
}

function buildOurLegs(
  positions: readonly WalletExecutionPosition[],
  walletAddress: string,
  ourPositionStatus: WalletExecutionMarketLineStatus
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
      lifecycle: ourPositionStatus === "closed" ? "inactive" : "active",
      lastObservedAt: position.openedAt,
      ourPositionStatus,
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
    ),
    latest_snapshots AS (
      SELECT DISTINCT ON (s.trader_wallet_id, s.condition_id, s.token_id)
        s.trader_wallet_id,
        s.condition_id,
        s.token_id,
        s.shares::numeric AS shares,
        s.cost_basis_usdc::numeric AS cost_basis_usdc,
        s.current_value_usdc::numeric AS current_value_usdc,
        s.avg_price::numeric AS avg_price,
        s.captured_at AS last_observed_at,
        s.raw
      FROM poly_trader_position_snapshots s
      WHERE s.condition_id IN (${conditionList})
        AND s.trader_wallet_id IN (SELECT trader_wallet_id FROM active_targets)
      ORDER BY s.trader_wallet_id, s.condition_id, s.token_id, s.captured_at DESC
    )
    SELECT
      a.wallet_address,
      a.label,
      ls.condition_id,
      ls.token_id,
      -- Canonical Gamma metadata via poly_market_metadata; fall back to
      -- legacy raw->>… JSONB scrape so the first deploy (empty metadata
      -- table) does not regress. Drop the fallback once the metadata
      -- table is fully backfilled.
      COALESCE(
        NULLIF(pmm.market_title, ''),
        NULLIF(ls.raw->>'title', ''),
        'Polymarket'
      ) AS market_title,
      COALESCE(
        NULLIF(pmm.event_title, ''),
        NULLIF(ls.raw->>'eventTitle', '')
      ) AS event_title,
      COALESCE(
        NULLIF(pmm.market_slug, ''),
        NULLIF(ls.raw->>'slug', '')
      ) AS market_slug,
      COALESCE(
        NULLIF(pmm.event_slug, ''),
        NULLIF(ls.raw->>'eventSlug', '')
      ) AS event_slug,
      COALESCE(NULLIF(ls.raw->>'outcome', ''), 'UNKNOWN') AS outcome,
      ls.shares,
      ls.cost_basis_usdc,
      ls.current_value_usdc,
      ls.avg_price,
      ls.last_observed_at,
      CASE WHEN ls.current_value_usdc > 0 THEN 'active' ELSE 'inactive' END
        AS lifecycle
    FROM latest_snapshots ls
    JOIN active_targets a ON a.trader_wallet_id = ls.trader_wallet_id
    LEFT JOIN poly_market_metadata pmm
      ON pmm.condition_id = ls.condition_id
    ORDER BY ls.current_value_usdc DESC NULLS LAST
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
    const lifecycle: WalletExecutionMarketLeg["lifecycle"] =
      row.lifecycle === "inactive" ? "inactive" : "active";
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
        lifecycle,
        lastObservedAt: isoOrNull(row.last_observed_at),
        ourPositionStatus: null,
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

  type Line = WalletExecutionMarketGroup["lines"][number];
  type LineWithMeta = {
    line: Line;
    ourCostBasisUsdc: number;
    hasTargetLeg: boolean;
  };

  const groupBuckets = new Map<
    string,
    {
      eventTitle: string | null;
      eventSlug: string | null;
      lines: LineWithMeta[];
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

    const ourLegs = conditionLegs.filter((leg) => leg.side === "our_wallet");
    const targetLegsForLine = conditionLegs.filter(
      (leg) => leg.side === "copy_target"
    );
    const ourValueUsdc = roundMoney(sumValue(ourLegs));
    const targetValueUsdc = roundMoney(sumValue(targetLegsForLine));
    const ourPnlUsdc = sumPnl(ourLegs);
    const targetPnlUsdc = sumPnl(targetLegsForLine);
    const ourCostBasisUsdc = sumCostBasis(ourLegs);
    const hasTargetLeg = targetLegsForLine.length > 0;
    // EDGE_GAP_NULL_WITHOUT_TARGETS: comparing our P/L to nobody is undefined.
    const edgeGapUsdc = hasTargetLeg
      ? roundMoney(targetPnlUsdc - ourPnlUsdc)
      : null;
    const edgeGapPct =
      edgeGapUsdc === null ? null : pctOrNull(edgeGapUsdc, ourCostBasisUsdc);
    const lineStatus: WalletExecutionMarketLineStatus = ourLegs.some(
      (leg) => leg.ourPositionStatus === "live"
    )
      ? "live"
      : "closed";

    const line: Line = {
      conditionId,
      marketTitle: anchor.marketTitle,
      marketSlug: anchor.marketSlug,
      resolvesAt: null,
      status: lineStatus,
      ourValueUsdc,
      targetValueUsdc,
      ourVwap: weightedVwap(ourLegs),
      targetVwap: weightedVwap(targetLegsForLine),
      edgeGapUsdc,
      edgeGapPct,
      hedgeCount: participants.filter((p) => p.hedge !== null).length,
      participants,
    };

    const bucket = groupBuckets.get(groupKey) ?? {
      eventTitle,
      eventSlug,
      lines: [] as LineWithMeta[],
    };
    if (bucket.eventTitle === null && eventTitle !== null) {
      bucket.eventTitle = eventTitle;
    }
    bucket.lines.push({ line, ourCostBasisUsdc, hasTargetLeg });
    groupBuckets.set(groupKey, bucket);
  }

  return [...groupBuckets.entries()]
    .map(([groupKey, bucket]) => {
      const sorted = [...bucket.lines].sort((left, right) =>
        compareLine(left.line, right.line)
      );
      const groupHasTarget = sorted.some((entry) => entry.hasTargetLeg);
      // Sum cost basis only for lines that contribute to the gap, so the
      // percentage denominator matches the numerator.
      const groupOurCostBasis = sorted
        .filter((entry) => entry.hasTargetLeg)
        .reduce((sum, entry) => sum + entry.ourCostBasisUsdc, 0);
      const groupEdgeGapUsdc = groupHasTarget
        ? roundMoney(
            sorted.reduce(
              (sum, entry) => sum + (entry.line.edgeGapUsdc ?? 0),
              0
            )
          )
        : null;
      const groupStatus: WalletExecutionMarketLineStatus = sorted.some(
        (entry) => entry.line.status === "live"
      )
        ? "live"
        : "closed";
      const lines = sorted.map((entry) => entry.line);
      return {
        groupKey,
        eventTitle: bucket.eventTitle,
        eventSlug: bucket.eventSlug,
        marketCount: lines.length,
        status: groupStatus,
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
        edgeGapUsdc: groupEdgeGapUsdc,
        edgeGapPct:
          groupEdgeGapUsdc === null
            ? null
            : pctOrNull(groupEdgeGapUsdc, groupOurCostBasis),
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
    // Map guarantees ≥1 leg per entry; null is unreachable but the lint rule
    // forbids non-null assertions.
    if (primaryLeg === null) continue;
    // Polymarket binary markets are the v0 norm; this still handles N≥3
    // (multi-outcome markets, or stale active=true rows) by taking the next
    // largest cost-basis leg as hedge so we never silently drop exposure.
    const hedgeLeg =
      walletLegs.length >= 2 ? pickHedge(walletLegs, primaryLeg) : null;
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
  // Next-largest cost-basis leg becomes hedge. Deterministic tiebreak by
  // tokenId so re-renders are stable when two non-primary legs tie.
  const others = [...legs]
    .filter((leg) => leg.tokenId !== primary.tokenId)
    .sort((left, right) =>
      left.costBasisUsdc === right.costBasisUsdc
        ? right.tokenId.localeCompare(left.tokenId)
        : right.costBasisUsdc - left.costBasisUsdc
    );
  return others[0] ?? null;
}

function pickAnchor(legs: readonly RawLeg[]): RawLeg | null {
  return legs.find((leg) => leg.side === "our_wallet") ?? legs[0] ?? null;
}

function sumValue(legs: readonly RawLeg[]): number {
  return legs.reduce((sum, leg) => sum + leg.currentValueUsdc, 0);
}

function sumPnl(legs: readonly RawLeg[]): number {
  return legs.reduce(
    (sum, leg) => sum + (leg.currentValueUsdc - leg.costBasisUsdc),
    0
  );
}

function sumCostBasis(legs: readonly RawLeg[]): number {
  return legs.reduce((sum, leg) => sum + leg.costBasisUsdc, 0);
}

function pctOrNull(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
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
