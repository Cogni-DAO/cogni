// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/copy-trade/plan-mirror-position-followups`
 * Purpose: Cover position-aware mirror follow-up branches: same-token layers
 * and opposite-token hedges ignore tiny trigger orders only when both
 * mirror and target token-position thresholds make market-min sizing sane.
 * Scope: Pure planner tests. No DB, no Data API, no CLOB.
 * Invariants: PLAN_IS_PURE, HEDGE_PREDICATE_NOOPS_ON_UNKNOWN_OPPOSITE,
 * DECISION_LOG_NAMES_VIEW.
 * Links: story.5000, docs/design/poly-mirror-position-projection.md,
 * docs/research/poly/layering-policy-spike-2026-05-02.md
 */

import { clientOrderIdFor, type Fill } from "@cogni/poly-market-provider";
import { describe, expect, it } from "vitest";

import { planMirrorFromFill } from "@/features/copy-trade/plan-mirror";
import type {
  MirrorTargetConfig,
  RuntimeState,
} from "@/features/copy-trade/types";

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_WALLET = "0x2005d16a84ceefa912d4e380cd32e7ff827875ea" as const;
const CONDITION_ID = "prediction-market:polymarket:0xcondition";
const PRIMARY_TOKEN = "0xprimary";
const HEDGE_TOKEN = "0xhedge";

const CONFIG: MirrorTargetConfig = {
  target_id: TARGET_ID,
  target_wallet: TARGET_WALLET,
  billing_account_id: "00000000-0000-4000-b000-000000000000",
  created_by_user_id: "00000000-0000-4000-a000-000000000001",
  mode: "live",
  sizing: {
    kind: "target_percentile_scaled",
    max_usdc_per_trade: 5,
    statistic: {
      wallet: TARGET_WALLET,
      label: "RN1",
      captured_at: "2026-05-03T00:59:00Z",
      sample_size: 3942,
      percentile: 75,
      min_target_usdc: 199,
      max_target_usdc: 5453,
    },
  },
  placement: { kind: "mirror_limit" },
  position_followup: {
    enabled: true,
    min_mirror_position_usdc: 5,
    market_floor_multiple: 5,
    min_target_hedge_ratio: 0.02,
    min_target_hedge_usdc: 5,
    max_hedge_fraction_of_position: 0.25,
    max_layer_fraction_of_position: 0.5,
  },
};

function makeFill(tokenId: string, size_usdc: number, price = 0.5): Fill {
  return {
    target_wallet: TARGET_WALLET,
    fill_id: `data-api:0xtx:${tokenId}:BUY:${Math.floor(size_usdc * 1000)}`,
    source: "data-api",
    market_id: CONDITION_ID,
    outcome: tokenId === PRIMARY_TOKEN ? "YES" : "NO",
    side: "BUY",
    price,
    size_usdc,
    observed_at: "2026-05-02T00:00:00.000Z",
    attributes: { asset: tokenId, condition_id: CONDITION_ID },
  };
}

function state(overrides?: Partial<RuntimeState>): RuntimeState {
  return {
    already_placed_ids: [],
    cumulative_intent_usdc_for_market: 0,
    position: {
      condition_id: CONDITION_ID,
      our_token_id: PRIMARY_TOKEN,
      our_qty_shares: 10,
      our_vwap_usdc: 0.5,
      opposite_token_id: HEDGE_TOKEN,
      opposite_qty_shares: 0,
    },
    target_position: {
      condition_id: CONDITION_ID,
      tokens: [
        {
          token_id: PRIMARY_TOKEN,
          size_shares: 400,
          cost_usdc: 200,
          current_value_usdc: 200,
        },
        {
          token_id: HEDGE_TOKEN,
          size_shares: 10,
          cost_usdc: 5,
          current_value_usdc: 5,
        },
      ],
    },
    ...overrides,
  };
}

describe("planMirrorFromFill() — position-aware followups", () => {
  it("fails closed for new entries when target position context is missing", () => {
    const fill = makeFill(PRIMARY_TOKEN, 1);
    const d = planMirrorFromFill({
      fill,
      config: CONFIG,
      state: { already_placed_ids: [] },
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 1,
    });
    expect(d).toEqual({
      kind: "skip",
      reason: "below_target_percentile",
      position_branch: "new_entry",
    });
  });

  it("places a same-token layer from a tiny trigger once mirror and target positions clear thresholds", () => {
    const fill = makeFill(PRIMARY_TOKEN, 1);
    const d = planMirrorFromFill({
      fill,
      config: CONFIG,
      state: state(),
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 1,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.reason).toBe("layer_scale_in");
    expect(d.position_branch).toBe("layer");
    expect(d.intent.size_usdc).toBe(1);
    expect(d.intent.attributes?.position_branch).toBe("layer");
  });

  it("skips same-token layers when our mirror exposure is too small for market-min sizing", () => {
    const fill = makeFill(PRIMARY_TOKEN, 1);
    const d = planMirrorFromFill({
      fill,
      config: CONFIG,
      state: state({
        position: {
          condition_id: CONDITION_ID,
          our_token_id: PRIMARY_TOKEN,
          our_qty_shares: 4,
          our_vwap_usdc: 0.5,
          opposite_token_id: HEDGE_TOKEN,
          opposite_qty_shares: 0,
        },
      }),
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 1,
    });
    expect(d).toEqual({
      kind: "skip",
      reason: "followup_position_too_small",
      position_branch: "layer",
    });
  });

  it("places an opposite-token hedge from a tiny trigger when target hedge ratio clears thresholds", () => {
    const fill = makeFill(HEDGE_TOKEN, 1, 0.2);
    const d = planMirrorFromFill({
      fill,
      config: CONFIG,
      state: state({
        target_position: {
          condition_id: CONDITION_ID,
          tokens: [
            {
              token_id: PRIMARY_TOKEN,
              size_shares: 20_000,
              cost_usdc: 10_000,
              current_value_usdc: 10_000,
            },
            {
              token_id: HEDGE_TOKEN,
              size_shares: 1_000,
              cost_usdc: 200,
              current_value_usdc: 200,
            },
          ],
        },
      }),
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 1,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.reason).toBe("hedge_followup");
    expect(d.position_branch).toBe("hedge");
    expect(d.intent.size_usdc).toBe(1);
    expect(d.intent.attributes?.position_branch).toBe("hedge");
  });

  it("skips an opposite-token hedge when target hedge position is still below threshold", () => {
    const fill = makeFill(HEDGE_TOKEN, 1, 0.2);
    const d = planMirrorFromFill({
      fill,
      config: CONFIG,
      state: state({
        target_position: {
          condition_id: CONDITION_ID,
          tokens: [
            {
              token_id: PRIMARY_TOKEN,
              size_shares: 400,
              cost_usdc: 200,
              current_value_usdc: 200,
            },
          ],
        },
      }),
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 1,
    });
    expect(d).toEqual({
      kind: "skip",
      reason: "target_position_below_threshold",
      position_branch: "hedge",
    });
  });

  it("does not count the current hedge fill twice when applying target hedge thresholds", () => {
    const fill = makeFill(HEDGE_TOKEN, 1, 0.2);
    const d = planMirrorFromFill({
      fill,
      config: CONFIG,
      state: state({
        target_position: {
          condition_id: CONDITION_ID,
          tokens: [
            {
              token_id: PRIMARY_TOKEN,
              size_shares: 400,
              cost_usdc: 200,
              current_value_usdc: 200,
            },
            {
              token_id: HEDGE_TOKEN,
              size_shares: 9,
              cost_usdc: 4.5,
              current_value_usdc: 4.5,
            },
          ],
        },
      }),
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 1,
    });
    expect(d).toEqual({
      kind: "skip",
      reason: "target_position_below_threshold",
      position_branch: "hedge",
    });
  });

  it("does not guess hedge semantics when the opposite token is unknown", () => {
    const fill = makeFill(HEDGE_TOKEN, 1, 0.2);
    const d = planMirrorFromFill({
      fill,
      config: CONFIG,
      state: state({
        position: {
          condition_id: CONDITION_ID,
          our_token_id: PRIMARY_TOKEN,
          our_qty_shares: 10,
          our_vwap_usdc: 0.5,
          opposite_qty_shares: 0,
        },
      }),
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 1,
    });
    expect(d).toEqual({
      kind: "skip",
      reason: "below_target_percentile",
      position_branch: "new_entry",
    });
  });

  it("skips when remaining condition budget cannot place the market floor", () => {
    const fill = makeFill(PRIMARY_TOKEN, 1);
    const d = planMirrorFromFill({
      fill,
      config: CONFIG,
      state: state({ cumulative_intent_usdc_for_market: 4.5 }),
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 1,
    });
    expect(d).toEqual({
      kind: "skip",
      reason: "position_cap_reached",
      position_branch: "layer",
    });
  });
});
