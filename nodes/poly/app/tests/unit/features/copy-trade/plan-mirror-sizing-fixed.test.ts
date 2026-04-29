// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/copy-trade/plan-mirror-sizing-fixed`
 * Purpose: Cover the bug.0342 sizing-policy branch of `planMirrorFromFill()` — scale up to market min, skip above user ceiling, pass through at/above min.
 * Scope: Pure function; no I/O. Exercises `config.sizing.kind === "fixed"` combined with `min_shares` input. Daily / hourly cap tests removed — those moved to `authorizeIntent` (CAPS_LIVE_IN_GRANT).
 * Invariants: SHARE_SPACE_MATH — intent.size_usdc / price always ≥ min_shares. MIRROR_REASON_BOUNDED — skip reason is literally "below_market_min".
 * Side-effects: none
 * Links: work/items/bug.0342.poly-clob-dynamic-min-order-size.md
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

function makeConfig(overrides: {
  mirror_usdc: number;
  max_usdc_per_trade: number;
}): MirrorTargetConfig {
  return {
    target_id: TARGET_ID,
    target_wallet: TARGET_WALLET,
    billing_account_id: "00000000-0000-4000-b000-000000000000",
    created_by_user_id: "00000000-0000-4000-a000-000000000001",
    mode: "live",
    sizing: {
      kind: "fixed",
      mirror_usdc: overrides.mirror_usdc,
      max_usdc_per_trade: overrides.max_usdc_per_trade,
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
    size_usdc: 2,
    observed_at: "2026-04-20T00:00:00.000Z",
    attributes: { asset: "0xasset", condition_id: "0xcondition" },
  };
}

describe("planMirrorFromFill() — sizing policy: kind=fixed (bug.0342)", () => {
  it("no scaling when mirror_usdc buys >= min_shares at price", () => {
    const fill = makeFill(0.5);
    const d = planMirrorFromFill({
      fill,
      config: makeConfig({ mirror_usdc: 5, max_usdc_per_trade: 5 }),
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 5,
      min_usdc_notional: 1,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.intent.size_usdc).toBe(5);
  });

  it("scales up to minShares × price when mirror_usdc is below min and ceiling allows", () => {
    const fill = makeFill(0.64);
    const d = planMirrorFromFill({
      fill,
      config: makeConfig({ mirror_usdc: 1, max_usdc_per_trade: 5 }),
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 5,
      min_usdc_notional: 1,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.intent.size_usdc / d.intent.limit_price).toBeGreaterThanOrEqual(5);
    expect(d.intent.size_usdc).toBeCloseTo(3.2, 5);
  });

  it("skips with below_market_min when scaling would exceed ceiling", () => {
    const fill = makeFill(0.95);
    const d = planMirrorFromFill({
      fill,
      config: makeConfig({ mirror_usdc: 1, max_usdc_per_trade: 2 }),
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 5,
      min_usdc_notional: 1,
    });
    expect(d).toEqual({ kind: "skip", reason: "below_market_min" });
  });

  it("scales up to min_usdc_notional floor on 1-share-min cheap-price markets", () => {
    const fill = makeFill(0.49);
    const d = planMirrorFromFill({
      fill,
      config: makeConfig({ mirror_usdc: 1, max_usdc_per_trade: 5 }),
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 1,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.intent.size_usdc).toBeGreaterThanOrEqual(1);
    expect(d.intent.size_usdc / d.intent.limit_price).toBeCloseTo(1 / 0.49, 10);
  });

  it("skips when both floors together exceed user ceiling", () => {
    const fill = makeFill(0.05);
    const d = planMirrorFromFill({
      fill,
      config: makeConfig({ mirror_usdc: 0.25, max_usdc_per_trade: 0.5 }),
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 1,
    });
    expect(d).toEqual({ kind: "skip", reason: "below_market_min" });
  });

  it("clamps size_usdc ≥ min_usdc_notional across float-lossy prices (bug.0342 regression)", () => {
    // price=0.09, mirror_usdc=1: `1/0.09 * 0.09 = 0.9999999999999999`.
    // Before bug.0342 this slipped through the planner and was rejected by
    // the adapter's USDC-floor check, breaking mirror placement in prod.
    const fill = makeFill(0.09);
    const d = planMirrorFromFill({
      fill,
      config: makeConfig({ mirror_usdc: 1, max_usdc_per_trade: 5 }),
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 5,
      min_usdc_notional: 1,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.intent.size_usdc).toBeGreaterThanOrEqual(1);
  });

  it("legacy behavior: no min_shares input → no share-min guard, passes mirror_usdc as-is", () => {
    const fill = makeFill(0.64);
    const d = planMirrorFromFill({
      fill,
      config: makeConfig({ mirror_usdc: 1, max_usdc_per_trade: 1 }),
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.intent.size_usdc).toBe(1);
  });

  it("places when cumulative + intent fits inside max_usdc_per_trade (task.0424)", () => {
    const fill = makeFill(0.5);
    const d = planMirrorFromFill({
      fill,
      config: makeConfig({ mirror_usdc: 2, max_usdc_per_trade: 5 }),
      state: { already_placed_ids: [], cumulative_intent_usdc_for_market: 2 },
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 1,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.intent.size_usdc).toBe(2);
  });

  it("skips position_cap_reached when cumulative + intent exceeds max_usdc_per_trade (task.0424)", () => {
    const fill = makeFill(0.5);
    const d = planMirrorFromFill({
      fill,
      config: makeConfig({ mirror_usdc: 2, max_usdc_per_trade: 5 }),
      state: { already_placed_ids: [], cumulative_intent_usdc_for_market: 4 },
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 1,
    });
    expect(d).toEqual({ kind: "skip", reason: "position_cap_reached" });
  });

  it("position cap is opt-in: undefined cumulative skips the check (task.0424)", () => {
    const fill = makeFill(0.5);
    const d = planMirrorFromFill({
      fill,
      config: makeConfig({ mirror_usdc: 2, max_usdc_per_trade: 5 }),
      state: { already_placed_ids: [] },
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 1,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.intent.size_usdc).toBe(2);
  });

  it("places when cumulative + intent equals max_usdc_per_trade exactly (boundary, task.0424)", () => {
    const fill = makeFill(0.5);
    const d = planMirrorFromFill({
      fill,
      config: makeConfig({ mirror_usdc: 2, max_usdc_per_trade: 5 }),
      state: { already_placed_ids: [], cumulative_intent_usdc_for_market: 3 },
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 1,
      min_usdc_notional: 1,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.intent.size_usdc).toBe(2);
  });
});
