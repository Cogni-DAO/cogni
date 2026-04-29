// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/copy-trade/plan-mirror-sizing-min-bet`
 * Purpose: Cover the `kind: "min_bet"` branch of `applySizingPolicy()` — bet the market's `minUsdcNotional`, clamped to the share-floor and the per-intent ceiling. Fail closed when constraints are unknown.
 * Scope: Pure function; no I/O. Exercises `config.sizing.kind === "min_bet"` combined with `min_shares` + `min_usdc_notional` inputs.
 * Invariants: SHARE_SPACE_MATH — intent.size_usdc / price always ≥ min_shares. CAPS_LIVE_IN_GRANT — sizer never reads grant state. MIRROR_REASON_BOUNDED — skip reason is literally "below_market_min".
 * Side-effects: none
 * Links: work/items/task.0404.poly-bet-sizer-v0.md
 */

import { clientOrderIdFor, type Fill } from "@cogni/poly-market-provider";
import { describe, expect, it } from "vitest";

import { planMirrorFromFill } from "@/features/copy-trade/plan-mirror";
import type {
  MirrorTargetConfig,
  RuntimeState,
} from "@/features/copy-trade/types";

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_WALLET = "0x1234567890abcdef1234567890abcdef12345678" as const;

const CLEAN_STATE: RuntimeState = {
  already_placed_ids: [],
};

function makeConfig(max_usdc_per_trade: number): MirrorTargetConfig {
  return {
    target_id: TARGET_ID,
    target_wallet: TARGET_WALLET,
    billing_account_id: "00000000-0000-4000-b000-000000000000",
    created_by_user_id: "00000000-0000-4000-a000-000000000001",
    mode: "live",
    sizing: {
      kind: "min_bet",
      max_usdc_per_trade,
    },
    enabled: true,
  };
}

function makeFill(price: number): Fill {
  return {
    target_wallet: TARGET_WALLET,
    fill_id: `data-api:0xtx:0xasset:BUY:${Math.floor(price * 1000)}`,
    source: "data-api",
    market_id: "prediction-market:polymarket:0xcondition",
    outcome: "YES",
    side: "BUY",
    price,
    size_usdc: 100, // target's own size — irrelevant to min_bet
    observed_at: "2026-04-27T00:00:00.000Z",
    attributes: { asset: "0xasset", condition_id: "0xcondition" },
  };
}

describe("planMirrorFromFill() — sizing policy: kind=min_bet (task.0404)", () => {
  it("places at minUsdcNotional when within ceiling and share-floor allows", () => {
    const fill = makeFill(0.5);
    const d = planMirrorFromFill({
      fill,
      config: makeConfig(5),
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 5, // 5 shares × $0.5 = $2.5 — share-floor below USDC floor
      min_usdc_notional: 2,
    });
    if (d.kind !== "place") throw new Error("expected place");
    // share-floor (5 × 0.5 = 2.5) wins over USDC floor (2.0); SHARE_SPACE_MATH
    expect(d.intent.size_usdc).toBe(2.5);
    expect(d.intent.size_usdc / fill.price).toBeGreaterThanOrEqual(5);
  });

  it("places at minUsdcNotional when share-floor is below it (USDC floor wins)", () => {
    const fill = makeFill(1.0);
    const d = planMirrorFromFill({
      fill,
      config: makeConfig(5),
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 3,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.intent.size_usdc).toBe(3);
  });

  it("skips below_market_min when minUsdcNotional is undefined (fail closed)", () => {
    const fill = makeFill(0.5);
    const d = planMirrorFromFill({
      fill,
      config: makeConfig(5),
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 5,
      min_usdc_notional: undefined,
    });
    if (d.kind !== "skip") throw new Error("expected skip");
    expect(d.reason).toBe("below_market_min");
  });

  it("skips below_market_min when computed size exceeds max_usdc_per_trade (ceiling wins)", () => {
    const fill = makeFill(1.0);
    const d = planMirrorFromFill({
      fill,
      config: makeConfig(5), // ceiling $5
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 10, // market wants $10 → above ceiling
    });
    if (d.kind !== "skip") throw new Error("expected skip");
    expect(d.reason).toBe("below_market_min");
  });

  it("skips below_market_min when share-floor pushes notional above ceiling", () => {
    const fill = makeFill(0.99);
    const d = planMirrorFromFill({
      fill,
      config: makeConfig(5), // ceiling $5
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 6, // 6 × 0.99 = $5.94 — share-floor exceeds ceiling
      min_usdc_notional: 1,
    });
    if (d.kind !== "skip") throw new Error("expected skip");
    expect(d.reason).toBe("below_market_min");
  });

  it("clamps the ε round-trip up to minUsdcNotional (bug.0342)", () => {
    // 1 / 0.09 = 11.111…, * 0.09 = 0.9999… < 1 — without the ε-clamp the
    // adapter's USDC re-check would bounce the intent.
    const fill = makeFill(0.09);
    const d = planMirrorFromFill({
      fill,
      config: makeConfig(5),
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: undefined,
      min_usdc_notional: 1,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.intent.size_usdc).toBeGreaterThanOrEqual(1);
  });

  it("skips position_cap_reached on min_bet variant (task.0424)", () => {
    const fill = makeFill(0.5);
    const d = planMirrorFromFill({
      fill,
      config: makeConfig(5),
      state: {
        already_placed_ids: [],
        cumulative_intent_usdc_for_market: 4.5,
      },
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 1,
    });
    expect(d).toEqual({ kind: "skip", reason: "position_cap_reached" });
  });
});
