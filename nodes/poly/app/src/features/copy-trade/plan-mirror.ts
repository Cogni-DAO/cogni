// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/copy-trade/plan-mirror`
 * Purpose: Pure copy-trade planning function — given a normalized Fill, the target config, and a runtime-state snapshot, return either `place` with a concrete OrderIntent or `skip` with a bounded reason code.
 * Scope: Pure function. Does not perform I/O, does not read env, does not import adapters. All runtime state (idempotency set) is supplied by the caller.
 * Invariants:
 *   - IDEMPOTENT_BY_CLIENT_ID — repeat of the same `(target_id, fill_id)` is silently dropped via `already_placed_ids`. Matches the DB PK on `poly_copy_trade_fills`.
 *   - PLAN_IS_PURE — no side effects; same input → same output.
 *   - CAPS_LIVE_IN_GRANT — daily / hourly USDC caps are enforced downstream by `PolyTraderWalletPort.authorizeIntent` against the tenant's `poly_wallet_grants` row. `planMirrorFromFill` is intentionally unaware of caps so a single cap decision lives in one place (the authorize boundary).
 *   - NO_KILL_SWITCH (bug.0438): there is no per-tenant kill-switch gate. The active-target / active-grant chain in the cross-tenant enumerator is the only gate; an explicit POST of a target IS the user's opt-in.
 * Side-effects: none
 * Links: docs/spec/poly-tenant-and-collateral.md, work/items/task.0318, work/items/task.5005, work/items/bug.5045
 * @public
 */

import {
  normalizeLimitPriceToTick,
  type OrderIntent,
} from "@cogni/poly-market-provider";

import type {
  MirrorPlan,
  MirrorReason,
  PlacementPolicy,
  PlanMirrorInput,
  PositionBranch,
  PositionFollowupPolicy,
  SizingPolicy,
  SizingResult,
  TargetConditionPositionView,
} from "./types";

/**
 * Apply a sizing policy to derive the notional USDC to submit for a mirrored
 * fill. Market-floor math stays in share-space, then projects back to USDC
 * only for accounting. Avoids the float round-trip `min × price / price =
 * min − ε` that re-triggered CLOB's sub-min rejection.
 *
 * Invariant SHARE_SPACE_MATH — returned `size_usdc`, when divided by `price`,
 * yields shares ≥ `minShares` (or `minShares === undefined` → share-space
 * guard skipped for backward compat).
 */
export function applySizingPolicy(
  policy: SizingPolicy,
  price: number,
  targetSizeUsdc: number,
  minShares: number | undefined,
  minUsdcNotional: number | undefined,
  cumulativeIntentForMarket?: number
): SizingResult {
  const sized = sizeFromPolicy(
    policy,
    price,
    targetSizeUsdc,
    minShares,
    minUsdcNotional
  );
  if (!sized.ok) return sized;
  if (
    cumulativeIntentForMarket !== undefined &&
    cumulativeIntentForMarket + sized.size_usdc > policy.max_usdc_per_trade
  ) {
    return { ok: false, reason: "position_cap_reached" };
  }
  return sized;
}

function sizeFromPolicy(
  policy: SizingPolicy,
  price: number,
  targetSizeUsdc: number,
  minShares: number | undefined,
  minUsdcNotional: number | undefined
): SizingResult {
  switch (policy.kind) {
    case "min_bet": {
      return applyMarketFloors(
        minUsdcNotional,
        price,
        minShares,
        minUsdcNotional,
        policy.max_usdc_per_trade
      );
    }
    case "target_percentile": {
      if (targetSizeUsdc < policy.statistic.min_target_usdc) {
        return { ok: false, reason: "below_target_percentile" };
      }
      return applyMarketFloors(
        minUsdcNotional,
        price,
        minShares,
        minUsdcNotional,
        policy.max_usdc_per_trade
      );
    }
    case "target_percentile_scaled": {
      if (targetSizeUsdc < policy.statistic.min_target_usdc) {
        return { ok: false, reason: "below_target_percentile" };
      }
      const floor = applyMarketFloors(
        minUsdcNotional,
        price,
        minShares,
        minUsdcNotional,
        policy.max_usdc_per_trade
      );
      if (!floor.ok) return floor;
      const denominator =
        policy.statistic.max_target_usdc - policy.statistic.min_target_usdc;
      const ratio =
        denominator <= 0
          ? 1
          : Math.min(
              1,
              Math.max(
                0,
                (targetSizeUsdc - policy.statistic.min_target_usdc) /
                  denominator
              )
            );
      const desiredSizeUsdc =
        floor.size_usdc + (policy.max_usdc_per_trade - floor.size_usdc) * ratio;
      return applyMarketFloors(
        desiredSizeUsdc,
        price,
        minShares,
        minUsdcNotional,
        policy.max_usdc_per_trade
      );
    }
  }
}

function applyMarketFloors(
  desiredSizeUsdc: number | undefined,
  price: number,
  minShares: number | undefined,
  minUsdcNotional: number | undefined,
  maxUsdcPerTrade: number
): SizingResult {
  // Fail closed when market constraints are unknown — without minUsdcNotional
  // we have no defensible "min" to bet.
  if (desiredSizeUsdc === undefined || minUsdcNotional === undefined) {
    return { ok: false, reason: "below_market_min" };
  }
  const sharesForUsdcFloor = minUsdcNotional / price;
  const floorShares = Math.max(minShares ?? 0, sharesForUsdcFloor);
  const rawFloorUsdc = floorShares * price;
  // The share×price round-trip (e.g. `1/0.09 * 0.09 = 0.9999…`) can leave
  // floorShares×price a hair below minUsdcNotional. Clamp up so the adapter's
  // own USDC-floor re-check doesn't bounce. bug.0342.
  const floorUsdc =
    rawFloorUsdc < minUsdcNotional ? minUsdcNotional : rawFloorUsdc;
  const size_usdc = Math.min(
    Math.max(desiredSizeUsdc, floorUsdc),
    maxUsdcPerTrade
  );
  if (size_usdc < floorUsdc) {
    return { ok: false, reason: "below_market_min" };
  }
  return { ok: true, size_usdc };
}

/**
 * Translate an observed target fill into a concrete mirror plan.
 *
 * Order of checks (short-circuits on the first skip reason):
 *   1. already placed (PK+cid)        → skip/already_placed
 *   2. market past Gamma `end_date`   → skip/market_past_end_date  (bug.5043)
 *   3. price outside CLOB tick grid   → skip/price_outside_clob_bounds
 *   4. position-followup policy       → skip/place (layer | hedge)
 *   5. sizing below market min        → skip/below_market_min
 *   6. mode === 'paper'               → place (paper adapter)
 *   7. otherwise                      → place (live)
 *
 * Daily / hourly caps are NOT checked here — those live on the tenant's
 * `poly_wallet_grants` row and are enforced by `authorizeIntent` at the
 * executor boundary (CAPS_LIVE_IN_GRANT invariant).
 */
export function planMirrorFromFill(input: PlanMirrorInput): MirrorPlan {
  const {
    fill,
    config,
    state,
    client_order_id,
    min_shares,
    min_usdc_notional,
    tick_size,
    now_ms,
  } = input;

  if (state.already_placed_ids.includes(client_order_id)) {
    return {
      kind: "skip",
      reason: "already_placed",
      position_branch: "new_entry",
    };
  }

  if (now_ms !== undefined && isFillPastMarketEndDate(fill, now_ms)) {
    return {
      kind: "skip",
      reason: "market_past_end_date",
      position_branch: "new_entry",
    };
  }

  const normalizedPrice = tick_size
    ? normalizeLimitPriceToTick(fill.price, tick_size)
    : ({ ok: true, price: fill.price } as const);
  if (!normalizedPrice.ok) {
    return {
      kind: "skip",
      reason: "price_outside_clob_bounds",
      position_branch: "new_entry",
    };
  }

  const planningInput =
    normalizedPrice.price === fill.price
      ? input
      : ({
          ...input,
          fill: { ...fill, price: normalizedPrice.price },
        } as const);

  const decision = decideMirrorBranch(
    planningInput,
    min_shares,
    min_usdc_notional
  );

  if (decision.kind === "skip") {
    return {
      kind: "skip",
      reason: decision.reason,
      position_branch: decision.position_branch,
    };
  }

  // VWAP gate (bug.5048) — applied AFTER branch selection, BEFORE sizing
  // finalization. Fires on every place-bound branch. Fails open when target
  // VWAP for the fill's token is unknown.
  const vwapSkip = applyVwapGate(planningInput);
  if (vwapSkip !== undefined) {
    return {
      kind: "skip",
      reason: vwapSkip,
      position_branch: decision.position_branch,
    };
  }

  if (!decision.sizing.ok) {
    return {
      kind: "skip",
      reason: decision.sizing.reason,
      position_branch: decision.position_branch,
    };
  }

  const intent = buildIntent(
    fill,
    decision.sizing.size_usdc,
    client_order_id,
    config.placement,
    decision.position_branch,
    normalizedPrice.price
  );

  return {
    kind: "place",
    reason: decision.reason,
    position_branch: decision.position_branch,
    intent,
    wrong_side_holding_detected: decision.wrong_side_holding_detected,
  };
}

/**
 * bug.5048 — analyze target's per-condition cost distribution and report
 * whether the incoming fill is on target's minority side. Gate disabled when
 * `threshold` is undefined or target_position is unavailable (fail-open per
 * TARGET_DOMINANCE_FAIL_OPEN_ON_MISSING_DATA).
 */
interface TargetDominanceSignal {
  /** True when threshold + target data are both available and total cost > 0. */
  dominance_known: boolean;
  /** True when gate fired: fill is on target's minority side (fraction < threshold). */
  fill_is_minority: boolean;
  /** Token id with highest cost when dominance_known; else undefined. */
  dominant_token_id: string | undefined;
  /** Fraction of target's total cost on the fill's token, or null when unknown. */
  fill_token_fraction: number | null;
}

export function analyzeTargetDominance(
  targetPosition: TargetConditionPositionView | undefined,
  threshold: number | undefined,
  fillTokenId: string
): TargetDominanceSignal {
  const disabled: TargetDominanceSignal = {
    dominance_known: false,
    fill_is_minority: false,
    dominant_token_id: undefined,
    fill_token_fraction: null,
  };
  if (threshold === undefined || threshold <= 0) return disabled;
  if (
    !targetPosition ||
    targetPosition.tokens.length === 0 ||
    fillTokenId === ""
  ) {
    return disabled;
  }
  let total = 0;
  let fillCost = 0;
  let dominantTokenId: string | undefined;
  let dominantCost = -1;
  for (const t of targetPosition.tokens) {
    total += t.cost_usdc;
    if (t.token_id === fillTokenId) fillCost += t.cost_usdc;
    if (t.cost_usdc > dominantCost) {
      dominantCost = t.cost_usdc;
      dominantTokenId = t.token_id;
    }
  }
  if (total <= 0) return disabled;
  const fraction = fillCost / total;
  return {
    dominance_known: true,
    fill_is_minority: fraction < threshold,
    dominant_token_id: dominantTokenId,
    fill_token_fraction: fraction,
  };
}

/**
 * bug.5048 — target's VWAP on a specific token, derived from
 * `cost_usdc / size_shares`. Returns undefined when shares are zero or token
 * is absent (fail-open semantics).
 */
export function targetVwapForToken(
  targetPosition: TargetConditionPositionView | undefined,
  tokenId: string
): number | undefined {
  if (!targetPosition || tokenId === "") return undefined;
  let cost = 0;
  let shares = 0;
  for (const t of targetPosition.tokens) {
    if (t.token_id === tokenId) {
      cost += t.cost_usdc;
      shares += t.size_shares;
    }
  }
  if (shares <= 0) return undefined;
  return cost / shares;
}

/**
 * bug.5048 — refuse to place above target's average entry on the fill's
 * token. Tolerance is asymmetric (upward only); we are happy to enter below
 * target VWAP. Fail-open when target VWAP is unknown.
 */
function applyVwapGate(
  input: PlanMirrorInput
): "vwap_floor_breach" | undefined {
  const tolerance = input.config.vwap_tolerance;
  if (tolerance === undefined) return undefined;
  const tokenId =
    typeof input.fill.attributes?.asset === "string"
      ? input.fill.attributes.asset
      : "";
  if (tokenId === "") return undefined;
  const vwap = targetVwapForToken(input.state.target_position, tokenId);
  if (vwap === undefined) return undefined;
  if (input.fill.price > vwap + tolerance) return "vwap_floor_breach";
  return undefined;
}

/**
 * bug.5048 — single entry-point branch decision. Replaces the legacy
 * `applyPositionFollowupPolicy` which selected branches off OUR position
 * first. Now: target's dominant side drives the routing, our position is
 * downstream.
 *
 * Modes:
 *   1. Dominance routing (when `config.min_target_side_fraction` is set AND
 *      target_position is available with non-zero total cost). Implements the
 *      bug.5048 branch table.
 *   2. Legacy our-position routing (fallback). Preserves existing tests that
 *      did not configure the dominance gate. fill on `our_token_id` → layer;
 *      fill on `opposite_token_id` → hedge; else → new_entry.
 *
 * Invariants: TARGET_DOMINANCE_DRIVES_BRANCH (when enabled),
 * OPTION_C_TOLERATES_MULTI_TARGET, MIRROR_REASON_BOUNDED, PLANNER_IS_PURE.
 */
type BranchDecision =
  | { kind: "skip"; reason: MirrorReason; position_branch: PositionBranch }
  | {
      kind: "place";
      reason: "ok" | "mode_paper" | "layer_scale_in" | "hedge_followup";
      position_branch: PositionBranch;
      sizing: SizingResult;
      wrong_side_holding_detected: boolean;
    };

function decideMirrorBranch(
  input: PlanMirrorInput,
  minShares: number | undefined,
  minUsdcNotional: number | undefined
): BranchDecision {
  const { fill, config, state } = input;
  const fillTokenId =
    typeof fill.attributes?.asset === "string" ? fill.attributes.asset : "";

  const dominance = analyzeTargetDominance(
    state.target_position,
    config.min_target_side_fraction,
    fillTokenId
  );

  // Gate: skip when fill is on target's minority side, regardless of our
  // position state. Catches both no-mirror-yet AND wrong-side-mirror cases.
  if (dominance.fill_is_minority) {
    return {
      kind: "skip",
      reason: "target_dominant_other_side",
      position_branch: "new_entry",
    };
  }

  const position = state.position;
  const ourTokenId = position?.our_token_id;
  const oppositeTokenId = position?.opposite_token_id;
  const followup = config.position_followup;

  let isLayer = false;
  let isHedge = false;
  let wrong_side_holding_detected = false;

  if (dominance.dominance_known && dominance.dominant_token_id !== undefined) {
    // Dominance-driven routing (bug.5048).
    const fillIsOnDominant = fillTokenId === dominance.dominant_token_id;
    if (fillIsOnDominant) {
      if (ourTokenId === dominance.dominant_token_id) {
        isLayer = true;
      } else if (
        ourTokenId !== undefined &&
        ourTokenId !== dominance.dominant_token_id
      ) {
        // OPTION_C_TOLERATES_MULTI_TARGET — wallet holds a non-dominant side
        // from cross-target activity. Ignore the wrong-side leg for routing;
        // open the dominant-side parallel leg. Pipeline emits a counter +
        // WARN log when this flag fires.
        wrong_side_holding_detected = true;
      }
    } else {
      // Fill not on dominant; not minority either (gate filtered above).
      // Happens in multi-outcome (e.g. 50/30/20 fill on 30% token with
      // threshold 0.20) or binary 50/50. Route by our-position match.
      isLayer = ourTokenId !== undefined && fillTokenId === ourTokenId;
      isHedge =
        oppositeTokenId !== undefined && fillTokenId === oppositeTokenId;
    }
  } else {
    // Legacy our-position routing (threshold unset or no target data).
    isLayer = ourTokenId !== undefined && fillTokenId === ourTokenId;
    isHedge = oppositeTokenId !== undefined && fillTokenId === oppositeTokenId;
  }

  // Layer/Hedge branches require position_followup AND BUY-side. Without
  // either, fall through to new_entry — matches legacy fall-through.
  if (
    isLayer &&
    followup?.enabled &&
    fill.side === "BUY" &&
    position !== undefined
  ) {
    return {
      kind: "place",
      reason: "layer_scale_in",
      position_branch: "layer",
      sizing: sizeLayerDominant(input, followup, minShares, minUsdcNotional),
      wrong_side_holding_detected,
    };
  }
  if (
    isHedge &&
    followup?.enabled &&
    fill.side === "BUY" &&
    position?.our_token_id !== undefined
  ) {
    return {
      kind: "place",
      reason: "hedge_followup",
      position_branch: "hedge",
      sizing: sizeHedge(input, followup, minShares, minUsdcNotional),
      wrong_side_holding_detected,
    };
  }

  // New entry path.
  return {
    kind: "place",
    reason: config.mode === "paper" ? "mode_paper" : "ok",
    position_branch: "new_entry",
    sizing: applySizingPolicy(
      config.sizing,
      fill.price,
      targetSizingUsdcForFill(fill, state, config.sizing),
      minShares,
      minUsdcNotional,
      state.cumulative_intent_usdc_for_market
    ),
    wrong_side_holding_detected,
  };
}

/**
 * Layer-branch sizing — verbatim extraction of the layer body from the legacy
 * `applyPositionFollowupPolicy`. Preserves the inherited gates:
 * `min_mirror_position_usdc` + `market_floor_multiple` (via
 * `effectiveMinPositionUsdc`), `max_layer_fraction_of_position`, and the
 * `targetFollowupThreshold` check on the fill's token.
 */
function sizeLayerDominant(
  input: PlanMirrorInput,
  followup: PositionFollowupPolicy,
  minShares: number | undefined,
  minUsdcNotional: number | undefined
): SizingResult {
  const { fill, state, config } = input;
  const position = state.position;
  if (!position) {
    return { ok: false, reason: "followup_position_too_small" };
  }
  const mirrorExposureUsdc = mirrorExposureUsdcForBranch(
    position.our_qty_shares,
    position.our_vwap_usdc,
    fill.price
  );
  const minPositionUsdc = effectiveMinPositionUsdc(followup, minUsdcNotional);
  if (mirrorExposureUsdc < minPositionUsdc) {
    return { ok: false, reason: "followup_position_too_small" };
  }
  const tokenId =
    typeof fill.attributes?.asset === "string" ? fill.attributes.asset : "";
  const targetThreshold = targetFollowupThreshold(config.sizing);
  const targetBranchCost = targetTokenCostUsdc(state.target_position, tokenId);
  if (targetBranchCost < targetThreshold) {
    return { ok: false, reason: "target_position_below_threshold" };
  }
  return applyFollowupSizing({
    policy: config.sizing,
    price: fill.price,
    desiredSizeUsdc: minUsdcNotional,
    maxFollowupUsdc:
      mirrorExposureUsdc * followup.max_layer_fraction_of_position,
    minShares,
    minUsdcNotional,
    cumulativeIntentForMarket: state.cumulative_intent_usdc_for_market,
  });
}

/**
 * Hedge-branch sizing — verbatim extraction of the hedge body from the legacy
 * `applyPositionFollowupPolicy`. Preserves the inherited gates: shared
 * `min_mirror_position_usdc` + market-floor floor, `targetFollowupThreshold`,
 * `min_target_hedge_usdc`, `min_target_hedge_ratio`, desired-delta positivity,
 * and `max_hedge_fraction_of_position`.
 */
function sizeHedge(
  input: PlanMirrorInput,
  followup: PositionFollowupPolicy,
  minShares: number | undefined,
  minUsdcNotional: number | undefined
): SizingResult {
  const { fill, state, config } = input;
  const position = state.position;
  if (!position?.our_token_id) {
    return { ok: false, reason: "followup_position_too_small" };
  }
  const mirrorExposureUsdc = mirrorExposureUsdcForBranch(
    position.our_qty_shares,
    position.our_vwap_usdc,
    fill.price
  );
  const minPositionUsdc = effectiveMinPositionUsdc(followup, minUsdcNotional);
  if (mirrorExposureUsdc < minPositionUsdc) {
    return { ok: false, reason: "followup_position_too_small" };
  }
  const tokenId =
    typeof fill.attributes?.asset === "string" ? fill.attributes.asset : "";
  const targetThreshold = targetFollowupThreshold(config.sizing);
  const targetHedgeCost = targetTokenCostUsdc(state.target_position, tokenId);
  if (targetHedgeCost < targetThreshold) {
    return { ok: false, reason: "target_position_below_threshold" };
  }
  if (targetHedgeCost < followup.min_target_hedge_usdc) {
    return { ok: false, reason: "target_position_below_threshold" };
  }
  const targetPrimaryCost = targetTokenCostUsdc(
    state.target_position,
    position.our_token_id
  );
  const targetHedgeRatio =
    targetPrimaryCost > 0 ? targetHedgeCost / targetPrimaryCost : 0;
  if (targetHedgeRatio < followup.min_target_hedge_ratio) {
    return { ok: false, reason: "target_position_below_threshold" };
  }
  const existingHedgeUsdc = position.opposite_qty_shares * fill.price;
  const desiredHedgeUsdc = mirrorExposureUsdc * targetHedgeRatio;
  const desiredDeltaUsdc = desiredHedgeUsdc - existingHedgeUsdc;
  if (desiredDeltaUsdc <= 0) {
    return { ok: false, reason: "followup_not_needed" };
  }
  return applyFollowupSizing({
    policy: config.sizing,
    price: fill.price,
    desiredSizeUsdc: desiredDeltaUsdc,
    maxFollowupUsdc:
      mirrorExposureUsdc * followup.max_hedge_fraction_of_position,
    minShares,
    minUsdcNotional,
    cumulativeIntentForMarket: state.cumulative_intent_usdc_for_market,
  });
}

function targetSizingUsdcForFill(
  fill: PlanMirrorInput["fill"],
  state: PlanMirrorInput["state"],
  policy: SizingPolicy
): number {
  if (policy.kind === "min_bet") return fill.size_usdc;
  const tokenId =
    typeof fill.attributes?.asset === "string" ? fill.attributes.asset : "";
  return targetTokenCostUsdc(state.target_position, tokenId);
}

function mirrorExposureUsdcForBranch(
  shares: number,
  vwap: number | undefined,
  fillPrice: number
): number {
  return shares * (vwap ?? fillPrice);
}

function effectiveMinPositionUsdc(
  policy: PositionFollowupPolicy,
  minUsdcNotional: number | undefined
): number {
  const marketFloorMin =
    minUsdcNotional === undefined
      ? 0
      : minUsdcNotional * policy.market_floor_multiple;
  return Math.max(policy.min_mirror_position_usdc, marketFloorMin);
}

function targetFollowupThreshold(policy: SizingPolicy): number {
  switch (policy.kind) {
    case "target_percentile":
    case "target_percentile_scaled":
      return policy.statistic.min_target_usdc;
    case "min_bet":
      return 0;
  }
}

/**
 * Gamma's market `endDate` (carried verbatim on `fill.attributes.end_date` per
 * the Data-API normalizer) is the scheduled close time. Mirroring a BUY past
 * that point spends real USDC on a near-dead market. Defensive: an absent or
 * unparseable `end_date` short-circuits to `false` so we never drop a fill due
 * to a missing field.
 *
 * Caveat: catches the case where the chain settles AFTER scheduled close, not
 * the inverse. Markets that resolve early (sports markets settle when the
 * game ends, often days before the Gamma-scheduled midnight-UTC close) are
 * NOT caught here — those need a `poly_market_outcomes.resolved_at` join at
 * snapshot time. Production telemetry (last 14d): ~78% of buys-past-resolution
 * are caught by this gate; the remaining 22% are concentrated on markets that
 * resolved ~6 days before their scheduled end_date.
 */
function isFillPastMarketEndDate(
  fill: PlanMirrorInput["fill"],
  nowMs: number
): boolean {
  const raw = fill.attributes?.end_date;
  if (typeof raw !== "string" || raw.length === 0) return false;
  const endMs = Date.parse(raw);
  if (!Number.isFinite(endMs)) return false;
  return nowMs >= endMs;
}

function targetTokenCostUsdc(
  targetPosition: TargetConditionPositionView | undefined,
  tokenId: string | undefined
): number {
  if (!targetPosition || !tokenId) return 0;
  return targetPosition.tokens
    .filter((token) => token.token_id === tokenId)
    .reduce((sum, token) => sum + token.cost_usdc, 0);
}

function applyFollowupSizing(params: {
  policy: SizingPolicy;
  price: number;
  desiredSizeUsdc: number | undefined;
  maxFollowupUsdc: number;
  minShares: number | undefined;
  minUsdcNotional: number | undefined;
  cumulativeIntentForMarket: number | undefined;
}): SizingResult {
  const maxUsdc = Math.min(
    params.policy.max_usdc_per_trade,
    params.maxFollowupUsdc
  );
  const sized = applyMarketFloors(
    params.desiredSizeUsdc,
    params.price,
    params.minShares,
    params.minUsdcNotional,
    maxUsdc
  );
  if (!sized.ok) return sized;
  if (
    params.cumulativeIntentForMarket !== undefined &&
    params.cumulativeIntentForMarket + sized.size_usdc >
      params.policy.max_usdc_per_trade
  ) {
    return { ok: false, reason: "position_cap_reached" };
  }
  return sized;
}

/**
 * Build a canonical `OrderIntent` from the fill + target config.
 * Mirror size is the selected sizing-policy output, never an adapter concern.
 */
function buildIntent(
  fill: PlanMirrorInput["fill"],
  size_usdc: number,
  client_order_id: `0x${string}`,
  policy: PlacementPolicy,
  position_branch: PositionBranch,
  limit_price: number
): OrderIntent {
  const placement: "limit" | "market_fok" =
    policy.kind === "mirror_limit" ? "limit" : "market_fok";
  const tokenId =
    typeof fill.attributes?.asset === "string" ? fill.attributes.asset : "";

  return {
    provider: "polymarket",
    market_id: fill.market_id,
    outcome: fill.outcome,
    side: fill.side,
    size_usdc,
    limit_price,
    client_order_id,
    attributes: {
      token_id: tokenId,
      condition_id:
        typeof fill.attributes?.condition_id === "string"
          ? fill.attributes.condition_id
          : undefined,
      source_fill_id: fill.fill_id,
      target_wallet: fill.target_wallet,
      placement,
      position_branch,
      title:
        typeof fill.attributes?.title === "string"
          ? fill.attributes.title
          : undefined,
      slug:
        typeof fill.attributes?.slug === "string"
          ? fill.attributes.slug
          : undefined,
      event_slug:
        typeof fill.attributes?.event_slug === "string"
          ? fill.attributes.event_slug
          : undefined,
      event_title:
        typeof fill.attributes?.event_title === "string"
          ? fill.attributes.event_title
          : undefined,
      end_date:
        typeof fill.attributes?.end_date === "string"
          ? fill.attributes.end_date
          : undefined,
      game_start_time:
        typeof fill.attributes?.game_start_time === "string"
          ? fill.attributes.game_start_time
          : undefined,
      transaction_hash:
        typeof fill.attributes?.transaction_hash === "string"
          ? fill.attributes.transaction_hash
          : undefined,
    },
  };
}
