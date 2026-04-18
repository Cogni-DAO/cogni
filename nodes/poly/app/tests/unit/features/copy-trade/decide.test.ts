// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/copy-trade/decide.test`
 * Purpose: Unit tests for the pure copy-trade `decide()` function — kill-switch fail-closed, intent-based caps, idempotency, mode=paper routing, action=place happy path.
 * Scope: Pure function tests. Does not hit the DB, does not import adapters.
 * Invariants: FAIL_CLOSED; INTENT_BASED_CAPS; IDEMPOTENT_BY_CLIENT_ID.
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 CP4.1)
 * @internal
 */

import { clientOrderIdFor, type Fill } from "@cogni/market-provider";
import { describe, expect, it } from "vitest";

import { decide } from "@/features/copy-trade/decide.js";
import type {
  RuntimeState,
  TargetConfig,
} from "@/features/copy-trade/types.js";

const TARGET_ID = "11111111-1111-1111-1111-111111111111";
const TARGET_WALLET = "0x2005d16a84ceefa912d4e380cd32e7ff827875ea";

const FILL: Fill = {
  target_wallet: TARGET_WALLET,
  fill_id: "data-api:0xhash:0xasset:BUY:1713300000",
  source: "data-api",
  market_id: "prediction-market:polymarket:0xcondition",
  outcome: "YES",
  side: "BUY",
  price: 0.6,
  size_usdc: 3.0,
  observed_at: "2024-04-16T21:20:00.000Z",
  attributes: { asset: "0xasset", condition_id: "0xcondition" },
};

const CONFIG: TargetConfig = {
  target_id: TARGET_ID,
  target_wallet: TARGET_WALLET,
  mode: "live",
  mirror_usdc: 1.0,
  max_daily_usdc: 10.0,
  max_fills_per_hour: 5,
  enabled: true,
};

const CLEAN_STATE: RuntimeState = {
  today_spent_usdc: 0,
  fills_last_hour: 0,
  already_placed_ids: [],
};

const COID = clientOrderIdFor(TARGET_ID, FILL.fill_id);

describe("decide() — skip branches", () => {
  it("kill_switch_off when config.enabled=false (fail-closed)", () => {
    const d = decide({
      fill: FILL,
      config: { ...CONFIG, enabled: false },
      state: CLEAN_STATE,
      client_order_id: COID,
    });
    expect(d).toEqual({ action: "skip", reason: "kill_switch_off" });
  });

  it("already_placed when client_order_id is in already_placed_ids", () => {
    const d = decide({
      fill: FILL,
      config: CONFIG,
      state: { ...CLEAN_STATE, already_placed_ids: [COID] },
      client_order_id: COID,
    });
    expect(d).toEqual({ action: "skip", reason: "already_placed" });
  });

  it("daily_cap_hit when next intent would exceed max_daily_usdc", () => {
    const d = decide({
      fill: FILL,
      config: { ...CONFIG, mirror_usdc: 1.0, max_daily_usdc: 5.0 },
      state: { ...CLEAN_STATE, today_spent_usdc: 4.5 },
      client_order_id: COID,
    });
    expect(d).toEqual({ action: "skip", reason: "daily_cap_hit" });
  });

  it("daily_cap_hit on strict > (equality is allowed)", () => {
    // 4.0 + 1.0 = 5.0, NOT > 5.0 → should be allowed
    const d = decide({
      fill: FILL,
      config: { ...CONFIG, mirror_usdc: 1.0, max_daily_usdc: 5.0 },
      state: { ...CLEAN_STATE, today_spent_usdc: 4.0 },
      client_order_id: COID,
    });
    expect(d.action).toBe("place");
  });

  it("rate_cap_hit when fills_last_hour >= max_fills_per_hour", () => {
    const d = decide({
      fill: FILL,
      config: { ...CONFIG, max_fills_per_hour: 5 },
      state: { ...CLEAN_STATE, fills_last_hour: 5 },
      client_order_id: COID,
    });
    expect(d).toEqual({ action: "skip", reason: "rate_cap_hit" });
  });

  it("short-circuits in order: kill > already > daily > rate", () => {
    // Every branch hits — reason must be the FIRST one checked.
    const d = decide({
      fill: FILL,
      config: {
        ...CONFIG,
        enabled: false,
        max_daily_usdc: 0.5,
        max_fills_per_hour: 0,
      },
      state: {
        today_spent_usdc: 999,
        fills_last_hour: 999,
        already_placed_ids: [COID],
      },
      client_order_id: COID,
    });
    expect(d.reason).toBe("kill_switch_off");
  });
});

describe("decide() — place branches", () => {
  it("action=place + reason=ok for mode=live with guards clear", () => {
    const d = decide({
      fill: FILL,
      config: CONFIG,
      state: CLEAN_STATE,
      client_order_id: COID,
    });
    if (d.action !== "place") throw new Error("expected place");
    expect(d.reason).toBe("ok");
    expect(d.intent.provider).toBe("polymarket");
    expect(d.intent.market_id).toBe(FILL.market_id);
    expect(d.intent.outcome).toBe("YES");
    expect(d.intent.side).toBe("BUY");
    expect(d.intent.size_usdc).toBe(CONFIG.mirror_usdc);
    expect(d.intent.limit_price).toBe(FILL.price);
    expect(d.intent.client_order_id).toBe(COID);
    expect(d.intent.attributes?.token_id).toBe("0xasset");
    expect(d.intent.attributes?.source_fill_id).toBe(FILL.fill_id);
    expect(d.intent.attributes?.target_wallet).toBe(FILL.target_wallet);
  });

  it("action=place + reason=mode_paper when config.mode='paper'", () => {
    const d = decide({
      fill: FILL,
      config: { ...CONFIG, mode: "paper" },
      state: CLEAN_STATE,
      client_order_id: COID,
    });
    if (d.action !== "place") throw new Error("expected place");
    expect(d.reason).toBe("mode_paper");
    // Intent.provider stays polymarket — routing is an executor concern.
    expect(d.intent.provider).toBe("polymarket");
  });

  it("empty token_id is passed through (executor rejects)", () => {
    const fillNoAsset: Fill = { ...FILL, attributes: {} };
    const d = decide({
      fill: fillNoAsset,
      config: CONFIG,
      state: CLEAN_STATE,
      client_order_id: COID,
    });
    if (d.action !== "place") throw new Error("expected place");
    expect(d.intent.attributes?.token_id).toBe("");
  });
});

describe("decide() — idempotency round-trip", () => {
  it("client_order_id from clientOrderIdFor is what gates already_placed", () => {
    const coid = clientOrderIdFor(CONFIG.target_id, FILL.fill_id);
    // First call → place
    const first = decide({
      fill: FILL,
      config: CONFIG,
      state: CLEAN_STATE,
      client_order_id: coid,
    });
    expect(first.action).toBe("place");
    // Poll re-runs; caller records `coid` → already_placed now skips.
    const second = decide({
      fill: FILL,
      config: CONFIG,
      state: { ...CLEAN_STATE, already_placed_ids: [coid] },
      client_order_id: coid,
    });
    expect(second).toEqual({ action: "skip", reason: "already_placed" });
  });
});
