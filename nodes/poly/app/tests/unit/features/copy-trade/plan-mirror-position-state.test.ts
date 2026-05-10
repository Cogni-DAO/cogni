// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/copy-trade/plan-mirror-position-state.test`
 * Purpose: Pure-function tests pinning the `state.position` plumbing — verify the planner accepts the new `MirrorPositionView` field, treats it as opaque (no behavior change in v0), and stays pure across N runs.
 * Scope: Pure function tests. No I/O. v0 does NOT yet branch on `state.position`; follow-on PRs (hedge-followup, SELL-mirror, layering) introduce the branches as predicates against this field.
 * Invariants: PLAN_IS_PURE — same input → same output across N runs.
 * Side-effects: none
 * Links: docs/spec/poly-copy-trade-execution.md
 * @internal
 */

import { clientOrderIdFor, type Fill } from "@cogni/poly-market-provider";
import { describe, expect, it } from "vitest";

import { planMirrorFromFill } from "@/features/copy-trade/plan-mirror";
import type {
  MirrorPositionView,
  MirrorTargetConfig,
  RuntimeState,
} from "@/features/copy-trade/types";

const TARGET_ID = "11111111-1111-1111-1111-111111111111";
const TARGET_WALLET = "0x2005d16a84ceefa912d4e380cd32e7ff827875ea";
const CONDITION = "prediction-market:polymarket:0xcondition";
const TOKEN_YES = "1111111111";
const TOKEN_NO = "2222222222";

const FILL: Fill = {
  target_wallet: TARGET_WALLET,
  fill_id: "data-api:0xhash:0xasset:BUY:1713300000",
  source: "data-api",
  market_id: CONDITION,
  outcome: "YES",
  side: "BUY",
  price: 0.6,
  size_usdc: 3.0,
  observed_at: "2024-04-16T21:20:00.000Z",
  attributes: { asset: TOKEN_YES, condition_id: "0xcondition" },
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

const COID = clientOrderIdFor(TARGET_ID, FILL.fill_id);

const POSITION_VIEW: MirrorPositionView = {
  condition_id: CONDITION,
  our_token_id: TOKEN_YES,
  our_qty_shares: 50,
  our_vwap_usdc: 0.55,
  opposite_token_id: TOKEN_NO,
  opposite_qty_shares: 0,
};

describe("planMirrorFromFill — state.position passthrough (v0)", () => {
  it("accepts state.position without affecting outcome (pure passthrough in v0)", () => {
    const stateNoPos: RuntimeState = { already_placed_ids: [] };
    const stateWithPos: RuntimeState = {
      already_placed_ids: [],
      position: POSITION_VIEW,
    };
    const planA = planMirrorFromFill({
      fill: FILL,
      config: CONFIG,
      state: stateNoPos,
      client_order_id: COID,
      min_usdc_notional: 1.0,
    });
    const planB = planMirrorFromFill({
      fill: FILL,
      config: CONFIG,
      state: stateWithPos,
      client_order_id: COID,
      min_usdc_notional: 1.0,
    });
    expect(planA).toEqual(planB);
  });

  it("PLAN_IS_PURE — repeat invocations with same inputs return deep-equal outputs", () => {
    const state: RuntimeState = {
      already_placed_ids: [],
      position: POSITION_VIEW,
    };
    const args = {
      fill: FILL,
      config: CONFIG,
      state,
      client_order_id: COID,
      min_usdc_notional: 1.0,
    };
    const a = planMirrorFromFill(args);
    const b = planMirrorFromFill(args);
    const c = planMirrorFromFill(args);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("does not mutate input state.position", () => {
    const before = JSON.parse(JSON.stringify(POSITION_VIEW));
    const state: RuntimeState = {
      already_placed_ids: [],
      position: POSITION_VIEW,
    };
    planMirrorFromFill({
      fill: FILL,
      config: CONFIG,
      state,
      client_order_id: COID,
      min_usdc_notional: 1.0,
    });
    expect(POSITION_VIEW).toEqual(before);
  });
});
