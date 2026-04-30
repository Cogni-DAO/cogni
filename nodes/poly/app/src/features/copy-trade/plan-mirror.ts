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
 * Links: docs/spec/poly-multi-tenant-auth.md, work/items/task.0318
 * @public
 */

import type { OrderIntent } from "@cogni/poly-market-provider";

import type {
  MirrorPlan,
  PlanMirrorInput,
  SizingPolicy,
  SizingResult,
} from "./types";

/**
 * Apply a sizing policy to derive the notional USDC to submit for a mirrored
 * fill. Share-space math: compute `targetShares` directly, then project back
 * to USDC only for accounting. Avoids the float round-trip `min × price /
 * price = min − ε` that re-triggered CLOB's sub-min rejection.
 *
 * Invariant SHARE_SPACE_MATH — returned `size_usdc`, when divided by `price`,
 * yields shares ≥ `minShares` (or `minShares === undefined` → share-space
 * guard skipped for backward compat).
 */
export function applySizingPolicy(
  policy: SizingPolicy,
  price: number,
  minShares: number | undefined,
  minUsdcNotional: number | undefined,
  cumulativeIntentForMarket?: number
): SizingResult {
  const sized = sizeFromPolicy(policy, price, minShares, minUsdcNotional);
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
  minShares: number | undefined,
  minUsdcNotional: number | undefined
): SizingResult {
  switch (policy.kind) {
    case "fixed": {
      const desiredShares = policy.mirror_usdc / price;
      const sharesForUsdcFloor =
        minUsdcNotional === undefined ? 0 : minUsdcNotional / price;
      const floorShares = Math.max(minShares ?? 0, sharesForUsdcFloor);
      const targetShares = Math.max(desiredShares, floorShares);
      // The share×price round-trip (e.g. `1/0.09 * 0.09 = 0.9999…`) can leave
      // targetShares×price a hair below minUsdcNotional even though targetShares
      // itself clears the share floor. Clamp up so the adapter's own USDC-floor
      // re-check doesn't bounce the intent. bug.0342.
      const rawUsdc = targetShares * price;
      const size_usdc =
        minUsdcNotional !== undefined && rawUsdc < minUsdcNotional
          ? minUsdcNotional
          : rawUsdc;
      if (size_usdc > policy.max_usdc_per_trade) {
        return { ok: false, reason: "below_market_min" };
      }
      return { ok: true, size_usdc };
    }
    case "min_bet": {
      // Fail closed when market constraints are unknown — without
      // minUsdcNotional we have no defensible "min" to bet.
      if (minUsdcNotional === undefined) {
        return { ok: false, reason: "below_market_min" };
      }
      const sharesForUsdcFloor = minUsdcNotional / price;
      const floorShares = Math.max(minShares ?? 0, sharesForUsdcFloor);
      const rawUsdc = floorShares * price;
      // Same bug.0342 ε-clamp as the fixed branch.
      const size_usdc = rawUsdc < minUsdcNotional ? minUsdcNotional : rawUsdc;
      if (size_usdc > policy.max_usdc_per_trade) {
        return { ok: false, reason: "below_market_min" };
      }
      return { ok: true, size_usdc };
    }
  }
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
 * executor boundary (CAPS_LIVE_IN_GRANT invariant). The kill-switch gate
 * was removed in bug.0438; the cross-tenant enumerator's active-target /
 * active-grant join is now the only gate to running this function.
 */
export function planMirrorFromFill(input: PlanMirrorInput): MirrorPlan {
  const {
    fill,
    config,
    state,
    client_order_id,
    min_shares,
    min_usdc_notional,
  } = input;

  if (state.already_placed_ids.includes(client_order_id)) {
    return { kind: "skip", reason: "already_placed" };
  }

  const sizing = applySizingPolicy(
    config.sizing,
    fill.price,
    min_shares,
    min_usdc_notional,
    state.cumulative_intent_usdc_for_market
  );
  if (!sizing.ok) {
    return { kind: "skip", reason: sizing.reason };
  }

  const intent = buildIntent(fill, sizing.size_usdc, client_order_id);

  return {
    kind: "place",
    reason: config.mode === "paper" ? "mode_paper" : "ok",
    intent,
  };
}

/**
 * Build a canonical `OrderIntent` from the fill + target config.
 * Mirror size is a FIXED `mirror_usdc` notional, not proportional to the
 * target's size — keeps caps deterministic and the math auditable.
 */
function buildIntent(
  fill: PlanMirrorInput["fill"],
  size_usdc: number,
  client_order_id: `0x${string}`
): OrderIntent {
  const tokenId =
    typeof fill.attributes?.asset === "string" ? fill.attributes.asset : "";

  return {
    provider: "polymarket",
    market_id: fill.market_id,
    outcome: fill.outcome,
    side: fill.side,
    size_usdc,
    limit_price: fill.price,
    client_order_id,
    attributes: {
      token_id: tokenId,
      source_fill_id: fill.fill_id,
      target_wallet: fill.target_wallet,
      title:
        typeof fill.attributes?.title === "string"
          ? fill.attributes.title
          : undefined,
      transaction_hash:
        typeof fill.attributes?.transaction_hash === "string"
          ? fill.attributes.transaction_hash
          : undefined,
    },
  };
}
