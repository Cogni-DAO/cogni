// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/copy-trade/decide-sizing-fixed`
 * Purpose: Cover the bug.0342 sizing-policy branch of decide() — scale up to market min, skip above user ceiling, pass through at/above min.
 * Scope: Pure decide() function; no I/O. Exercises `config.sizing.kind === "fixed"` combined with `min_shares` input.
 * Invariants: SHARE_SPACE_MATH — intent.size_usdc / price always ≥ min_shares. MIRROR_REASON_BOUNDED — skip reason is literally "below_market_min".
 * Side-effects: none
 * Links: work/items/bug.0342.poly-clob-dynamic-min-order-size.md
 */

import { clientOrderIdFor, type Fill } from "@cogni/market-provider";
import { describe, expect, it } from "vitest";

import { decide } from "@/features/copy-trade/decide";
import type { RuntimeState, TargetConfig } from "@/features/copy-trade/types";

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_WALLET = "0x1234567890abcdef1234567890abcdef12345678" as const;

const CLEAN_STATE: RuntimeState = {
  today_spent_usdc: 0,
  fills_last_hour: 0,
  already_placed_ids: [],
};

function makeConfig(overrides: {
  mirror_usdc: number;
  max_usdc_per_trade: number;
}): TargetConfig {
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
    max_daily_usdc: 100,
    max_fills_per_hour: 10,
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

describe("decide() — sizing policy: kind=fixed (bug.0342)", () => {
  it("no scaling when mirror_usdc buys >= min_shares at price", () => {
    // $5 @ 0.50 = 10 shares ≥ minShares(5) → pass through
    const fill = makeFill(0.5);
    const d = decide({
      fill,
      config: makeConfig({ mirror_usdc: 5, max_usdc_per_trade: 5 }),
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 5,
    });
    if (d.action !== "place") throw new Error("expected place");
    expect(d.intent.size_usdc).toBe(5);
  });

  it("scales up to minShares × price when mirror_usdc is below min and ceiling allows", () => {
    // $1 @ 0.64 = 1.5625 shares < 5 → scale to 5 shares = $3.20 ≤ $5 ceiling
    const fill = makeFill(0.64);
    const d = decide({
      fill,
      config: makeConfig({ mirror_usdc: 1, max_usdc_per_trade: 5 }),
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 5,
    });
    if (d.action !== "place") throw new Error("expected place");
    // SHARE_SPACE_MATH: result / price must be ≥ minShares
    expect(d.intent.size_usdc / d.intent.limit_price).toBeGreaterThanOrEqual(5);
    expect(d.intent.size_usdc).toBeCloseTo(3.2, 5);
  });

  it("skips with below_market_min when scaling would exceed ceiling", () => {
    // $1 @ 0.95 = 1.05 shares < 5 → scale to 5 shares = $4.75 > $2 ceiling → skip
    const fill = makeFill(0.95);
    const d = decide({
      fill,
      config: makeConfig({ mirror_usdc: 1, max_usdc_per_trade: 2 }),
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 5,
    });
    expect(d).toEqual({ action: "skip", reason: "below_market_min" });
  });

  it("legacy behavior: no min_shares input → no share-min guard, passes mirror_usdc as-is", () => {
    const fill = makeFill(0.64);
    const d = decide({
      fill,
      config: makeConfig({ mirror_usdc: 1, max_usdc_per_trade: 1 }),
      state: CLEAN_STATE,
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      // no min_shares: undefined
    });
    if (d.action !== "place") throw new Error("expected place");
    expect(d.intent.size_usdc).toBe(1);
  });

  it("daily cap gates the EFFECTIVE size, not the desired size", () => {
    // Scaled to $3.20 effective; today_spent 7.50 + 3.20 = 10.70 > 10 cap → skip daily_cap
    const fill = makeFill(0.64);
    const config: TargetConfig = {
      ...makeConfig({ mirror_usdc: 1, max_usdc_per_trade: 5 }),
      max_daily_usdc: 10,
    };
    const d = decide({
      fill,
      config,
      state: { ...CLEAN_STATE, today_spent_usdc: 7.5 },
      client_order_id: clientOrderIdFor(TARGET_ID, fill.fill_id),
      min_shares: 5,
    });
    expect(d).toEqual({ action: "skip", reason: "daily_cap_hit" });
  });
});
