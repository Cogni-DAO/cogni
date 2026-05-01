// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/copy-trade/plan-mirror-placement.test`
 * Purpose: Verify `MirrorTargetConfig.placement` flows into
 *   `intent.attributes.placement` so the adapter can switch order type
 *   (PLACEMENT_DISCRIMINATOR_IN_ATTRIBUTES, task.5001).
 * Scope: Pure function. No DB, no adapter.
 * Side-effects: none
 * Links: work/items/task.5001
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
  attributes: { asset: "0xasset" },
};

function makeConfig(
  overrides: Partial<MirrorTargetConfig>
): MirrorTargetConfig {
  return {
    target_id: TARGET_ID,
    target_wallet: TARGET_WALLET,
    billing_account_id: "b1",
    created_by_user_id: "u1",
    mode: "live",
    sizing: { kind: "min_bet", max_usdc_per_trade: 5 },
    placement: { kind: "mirror_limit" },
    ...overrides,
  };
}

const STATE: RuntimeState = { already_placed_ids: [] };
const COID = clientOrderIdFor(TARGET_ID, FILL.fill_id);

describe("planMirrorFromFill() — placement → intent.attributes.placement", () => {
  it("mirror_limit policy → intent.attributes.placement === 'limit'", () => {
    const plan = planMirrorFromFill({
      fill: FILL,
      config: makeConfig({ placement: { kind: "mirror_limit" } }),
      state: STATE,
      client_order_id: COID,
      min_usdc_notional: 1,
    });
    expect(plan.kind).toBe("place");
    if (plan.kind !== "place") return;
    expect(plan.intent.attributes?.placement).toBe("limit");
  });

  it("market_fok policy → intent.attributes.placement === 'market_fok'", () => {
    const plan = planMirrorFromFill({
      fill: FILL,
      config: makeConfig({ placement: { kind: "market_fok" } }),
      state: STATE,
      client_order_id: COID,
      min_usdc_notional: 1,
    });
    expect(plan.kind).toBe("place");
    if (plan.kind !== "place") return;
    expect(plan.intent.attributes?.placement).toBe("market_fok");
  });
});
