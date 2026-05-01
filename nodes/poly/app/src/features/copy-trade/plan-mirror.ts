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
 * Links: docs/spec/poly-multi-tenant-auth.md, work/items/task.0318, work/items/task.5005
 * @public
 */

import {
  normalizeLimitPriceToTick,
  type OrderIntent,
} from "@cogni/poly-market-provider";

import type {
  MirrorPlan,
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
 *   1. already placed (PK+cid)  → skip/already_placed
 *   2. sizing below market min  → skip/below_market_min
 *   3. mode === 'paper'         → place (paper adapter)
 *   4. otherwise                → place (live)
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
  } = input;

  if (state.already_placed_ids.includes(client_order_id)) {
    return {
      kind: "skip",
      reason: "already_placed",
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

  const followup = applyPositionFollowupPolicy(
    planningInput,
    min_shares,
    min_usdc_notional
  );
  if (followup !== undefined) {
    if (!followup.sizing.ok) {
      return {
        kind: "skip",
        reason: followup.sizing.reason,
        position_branch: followup.position_branch,
      };
    }
    const intent = buildIntent(
      fill,
      followup.sizing.size_usdc,
      client_order_id,
      config.placement,
      followup.position_branch,
      normalizedPrice.price
    );
    return {
      kind: "place",
      reason: followup.reason,
      position_branch: followup.position_branch,
      intent,
    };
  }

  const sizing = applySizingPolicy(
    config.sizing,
    normalizedPrice.price,
    targetSizingUsdcForFill(fill, state, config.sizing),
    min_shares,
    min_usdc_notional,
    state.cumulative_intent_usdc_for_market
  );
  if (!sizing.ok) {
    return {
      kind: "skip",
      reason: sizing.reason,
      position_branch: "new_entry",
    };
  }

  const intent = buildIntent(
    fill,
    sizing.size_usdc,
    client_order_id,
    config.placement,
    "new_entry",
    normalizedPrice.price
  );

  return {
    kind: "place",
    reason: config.mode === "paper" ? "mode_paper" : "ok",
    position_branch: "new_entry",
    intent,
  };
}

function applyPositionFollowupPolicy(
  input: PlanMirrorInput,
  minShares: number | undefined,
  minUsdcNotional: number | undefined
):
  | {
      reason: "layer_scale_in" | "hedge_followup";
      position_branch: "layer" | "hedge";
      sizing: SizingResult;
    }
  | undefined {
  const { fill, config, state } = input;
  const policy = config.position_followup;
  if (!policy?.enabled || fill.side !== "BUY") return undefined;

  const tokenId =
    typeof fill.attributes?.asset === "string" ? fill.attributes.asset : "";
  const position = state.position;
  if (!tokenId || !position?.our_token_id) return undefined;

  const isLayer = tokenId === position.our_token_id;
  const isHedge =
    position.opposite_token_id !== undefined &&
    tokenId === position.opposite_token_id;
  if (!isLayer && !isHedge) return undefined;

  const branch: "layer" | "hedge" = isHedge ? "hedge" : "layer";
  const followupReason: "layer_scale_in" | "hedge_followup" = isHedge
    ? "hedge_followup"
    : "layer_scale_in";
  const mirrorExposureUsdc = mirrorExposureUsdcForBranch(
    position.our_qty_shares,
    position.our_vwap_usdc,
    fill.price
  );
  const minPositionUsdc = effectiveMinPositionUsdc(policy, minUsdcNotional);
  if (mirrorExposureUsdc < minPositionUsdc) {
    return {
      reason: followupReason,
      position_branch: branch,
      sizing: { ok: false, reason: "followup_position_too_small" },
    };
  }

  const targetThreshold = targetFollowupThreshold(config.sizing);
  const targetBranchCost = targetTokenCostUsdc(state.target_position, tokenId);
  if (targetBranchCost < targetThreshold) {
    return {
      reason: followupReason,
      position_branch: branch,
      sizing: { ok: false, reason: "target_position_below_threshold" },
    };
  }

  if (isLayer) {
    return {
      reason: "layer_scale_in",
      position_branch: "layer",
      sizing: applyFollowupSizing({
        policy: config.sizing,
        price: fill.price,
        desiredSizeUsdc: minUsdcNotional,
        maxFollowupUsdc:
          mirrorExposureUsdc * policy.max_layer_fraction_of_position,
        minShares,
        minUsdcNotional,
        cumulativeIntentForMarket: state.cumulative_intent_usdc_for_market,
      }),
    };
  }

  const targetHedgeCost = targetTokenCostUsdc(state.target_position, tokenId);
  const targetPrimaryCost = targetTokenCostUsdc(
    state.target_position,
    position.our_token_id
  );
  if (targetHedgeCost < policy.min_target_hedge_usdc) {
    return {
      reason: "hedge_followup",
      position_branch: "hedge",
      sizing: { ok: false, reason: "target_position_below_threshold" },
    };
  }
  const targetHedgeRatio =
    targetPrimaryCost > 0 ? targetHedgeCost / targetPrimaryCost : 0;
  if (targetHedgeRatio < policy.min_target_hedge_ratio) {
    return {
      reason: "hedge_followup",
      position_branch: "hedge",
      sizing: { ok: false, reason: "target_position_below_threshold" },
    };
  }

  const existingHedgeUsdc = position.opposite_qty_shares * fill.price;
  const desiredHedgeUsdc = mirrorExposureUsdc * targetHedgeRatio;
  const desiredDeltaUsdc = desiredHedgeUsdc - existingHedgeUsdc;
  if (desiredDeltaUsdc <= 0) {
    return {
      reason: "hedge_followup",
      position_branch: "hedge",
      sizing: { ok: false, reason: "followup_not_needed" },
    };
  }

  return {
    reason: "hedge_followup",
    position_branch: "hedge",
    sizing: applyFollowupSizing({
      policy: config.sizing,
      price: fill.price,
      desiredSizeUsdc: desiredDeltaUsdc,
      maxFollowupUsdc:
        mirrorExposureUsdc * policy.max_hedge_fraction_of_position,
      minShares,
      minUsdcNotional,
      cumulativeIntentForMarket: state.cumulative_intent_usdc_for_market,
    }),
  };
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
