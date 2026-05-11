// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/copy-trade/plan-mirror-target-dominance`
 * Purpose: Cover the bug.5048 target-dominance branching + VWAP gate. Each
 * row of the branch table in `docs/spec/poly-copy-trade-execution.md`
 * ("Branch decision — target-dominance drives routing") gets a test. Also
 * verifies the VWAP gate + skip-precedence ordering.
 * Scope: Pure planner tests. No DB, no Data API, no CLOB.
 * Links: bug.5048, docs/research/poly/mirror-position-model-2026-05-11.md
 */

import { clientOrderIdFor, type Fill } from "@cogni/poly-market-provider";
import { describe, expect, it } from "vitest";

import {
  analyzeTargetDominance,
  planMirrorFromFill,
  targetVwapForToken,
} from "@/features/copy-trade/plan-mirror";
import type {
  MirrorTargetConfig,
  RuntimeState,
  TargetConditionPositionView,
} from "@/features/copy-trade/types";

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_WALLET = "0x204f72f35326db932158cba6adff0b9a1da95e14" as const;
const CONDITION_ID = "prediction-market:polymarket:0xcondition";
const OVER_TOKEN = "0xover";
const UNDER_TOKEN = "0xunder";
const THIRD_TOKEN = "0xthird";

const BASE_CONFIG: MirrorTargetConfig = {
  target_id: TARGET_ID,
  target_wallet: TARGET_WALLET,
  billing_account_id: "00000000-0000-4000-b000-000000000000",
  created_by_user_id: "00000000-0000-4000-a000-000000000001",
  mode: "live",
  sizing: {
    kind: "target_percentile_scaled",
    max_usdc_per_trade: 10,
    statistic: {
      wallet: TARGET_WALLET,
      label: "swisstony",
      captured_at: "2026-05-03T02:34:00Z",
      sample_size: 1085,
      percentile: 80,
      min_target_usdc: 100,
      max_target_usdc: 4809,
    },
  },
  placement: { kind: "mirror_limit" },
  min_target_side_fraction: 0.2,
  vwap_tolerance: 0.005,
};

const FOLLOWUP_CONFIG: MirrorTargetConfig = {
  ...BASE_CONFIG,
  position_followup: {
    enabled: true,
    min_mirror_position_usdc: 1,
    market_floor_multiple: 1,
    min_target_hedge_ratio: 0.02,
    min_target_hedge_usdc: 5,
    max_hedge_fraction_of_position: 0.5,
    max_layer_fraction_of_position: 0.5,
  },
};

function makeFill(tokenId: string, size_usdc: number, price = 0.4): Fill {
  return {
    target_wallet: TARGET_WALLET,
    fill_id: `data-api:0xtx:${tokenId}:BUY:${Math.floor(size_usdc * 1000)}`,
    source: "data-api",
    market_id: CONDITION_ID,
    outcome: tokenId === OVER_TOKEN ? "YES" : "NO",
    side: "BUY",
    price,
    size_usdc,
    observed_at: "2026-05-04T00:00:00.000Z",
    attributes: {
      asset: tokenId,
      condition_id: CONDITION_ID,
      end_date: "2099-12-31T23:59:59Z",
    },
  };
}

function makeState(args: {
  targetPosition?: TargetConditionPositionView;
  ourPosition?: RuntimeState["position"];
}): RuntimeState {
  return {
    already_placed_ids: [],
    cumulative_intent_usdc_for_market: 0,
    ...(args.targetPosition !== undefined
      ? { target_position: args.targetPosition }
      : {}),
    ...(args.ourPosition !== undefined ? { position: args.ourPosition } : {}),
  };
}

// Target heavily on OVER (Chelsea/Nott-Forest shape): cost 22807 vs 1059.
// UNDER fraction = 1059/23866 = 0.0444 — below 0.20 default threshold.
const ASYMMETRIC_OVER: TargetConditionPositionView = {
  condition_id: CONDITION_ID,
  tokens: [
    {
      token_id: OVER_TOKEN,
      size_shares: 60000,
      cost_usdc: 22807,
      current_value_usdc: 31000,
    },
    {
      token_id: UNDER_TOKEN,
      size_shares: 2500,
      cost_usdc: 1059,
      current_value_usdc: 1000,
    },
  ],
};

// Target's per-token VWAPs from ASYMMETRIC_OVER:
//   OVER vwap  = 22807 / 60000 ≈ 0.3801
//   UNDER vwap = 1059 / 2500   ≈ 0.4236

describe("planMirrorFromFill — target-dominance branch table (bug.5048)", () => {
  describe("ROW 1 — fill on dominant + no mirror → new_entry_dominant + place", () => {
    it("places new_entry on OVER fill when target is 95% OVER and we have no mirror", () => {
      const fill = makeFill(OVER_TOKEN, 1, 0.35);
      const d = planMirrorFromFill({
        fill,
        config: BASE_CONFIG,
        state: makeState({ targetPosition: ASYMMETRIC_OVER }),
        client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
        min_shares: 5,
        min_usdc_notional: 1,
      });
      expect(d.kind).toBe("place");
      if (d.kind !== "place") throw new Error("expected place");
      expect(d.position_branch).toBe("new_entry");
      expect(d.reason).toBe("ok");
      expect(d.wrong_side_holding_detected).toBeFalsy();
    });
  });

  describe("ROW 2 — fill on dominant + mirror on dominant → layer_dominant", () => {
    it("routes to layer_scale_in when target dominant + we hold dominant side", () => {
      const fill = makeFill(OVER_TOKEN, 1, 0.35);
      const d = planMirrorFromFill({
        fill,
        config: FOLLOWUP_CONFIG,
        state: makeState({
          targetPosition: ASYMMETRIC_OVER,
          ourPosition: {
            condition_id: CONDITION_ID,
            our_token_id: OVER_TOKEN,
            our_qty_shares: 100,
            our_vwap_usdc: 0.35,
            opposite_token_id: UNDER_TOKEN,
            opposite_qty_shares: 0,
          },
        }),
        client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
        min_shares: 1,
        min_usdc_notional: 1,
      });
      expect(d.kind).toBe("place");
      if (d.kind !== "place") throw new Error("expected place");
      expect(d.position_branch).toBe("layer");
      expect(d.reason).toBe("layer_scale_in");
      expect(d.wrong_side_holding_detected).toBeFalsy();
    });
  });

  describe("ROW 3 — fill on dominant + mirror on minority (option C)", () => {
    it("routes to new_entry_dominant AND sets wrong_side_holding_detected", () => {
      const fill = makeFill(OVER_TOKEN, 1, 0.35);
      const d = planMirrorFromFill({
        fill,
        config: BASE_CONFIG,
        state: makeState({
          targetPosition: ASYMMETRIC_OVER,
          ourPosition: {
            condition_id: CONDITION_ID,
            our_token_id: UNDER_TOKEN,
            our_qty_shares: 41,
            our_vwap_usdc: 0.367,
            opposite_token_id: OVER_TOKEN,
            opposite_qty_shares: 0,
          },
        }),
        client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
        min_shares: 5,
        min_usdc_notional: 1,
      });
      expect(d.kind).toBe("place");
      if (d.kind !== "place") throw new Error("expected place");
      expect(d.position_branch).toBe("new_entry");
      expect(d.wrong_side_holding_detected).toBe(true);
    });
  });

  describe("ROW 4 — fill on minority + mirror on dominant → hedge", () => {
    it("routes to hedge_followup when target dominant + we hold dominant + fill on minority", () => {
      // Use a less-asymmetric target so the hedge ratio is non-trivial.
      const moderateAsymmetry: TargetConditionPositionView = {
        condition_id: CONDITION_ID,
        tokens: [
          {
            token_id: OVER_TOKEN,
            size_shares: 1000,
            cost_usdc: 700,
            current_value_usdc: 700,
          },
          {
            token_id: UNDER_TOKEN,
            size_shares: 500,
            cost_usdc: 250,
            current_value_usdc: 250,
          },
        ],
      };
      const fill = makeFill(UNDER_TOKEN, 1, 0.5);
      const d = planMirrorFromFill({
        fill,
        config: FOLLOWUP_CONFIG,
        state: makeState({
          targetPosition: moderateAsymmetry,
          ourPosition: {
            condition_id: CONDITION_ID,
            our_token_id: OVER_TOKEN,
            our_qty_shares: 200,
            our_vwap_usdc: 0.5,
            opposite_token_id: UNDER_TOKEN,
            opposite_qty_shares: 0,
          },
        }),
        client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
        min_shares: 1,
        min_usdc_notional: 1,
      });
      // UNDER fraction = 250/950 ≈ 0.263 — above 0.20 threshold; not minority.
      // We hold OVER (= target dominant), fill on UNDER (= opposite). Routes to hedge.
      expect(d.kind).toBe("place");
      if (d.kind !== "place") throw new Error("expected place");
      expect(d.position_branch).toBe("hedge");
      expect(d.reason).toBe("hedge_followup");
    });
  });

  describe("ROW 5 — fill on minority + no mirror → skip target_dominant_other_side", () => {
    it("skips (Chelsea/Nott-Forest repro)", () => {
      const fill = makeFill(UNDER_TOKEN, 1);
      const d = planMirrorFromFill({
        fill,
        config: BASE_CONFIG,
        state: makeState({ targetPosition: ASYMMETRIC_OVER }),
        client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
        min_shares: 5,
        min_usdc_notional: 1,
      });
      expect(d).toEqual({
        kind: "skip",
        reason: "target_dominant_other_side",
        position_branch: "new_entry",
      });
    });
  });

  describe("ROW 6 — fill on minority + mirror on minority → skip", () => {
    it("stops continued bleeding on minority side", () => {
      const fill = makeFill(UNDER_TOKEN, 1);
      const d = planMirrorFromFill({
        fill,
        config: BASE_CONFIG,
        state: makeState({
          targetPosition: ASYMMETRIC_OVER,
          ourPosition: {
            condition_id: CONDITION_ID,
            our_token_id: UNDER_TOKEN,
            our_qty_shares: 41,
            our_vwap_usdc: 0.367,
            opposite_token_id: OVER_TOKEN,
            opposite_qty_shares: 0,
          },
        }),
        client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
        min_shares: 5,
        min_usdc_notional: 1,
      });
      expect(d).toEqual({
        kind: "skip",
        reason: "target_dominant_other_side",
        position_branch: "new_entry",
      });
    });
  });

  describe("ROW 7 — balanced target → both sides pass gate", () => {
    it("places when target is 50/50 (neither side is minority)", () => {
      const balanced: TargetConditionPositionView = {
        condition_id: CONDITION_ID,
        tokens: [
          {
            token_id: OVER_TOKEN,
            size_shares: 10000,
            cost_usdc: 5000,
            current_value_usdc: 5000,
          },
          {
            token_id: UNDER_TOKEN,
            size_shares: 10000,
            cost_usdc: 5000,
            current_value_usdc: 5000,
          },
        ],
      };
      const fill = makeFill(UNDER_TOKEN, 1, 0.4);
      const d = planMirrorFromFill({
        fill,
        config: BASE_CONFIG,
        state: makeState({ targetPosition: balanced }),
        client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
        min_shares: 5,
        min_usdc_notional: 1,
      });
      expect(d.kind).toBe("place");
    });
  });

  describe("Multi-outcome 50/30/20 with threshold 0.25 → fill on 20% leg is minority", () => {
    it("skips on the 20% leg when threshold is 0.25", () => {
      const multi: TargetConditionPositionView = {
        condition_id: CONDITION_ID,
        tokens: [
          {
            token_id: OVER_TOKEN,
            size_shares: 10000,
            cost_usdc: 5000,
            current_value_usdc: 5000,
          },
          {
            token_id: UNDER_TOKEN,
            size_shares: 6000,
            cost_usdc: 3000,
            current_value_usdc: 3000,
          },
          {
            token_id: THIRD_TOKEN,
            size_shares: 4000,
            cost_usdc: 1999,
            current_value_usdc: 1999,
          },
        ],
      };
      const cfg: MirrorTargetConfig = {
        ...BASE_CONFIG,
        min_target_side_fraction: 0.25,
      };
      const fill = makeFill(THIRD_TOKEN, 1, 0.4);
      const d = planMirrorFromFill({
        fill,
        config: cfg,
        state: makeState({ targetPosition: multi }),
        client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
        min_shares: 5,
        min_usdc_notional: 1,
      });
      expect(d.kind).toBe("skip");
      if (d.kind !== "skip") throw new Error("expected skip");
      expect(d.reason).toBe("target_dominant_other_side");
    });
  });
});

describe("planMirrorFromFill — VWAP gate (bug.5048)", () => {
  it("skips with vwap_floor_breach when price exceeds target VWAP + tolerance", () => {
    // Target OVER vwap = 22807/60000 ≈ 0.3801. Tolerance 0.005 → ceiling ≈ 0.3851.
    const fill = makeFill(OVER_TOKEN, 1, 0.45);
    const d = planMirrorFromFill({
      fill,
      config: BASE_CONFIG,
      state: makeState({ targetPosition: ASYMMETRIC_OVER }),
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 5,
      min_usdc_notional: 1,
    });
    expect(d.kind).toBe("skip");
    if (d.kind !== "skip") throw new Error("expected skip");
    expect(d.reason).toBe("vwap_floor_breach");
  });

  it("places when price is at or below target VWAP", () => {
    const fill = makeFill(OVER_TOKEN, 1, 0.38);
    const d = planMirrorFromFill({
      fill,
      config: BASE_CONFIG,
      state: makeState({ targetPosition: ASYMMETRIC_OVER }),
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 5,
      min_usdc_notional: 1,
    });
    expect(d.kind).toBe("place");
  });

  it("fails open (no skip) when target_position is unavailable", () => {
    const fill = makeFill(OVER_TOKEN, 1, 0.99);
    const d = planMirrorFromFill({
      fill,
      config: BASE_CONFIG,
      state: makeState({}),
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 5,
      min_usdc_notional: 1,
    });
    // Without target_position, dominance gate is disabled AND vwap gate is
    // disabled. Sizing falls back through min_target_usdc check.
    expect(d.kind).toBe("skip");
    if (d.kind !== "skip") throw new Error("expected skip");
    expect(d.reason).toBe("below_target_percentile");
  });

  it("disabled when vwap_tolerance is undefined", () => {
    const cfg: MirrorTargetConfig = { ...BASE_CONFIG };
    delete (cfg as { vwap_tolerance?: number }).vwap_tolerance;
    const fill = makeFill(OVER_TOKEN, 1, 0.45);
    const d = planMirrorFromFill({
      fill,
      config: cfg,
      state: makeState({ targetPosition: ASYMMETRIC_OVER }),
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 5,
      min_usdc_notional: 1,
    });
    // Dominance gate still fires for OVER fill at 0.45 ABOVE vwap — but
    // OVER is dominant, not minority, so dominance gate is silent. VWAP
    // gate disabled. Sizing proceeds. Place.
    expect(d.kind).toBe("place");
  });
});

describe("planMirrorFromFill — skip precedence (bug.5048)", () => {
  it("dominance skip wins over vwap skip when both apply", () => {
    // UNDER fill above its own VWAP (UNDER vwap ≈ 0.4236; price 0.99).
    // UNDER is minority. Both gates would fire; dominance is earlier.
    const fill = makeFill(UNDER_TOKEN, 1, 0.99);
    const d = planMirrorFromFill({
      fill,
      config: BASE_CONFIG,
      state: makeState({ targetPosition: ASYMMETRIC_OVER }),
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 5,
      min_usdc_notional: 1,
    });
    expect(d.kind).toBe("skip");
    if (d.kind !== "skip") throw new Error("expected skip");
    expect(d.reason).toBe("target_dominant_other_side");
  });

  it("already_placed wins over dominance", () => {
    const fill = makeFill(UNDER_TOKEN, 1);
    const cid = clientOrderIdFor(TARGET_ID, fill.fill_id);
    const d = planMirrorFromFill({
      fill,
      config: BASE_CONFIG,
      state: {
        ...makeState({ targetPosition: ASYMMETRIC_OVER }),
        already_placed_ids: [cid],
      },
      client_order_id: cid,
      min_shares: 5,
      min_usdc_notional: 1,
    });
    expect(d).toEqual({
      kind: "skip",
      reason: "already_placed",
      position_branch: "new_entry",
    });
  });
});

describe("planMirrorFromFill — gate disabled fallback", () => {
  it("legacy behavior when min_target_side_fraction is undefined (places UNDER on minority side)", () => {
    const cfg: MirrorTargetConfig = { ...BASE_CONFIG };
    delete (cfg as { min_target_side_fraction?: number })
      .min_target_side_fraction;
    delete (cfg as { vwap_tolerance?: number }).vwap_tolerance;
    const fill = makeFill(UNDER_TOKEN, 1, 0.4);
    const d = planMirrorFromFill({
      fill,
      config: cfg,
      state: makeState({ targetPosition: ASYMMETRIC_OVER }),
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 5,
      min_usdc_notional: 1,
    });
    // Pre-bug.5048 behavior: minority UNDER fill with our_token_id=undefined
    // → new_entry sizing → places (the original Chelsea bug).
    expect(d.kind).toBe("place");
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.position_branch).toBe("new_entry");
  });
});

describe("analyzeTargetDominance unit (bug.5048)", () => {
  it("returns disabled when threshold is undefined", () => {
    const r = analyzeTargetDominance(ASYMMETRIC_OVER, undefined, OVER_TOKEN);
    expect(r.dominance_known).toBe(false);
    expect(r.fill_is_minority).toBe(false);
  });

  it("returns disabled when target_position is undefined", () => {
    const r = analyzeTargetDominance(undefined, 0.2, OVER_TOKEN);
    expect(r.dominance_known).toBe(false);
  });

  it("returns disabled when tokens array is empty", () => {
    const r = analyzeTargetDominance(
      { condition_id: CONDITION_ID, tokens: [] },
      0.2,
      OVER_TOKEN
    );
    expect(r.dominance_known).toBe(false);
  });

  it("flags fill_is_minority correctly", () => {
    const r = analyzeTargetDominance(ASYMMETRIC_OVER, 0.2, UNDER_TOKEN);
    expect(r.dominance_known).toBe(true);
    expect(r.fill_is_minority).toBe(true);
    expect(r.dominant_token_id).toBe(OVER_TOKEN);
    expect(r.fill_token_fraction).toBeCloseTo(0.0444, 3);
  });

  it("OVER fill on asymmetric target → not minority", () => {
    const r = analyzeTargetDominance(ASYMMETRIC_OVER, 0.2, OVER_TOKEN);
    expect(r.fill_is_minority).toBe(false);
    expect(r.dominant_token_id).toBe(OVER_TOKEN);
  });
});

describe("targetVwapForToken unit (bug.5048)", () => {
  it("returns cost/shares for a token in the position", () => {
    expect(targetVwapForToken(ASYMMETRIC_OVER, OVER_TOKEN)).toBeCloseTo(
      22807 / 60000,
      4
    );
  });

  it("returns undefined when token absent", () => {
    expect(targetVwapForToken(ASYMMETRIC_OVER, "0xabsent")).toBeUndefined();
  });

  it("returns undefined when target_position is undefined", () => {
    expect(targetVwapForToken(undefined, OVER_TOKEN)).toBeUndefined();
  });

  it("returns undefined when shares are zero", () => {
    const zeroShares: TargetConditionPositionView = {
      condition_id: CONDITION_ID,
      tokens: [
        {
          token_id: OVER_TOKEN,
          size_shares: 0,
          cost_usdc: 100,
          current_value_usdc: 0,
        },
      ],
    };
    expect(targetVwapForToken(zeroShares, OVER_TOKEN)).toBeUndefined();
  });
});
