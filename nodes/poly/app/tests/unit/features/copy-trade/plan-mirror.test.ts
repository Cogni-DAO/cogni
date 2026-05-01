// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/copy-trade/plan-mirror.test`
 * Purpose: Unit tests for the pure copy-trade `planMirrorFromFill()` function — idempotency, mode=paper routing, happy path `{kind: "place"}`.
 * Scope: Pure function tests. Does not hit the DB, does not import adapters. Daily / hourly cap enforcement moved to `authorizeIntent` (CAPS_LIVE_IN_GRANT) and lives in adapter component tests.
 * Invariants: IDEMPOTENT_BY_CLIENT_ID. (bug.0438 dropped the kill-switch.)
 * Side-effects: none
 * Links: work/items/task.0318 (Phase B3)
 * @internal
 */

import { clientOrderIdFor, type Fill } from "@cogni/poly-market-provider";
import { describe, expect, it } from "vitest";

import { planMirrorFromFill } from "@/features/copy-trade/plan-mirror";
import type {
  MirrorTargetConfig,
  RuntimeState,
} from "@/features/copy-trade/types";

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

const CONFIG: MirrorTargetConfig = {
  target_id: TARGET_ID,
  target_wallet: TARGET_WALLET,
  billing_account_id: "00000000-0000-4000-b000-000000000000",
  created_by_user_id: "00000000-0000-4000-a000-000000000001",
  mode: "live",
  sizing: {
    kind: "min_bet",
    max_usdc_per_trade: 1.0,
  },
  placement: { kind: "mirror_limit" },
};

const CLEAN_STATE: RuntimeState = {
  already_placed_ids: [],
};

const COID = clientOrderIdFor(TARGET_ID, FILL.fill_id);

describe("planMirrorFromFill() — skip branches", () => {
  it("already_placed when client_order_id is in already_placed_ids", () => {
    const d = planMirrorFromFill({
      fill: FILL,
      config: CONFIG,
      state: { ...CLEAN_STATE, already_placed_ids: [COID] },
      client_order_id: COID,
    });
    expect(d).toEqual({
      kind: "skip",
      reason: "already_placed",
      position_branch: "new_entry",
    });
  });
});

describe("planMirrorFromFill() — place branches", () => {
  it("kind=place + reason=ok for mode=live with guards clear", () => {
    const d = planMirrorFromFill({
      fill: FILL,
      config: CONFIG,
      state: CLEAN_STATE,
      client_order_id: COID,
      min_usdc_notional: 1.0,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.reason).toBe("ok");
    expect(d.intent.provider).toBe("polymarket");
    expect(d.intent.market_id).toBe(FILL.market_id);
    expect(d.intent.outcome).toBe("YES");
    expect(d.intent.side).toBe("BUY");
    expect(d.intent.size_usdc).toBe(1.0);
    expect(d.intent.limit_price).toBe(FILL.price);
    expect(d.intent.client_order_id).toBe(COID);
    expect(d.intent.attributes?.token_id).toBe("0xasset");
    expect(d.intent.attributes?.condition_id).toBe("0xcondition");
    expect(d.intent.attributes?.source_fill_id).toBe(FILL.fill_id);
    expect(d.intent.attributes?.target_wallet).toBe(FILL.target_wallet);
  });

  it("rounds limit_price to nearest market tick when representable", () => {
    const d = planMirrorFromFill({
      fill: { ...FILL, price: 0.991000089100001 },
      config: CONFIG,
      state: CLEAN_STATE,
      client_order_id: COID,
      min_usdc_notional: 1.0,
      tick_size: 0.01,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.intent.limit_price).toBe(0.99);
  });

  it("preserves finer tick markets instead of applying a hardcoded penny tick", () => {
    const d = planMirrorFromFill({
      fill: { ...FILL, price: 0.0023 },
      config: CONFIG,
      state: CLEAN_STATE,
      client_order_id: COID,
      min_usdc_notional: 1.0,
      tick_size: 0.001,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.intent.limit_price).toBe(0.002);
  });

  it("rounds top-edge float bleed to the highest valid tick", () => {
    const d = planMirrorFromFill({
      fill: { ...FILL, price: 0.99995 },
      config: CONFIG,
      state: CLEAN_STATE,
      client_order_id: COID,
      min_usdc_notional: 1.0,
      tick_size: 0.0001,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.intent.limit_price).toBe(0.9999);
  });

  it("skips when target price is too far outside the market tick grid", () => {
    const d = planMirrorFromFill({
      fill: { ...FILL, price: 0.002 },
      config: CONFIG,
      state: CLEAN_STATE,
      client_order_id: COID,
      min_usdc_notional: 1.0,
      tick_size: 0.01,
    });
    expect(d).toEqual({
      kind: "skip",
      reason: "price_outside_clob_bounds",
      position_branch: "new_entry",
    });
  });

  it("kind=place + reason=mode_paper when config.mode='paper'", () => {
    const d = planMirrorFromFill({
      fill: FILL,
      config: { ...CONFIG, mode: "paper" },
      state: CLEAN_STATE,
      client_order_id: COID,
      min_usdc_notional: 1.0,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.reason).toBe("mode_paper");
    expect(d.intent.provider).toBe("polymarket");
  });

  it("empty token_id is passed through (executor rejects)", () => {
    const fillNoAsset: Fill = { ...FILL, attributes: {} };
    const d = planMirrorFromFill({
      fill: fillNoAsset,
      config: CONFIG,
      state: CLEAN_STATE,
      client_order_id: COID,
      min_usdc_notional: 1.0,
    });
    if (d.kind !== "place") throw new Error("expected place");
    expect(d.intent.attributes?.token_id).toBe("");
  });
});

describe("planMirrorFromFill() — idempotency round-trip", () => {
  it("client_order_id from clientOrderIdFor is what gates already_placed", () => {
    const coid = clientOrderIdFor(CONFIG.target_id, FILL.fill_id);
    const first = planMirrorFromFill({
      fill: FILL,
      config: CONFIG,
      state: CLEAN_STATE,
      client_order_id: coid,
      min_usdc_notional: 1.0,
    });
    expect(first.kind).toBe("place");
    const second = planMirrorFromFill({
      fill: FILL,
      config: CONFIG,
      state: { already_placed_ids: [coid] },
      client_order_id: coid,
      min_usdc_notional: 1.0,
    });
    expect(second).toEqual({
      kind: "skip",
      reason: "already_placed",
      position_branch: "new_entry",
    });
  });
});
