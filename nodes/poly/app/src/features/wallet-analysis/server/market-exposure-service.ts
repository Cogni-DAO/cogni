// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/market-exposure-service`
 * Purpose: Build the dashboard market aggregation read model from our live
 *   execution positions plus observed active copy-target current positions,
 *   pivoted into one row per (wallet, conditionId) with a primary leg + an
 *   optional hedge leg + a `net` summary, plus the rate-gap / size-scaled-gap
 *   pair that drives the alpha-leak sort.
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
 *   - RETURN_FROM_FILLS: per-position return is computed Modified-Dietz-style
 *     from `poly_trader_fills` (BUY notional + SELL realized cash) when
 *     available, falling back to position-derived cost basis for our wallet
 *     when no fills row exists yet. Targets always use fills (always observed).
 *   - GAP_NULL_WITHOUT_TARGETS: `rateGapPct` and `sizeScaledGapUsdc` are null
 *     on lines/groups with zero target legs that have positive buy notional.
 *     "Edge gap vs. nobody" is undefined, not `-ourPnl`.
 *   - SIGN_TARGET_MINUS_US: `rateGapPct = targetReturnPct − ourReturnPct`;
 *     positive = target ahead = alpha leaking from us. Default sort
 *     descending by `sizeScaledGapUsdc` puts the worst leak on top.
 * Side-effects: DB read across `poly_copy_trade_targets`,
 *   `poly_trader_wallets`, `poly_trader_position_snapshots`,
 *   `poly_trader_fills`. No upstream Polymarket calls.
 * Links: docs/design/poly-markets-aggregation-redesign.md,
 *        docs/design/poly-hedge-followup-policy.md
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

import {
  blendTargetReturns,
  edgeGap,
  positionReturnPct,
} from "./market-return-math";

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

type FillRollup = {
  totalBuyNotional: number;
  realizedCash: number;
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
  const conditions = [...new Set(ourLegs.map((leg) => leg.conditionId))];
  const targetLegs = await readTargetLegs({
    db: params.db,
    billingAccountId: params.billingAccountId,
    conditions,
  });
  const allLegs = [...ourLegs, ...targetLegs];
  const wallets = [...new Set(allLegs.map((leg) => leg.walletAddress))];
  const rollups = await readFillRollups({
    db: params.db,
    conditions,
    walletAddresses: wallets,
  });

  return groupParticipants(allLegs, rollups);
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
  legs: readonly RawLeg[],
  rollups: ReadonlyMap<string, FillRollup>
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
    /** Our combined buy notional on this line; weight for group blending. */
    ourTotalBuyNotional: number;
    /** Combined target buy notional across ALL targets on this line. */
    targetTotalBuyNotional: number;
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
    const participants = pivotParticipants(conditionLegs, rollups);
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
    const targetLegs = conditionLegs.filter(
      (leg) => leg.side === "copy_target"
    );
    const ourValueUsdc = roundMoney(sumValue(ourLegs));
    const targetValueUsdc = roundMoney(sumValue(targetLegs));

    // Our side: aggregate fill rollups across all our legs in this condition.
    // RETURN_FROM_FILLS — fall back to position-derived cost basis when no
    // fills row exists yet (fresh wallet not yet observed).
    const ourAgg = aggregateWalletReturn(ourLegs, rollups, true);
    const ourReturnPct = positionReturnPct({
      totalBuyNotional: ourAgg.totalBuyNotional,
      realizedCash: ourAgg.realizedCash,
      currentMarkValue: ourAgg.currentMarkValue,
    });

    // Target side: per-target return, then cost-basis-weighted blend.
    const byTargetWallet = new Map<string, RawLeg[]>();
    for (const leg of targetLegs) {
      const list = byTargetWallet.get(leg.walletAddress) ?? [];
      list.push(leg);
      byTargetWallet.set(leg.walletAddress, list);
    }
    const targetEntries: {
      totalBuyNotional: number;
      returnPct: number | null;
    }[] = [];
    for (const tlegs of byTargetWallet.values()) {
      const agg = aggregateWalletReturn(tlegs, rollups, false);
      targetEntries.push({
        totalBuyNotional: agg.totalBuyNotional,
        returnPct: positionReturnPct({
          totalBuyNotional: agg.totalBuyNotional,
          realizedCash: agg.realizedCash,
          currentMarkValue: agg.currentMarkValue,
        }),
      });
    }
    const targetReturnPct = blendTargetReturns(targetEntries);
    const targetTotalBuyNotional = targetEntries.reduce(
      (sum, e) => sum + e.totalBuyNotional,
      0
    );

    const { rateGapPct, sizeScaledGapUsdc } = edgeGap({
      ourReturnPct,
      targetReturnPct,
      ourTotalBuyNotional: ourAgg.totalBuyNotional,
    });

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
      targetVwap: weightedVwap(targetLegs),
      ourReturnPct,
      targetReturnPct,
      rateGapPct,
      sizeScaledGapUsdc,
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
    bucket.lines.push({
      line,
      ourTotalBuyNotional: ourAgg.totalBuyNotional,
      targetTotalBuyNotional,
    });
    groupBuckets.set(groupKey, bucket);
  }

  return [...groupBuckets.entries()]
    .map(([groupKey, bucket]) => {
      const sorted = [...bucket.lines].sort((left, right) =>
        compareLine(left.line, right.line)
      );
      const groupStatus: WalletExecutionMarketLineStatus = sorted.some(
        (entry) => entry.line.status === "live"
      )
        ? "live"
        : "closed";
      const lines = sorted.map((entry) => entry.line);

      // Group-level metrics: cost-basis-weighted blends of per-line returns,
      // weighted by each line's our (resp. target) buy notional. Mirrors the
      // single-line formula one level up.
      const groupOurReturnPct = blendTargetReturns(
        sorted.map((entry) => ({
          totalBuyNotional: entry.ourTotalBuyNotional,
          returnPct: entry.line.ourReturnPct,
        }))
      );
      const groupTargetReturnPct = blendTargetReturns(
        sorted.map((entry) => ({
          totalBuyNotional: entry.targetTotalBuyNotional,
          returnPct: entry.line.targetReturnPct,
        }))
      );
      const groupOurTotalBuyNotional = sorted.reduce(
        (sum, entry) => sum + entry.ourTotalBuyNotional,
        0
      );
      const groupGap = edgeGap({
        ourReturnPct: groupOurReturnPct,
        targetReturnPct: groupTargetReturnPct,
        ourTotalBuyNotional: groupOurTotalBuyNotional,
      });

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
        ourReturnPct: groupOurReturnPct,
        targetReturnPct: groupTargetReturnPct,
        rateGapPct: groupGap.rateGapPct,
        sizeScaledGapUsdc: groupGap.sizeScaledGapUsdc,
        hedgeCount: lines.reduce((sum, line) => sum + line.hedgeCount, 0),
        lines,
      };
    })
    .sort((left, right) => {
      // Default sort: largest alpha leak first. Null gaps sort last so
      // unmatched markets don't crowd the head.
      const lv = left.sizeScaledGapUsdc;
      const rv = right.sizeScaledGapUsdc;
      if (lv === null && rv === null) {
        return right.ourValueUsdc - left.ourValueUsdc;
      }
      if (lv === null) return 1;
      if (rv === null) return -1;
      return rv - lv;
    });
}

/**
 * Sum (totalBuyNotional, realizedCash, currentMarkValue) across a wallet's
 * legs in one condition. `useFallback=true` (our wallet) substitutes the
 * leg's `costBasisUsdc` for `totalBuyNotional` when the rollup row is missing
 * — covers the "wallet not observed yet" early state. Targets always rely
 * on observed fills; missing rollups → zero notional → null returnPct.
 */
function aggregateWalletReturn(
  legs: readonly RawLeg[],
  rollups: ReadonlyMap<string, FillRollup>,
  useFallback: boolean
): {
  totalBuyNotional: number;
  realizedCash: number;
  currentMarkValue: number;
} {
  if (legs.length === 0) {
    return { totalBuyNotional: 0, realizedCash: 0, currentMarkValue: 0 };
  }
  // Per (wallet, condition) — every leg in this set shares both keys.
  const first = legs[0];
  if (first === undefined) {
    return { totalBuyNotional: 0, realizedCash: 0, currentMarkValue: 0 };
  }
  const key = rollupKey(first.walletAddress, first.conditionId);
  const rollup = rollups.get(key);
  const currentMarkValue = legs.reduce(
    (sum, leg) => sum + leg.currentValueUsdc,
    0
  );
  if (rollup !== undefined) {
    return {
      totalBuyNotional: rollup.totalBuyNotional,
      realizedCash: rollup.realizedCash,
      currentMarkValue,
    };
  }
  if (!useFallback) {
    return {
      totalBuyNotional: 0,
      realizedCash: 0,
      currentMarkValue,
    };
  }
  // Fallback: derive from the snapshot/position-side cost basis we already
  // built into RawLeg. Sum of legs.costBasisUsdc approximates totalBuyNotional
  // for positions that haven't been partial-closed; partial-close cases will
  // converge once fills are observed.
  return {
    totalBuyNotional: legs.reduce((sum, leg) => sum + leg.costBasisUsdc, 0),
    realizedCash: 0,
    currentMarkValue,
  };
}

// Per-condition: pivot one row per (wallet) with primary + optional hedge legs.
// Hedge classification: when a wallet holds two legs of one condition, the
// smaller cost-basis leg is the hedge; the other is primary. Singletons go to
// primary with hedge=null.
function pivotParticipants(
  legs: readonly RawLeg[],
  rollups: ReadonlyMap<string, FillRollup>
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

    // Per-participant round-trip return on this condition. Same formula
    // as the line-level `ourReturnPct` / `targetReturnPct`. Surfaces a
    // winner-loser split when the line's blended `targetReturnPct`
    // averages two divergent targets.
    const useFallback = anchor.side === "our_wallet";
    const agg = aggregateWalletReturn(walletLegs, rollups, useFallback);
    const roundTripReturnPct = positionReturnPct({
      totalBuyNotional: agg.totalBuyNotional,
      realizedCash: agg.realizedCash,
      currentMarkValue: agg.currentMarkValue,
    });

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
        roundTripReturnPct,
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

function rollupKey(walletAddress: string, conditionId: string): string {
  return `${walletAddress.toLowerCase()}:${conditionId}`;
}

/**
 * Aggregate `(totalBuyNotional, realizedCash)` per `(wallet, condition)`
 * from `poly_trader_fills`, joined to `poly_trader_wallets` so the caller
 * can supply wallet addresses (lowercased) without needing trader-wallet
 * UUIDs. Bounded SQL aggregation per data-research skill — V8 hydrates one
 * row per (wallet, condition), never raw fills.
 */
async function readFillRollups(params: {
  db: Db;
  conditions: readonly string[];
  walletAddresses: readonly string[];
}): Promise<Map<string, FillRollup>> {
  if (params.conditions.length === 0 || params.walletAddresses.length === 0) {
    return new Map();
  }
  const conditionList = sql.join(
    params.conditions.map((c) => sql`${c}`),
    sql`, `
  );
  const walletList = sql.join(
    params.walletAddresses.map((w) => sql`${w.toLowerCase()}`),
    sql`, `
  );
  const rows = (await params.db.execute(sql`
    SELECT
      lower(w.wallet_address) AS wallet_address,
      f.condition_id,
      COALESCE(SUM(f.size_usdc) FILTER (WHERE f.side = 'BUY'), 0)::numeric
        AS total_buy_notional,
      COALESCE(SUM(f.size_usdc) FILTER (WHERE f.side = 'SELL'), 0)::numeric
        AS realized_cash
    FROM poly_trader_fills f
    JOIN poly_trader_wallets w ON w.id = f.trader_wallet_id
    WHERE f.condition_id IN (${conditionList})
      AND lower(w.wallet_address) IN (${walletList})
    GROUP BY lower(w.wallet_address), f.condition_id
  `)) as unknown as ReadonlyArray<{
    wallet_address: string | null;
    condition_id: string | null;
    total_buy_notional: string | number | null;
    realized_cash: string | number | null;
  }>;
  const out = new Map<string, FillRollup>();
  for (const row of rows) {
    if (row.wallet_address === null || row.condition_id === null) continue;
    out.set(rollupKey(row.wallet_address, row.condition_id), {
      totalBuyNotional: toNumber(row.total_buy_notional),
      realizedCash: toNumber(row.realized_cash),
    });
  }
  return out;
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
