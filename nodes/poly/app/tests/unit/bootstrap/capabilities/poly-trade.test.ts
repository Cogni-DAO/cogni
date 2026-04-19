// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/bootstrap/capabilities/poly-trade`
 * Purpose: Unit tests for the poly-trade bundle — env-driven factory, adapter-agnostic composition, and closePosition/getOrder/getOperatorPositions seams.
 * Scope: Does not invoke dynamic imports of `@polymarket/clob-client` or `@privy-io/node`. Uses `FakePolymarketClobAdapter` from `@/adapters/test`.
 * Invariants: ENV_IS_SOLE_SWITCH; PLACE_TRADE_IS_BUY_ONLY; CLOSE_POSITION_IS_SELL_ONLY; PIN_CLIENT_ORDER_ID_HELPER; SEAM_SHARES_ADAPTER.
 * Side-effects: none
 * Links: src/bootstrap/capabilities/poly-trade.ts, src/adapters/test/poly-trade/fake-polymarket-clob.adapter.ts
 * @internal
 */

import type { OrderIntent, OrderReceipt } from "@cogni/market-provider";
import type { PolymarketUserPosition } from "@cogni/market-provider/adapters/polymarket";
import { describe, expect, it, vi } from "vitest";

import { FakePolymarketClobAdapter } from "@/adapters/test";
import {
  createPolyTradeCapability,
  createPolyTradeCapabilityFromAdapter,
  PolyTradeError,
} from "@/bootstrap/capabilities/poly-trade";
import { makeNoopLogger } from "@/shared/observability/server";

const LOGGER = makeNoopLogger();
const OPERATOR = "0xdCCa8D85603C2CC47dc6974a790dF846f8695056" as const;
const CONDITION_ID =
  "0x302f5a4e8b475db09ef63f2df542ce3330599c3c4b4aa58173208a60229e1374";

const OK_RECEIPT: OrderReceipt = {
  order_id: "0xresp",
  client_order_id: "0xignored",
  status: "filled",
  filled_size_usdc: 5,
  submitted_at: "2026-04-17T17:00:00.000Z",
  attributes: { rawStatus: "matched" },
};

// ─────────────────────────────────────────────────────────────────────────────
// createPolyTradeCapability — env-driven factory
// ─────────────────────────────────────────────────────────────────────────────

describe("createPolyTradeCapability — test mode", () => {
  it("wires FakePolymarketClobAdapter when isTestMode=true (no env required)", async () => {
    const bundle = createPolyTradeCapability({
      logger: LOGGER,
      isTestMode: true,
    });
    expect(bundle).toBeDefined();
    expect(bundle?.placeIntent).toBeTypeOf("function");
    expect(bundle?.operatorWalletAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const receipt = await bundle?.capability.placeTrade({
      conditionId: CONDITION_ID,
      tokenId: "12345",
      outcome: "Yes",
      side: "BUY",
      size_usdc: 5,
      limit_price: 0.6,
    });
    expect(receipt?.status).toBeDefined();
    expect(receipt?.profile_url).toContain("polymarket.com/profile/");
  });
});

describe("createPolyTradeCapability — env gating (production)", () => {
  it("returns undefined when operatorWalletAddress is missing", () => {
    const bundle = createPolyTradeCapability({
      logger: LOGGER,
      isTestMode: false,
      creds: { apiKey: "k", apiSecret: "s", passphrase: "p" },
      privy: { appId: "a", appSecret: "b", signingKey: "c" },
    });
    expect(bundle).toBeUndefined();
  });

  it("returns undefined when CLOB creds are missing", () => {
    const bundle = createPolyTradeCapability({
      logger: LOGGER,
      isTestMode: false,
      operatorWalletAddress: OPERATOR,
      privy: { appId: "a", appSecret: "b", signingKey: "c" },
    });
    expect(bundle).toBeUndefined();
  });

  it("returns undefined when Privy env is missing", () => {
    const bundle = createPolyTradeCapability({
      logger: LOGGER,
      isTestMode: false,
      operatorWalletAddress: OPERATOR,
      creds: { apiKey: "k", apiSecret: "s", passphrase: "p" },
    });
    expect(bundle).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createPolyTradeCapabilityFromAdapter — pure composition
// ─────────────────────────────────────────────────────────────────────────────

describe("createPolyTradeCapabilityFromAdapter", () => {
  it("wraps a fake placeOrder and produces a receipt with profile_url", async () => {
    const fake = new FakePolymarketClobAdapter();
    const { capability: cap } = createPolyTradeCapabilityFromAdapter({
      placeOrder: fake.placeOrder.bind(fake),
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
    });

    const receipt = await cap.placeTrade({
      conditionId: CONDITION_ID,
      tokenId: "12345",
      outcome: "Yes",
      side: "BUY",
      size_usdc: 5,
      limit_price: 0.6,
    });

    expect(fake.calls).toHaveLength(1);
    const intent = fake.calls[0] as OrderIntent;
    expect(intent.provider).toBe("polymarket");
    expect(intent.side).toBe("BUY");
    expect(intent.size_usdc).toBe(5);
    expect(intent.limit_price).toBe(0.6);
    expect(intent.attributes?.token_id).toBe("12345");
    expect(intent.market_id).toContain("0x302f5a4e");
    // Capability generates the client_order_id via the pinned helper — format
    // is 0x + 64 hex chars (keccak256 digest). Length is the strong signal.
    expect(intent.client_order_id).toMatch(/^0x[0-9a-f]{64}$/);

    expect(receipt.profile_url).toBe(
      `https://polymarket.com/profile/${OPERATOR.toLowerCase()}`
    );
  });

  it("generates a distinct client_order_id across successive placements", async () => {
    const fake = new FakePolymarketClobAdapter();
    const { capability: cap } = createPolyTradeCapabilityFromAdapter({
      placeOrder: fake.placeOrder.bind(fake),
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
    });

    const request = {
      conditionId: CONDITION_ID,
      tokenId: "12345",
      outcome: "Yes",
      side: "BUY" as const,
      size_usdc: 1,
      limit_price: 0.5,
    };

    await cap.placeTrade(request);
    // `clientOrderIdFor` mixes Date.now(); advance the clock a couple ticks to
    // deflake — 1ms setTimeout sometimes resolves in the same millisecond.
    await new Promise((r) => setTimeout(r, 3));
    await cap.placeTrade(request);

    expect(fake.calls[0]?.client_order_id).not.toBe(
      fake.calls[1]?.client_order_id
    );
  });

  it("rejects SELL (BUY-only prototype)", async () => {
    const placeOrder = vi.fn().mockResolvedValue(OK_RECEIPT);
    const { capability: cap } = createPolyTradeCapabilityFromAdapter({
      placeOrder,
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
    });

    await expect(
      cap.placeTrade({
        conditionId: CONDITION_ID,
        tokenId: "12345",
        outcome: "Yes",
        // @ts-expect-error — verifying runtime rejection of SELL
        side: "SELL",
        size_usdc: 5,
        limit_price: 0.6,
      })
    ).rejects.toThrow(/SELL/);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("propagates executor errors (CLOB rejection)", async () => {
    const fake = new FakePolymarketClobAdapter({
      rejectWith: new Error("CLOB rejected order"),
    });
    const { capability: cap } = createPolyTradeCapabilityFromAdapter({
      placeOrder: fake.placeOrder.bind(fake),
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
    });

    await expect(
      cap.placeTrade({
        conditionId: CONDITION_ID,
        tokenId: "12345",
        outcome: "Yes",
        side: "BUY",
        size_usdc: 5,
        limit_price: 0.6,
      })
    ).rejects.toThrow(/CLOB rejected/);
  });

  it("factory can be called multiple times (prom-registry hot-reload safe)", async () => {
    const fake = new FakePolymarketClobAdapter();
    const request = {
      conditionId: CONDITION_ID,
      tokenId: "12345",
      outcome: "Yes",
      side: "BUY" as const,
      size_usdc: 1,
      limit_price: 0.5,
    };
    // Call placeTrade on both so the MetricsPort actually registers counters
    // against the shared prom-client registry. Without this, the counters are
    // never created and the "metric already registered" regression wouldn't
    // fire regardless of how many factory instances exist.
    const { capability: cap1 } = createPolyTradeCapabilityFromAdapter({
      placeOrder: fake.placeOrder.bind(fake),
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
    });
    await cap1.placeTrade(request);
    const { capability: cap2 } = createPolyTradeCapabilityFromAdapter({
      placeOrder: fake.placeOrder.bind(fake),
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
    });
    await expect(cap2.placeTrade(request)).resolves.toBeDefined();
  });

  it("agent path + placeIntent seam share ONE underlying placeOrder (SEAM_SHARES_ADAPTER)", async () => {
    // CP4.3a invariant: `bundle.capability.placeTrade` and `bundle.placeIntent`
    // both route through the same executor + the same injected placeOrder seam.
    // Zero adapter duplication across agent and autonomous paths.
    const placeOrder = vi.fn(
      async (intent: OrderIntent): Promise<OrderReceipt> => ({
        order_id: `0xfrom_seam_${placeOrder.mock.calls.length}`,
        client_order_id: intent.client_order_id,
        status: "open",
        filled_size_usdc: 0,
        submitted_at: new Date().toISOString(),
      })
    );
    const bundle = createPolyTradeCapabilityFromAdapter({
      placeOrder,
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
    });

    // 1) Agent-tool path
    await bundle.capability.placeTrade({
      conditionId: CONDITION_ID,
      tokenId: "12345",
      outcome: "Yes",
      side: "BUY",
      size_usdc: 1,
      limit_price: 0.5,
    });

    // 2) Raw placeIntent seam (what the mirror-coordinator uses)
    const callerIntent: OrderIntent = {
      provider: "polymarket",
      market_id: "prediction-market:polymarket:0xabc",
      outcome: "Yes",
      side: "BUY",
      size_usdc: 1,
      limit_price: 0.5,
      // Caller-supplied client_order_id — mirror path uses
      // `clientOrderIdFor(target_id, fill_id)` here, not the agent-path helper.
      client_order_id:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      attributes: { token_id: "12345", source_fill_id: "data-api:0xtx" },
    };
    await bundle.placeIntent(callerIntent);

    // Both paths hit the SAME placeOrder seam — two calls total.
    expect(placeOrder).toHaveBeenCalledTimes(2);
    // Agent path generated a cid via `clientOrderIdFor("agent", …)`; seam path
    // passed the caller-supplied cid through untouched.
    const agentCid = placeOrder.mock.calls[0]?.[0].client_order_id;
    const seamCid = placeOrder.mock.calls[1]?.[0].client_order_id;
    expect(agentCid).toMatch(/^0x[0-9a-f]{64}$/);
    expect(seamCid).toBe(callerIntent.client_order_id);
    expect(agentCid).not.toBe(seamCid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// closePosition
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_ID = "99999";
const CLOSE_CLIENT_ORDER_ID =
  "0xaaaa000000000000000000000000000000000000000000000000000000000001" as const;

function makePosition(
  overrides: Partial<PolymarketUserPosition> = {}
): PolymarketUserPosition {
  return {
    proxyWallet: OPERATOR,
    asset: TOKEN_ID,
    conditionId: CONDITION_ID,
    size: 10,
    avgPrice: 0.6,
    initialValue: 6,
    currentValue: 6,
    cashPnl: 0,
    percentPnl: 0,
    realizedPnl: 0,
    curPrice: 0.6,
    redeemable: false,
    title: "",
    outcome: "Yes",
    ...overrides,
  };
}

describe("closePosition", () => {
  it("happy path: position exists → SELL intent hits executor with correct size", async () => {
    const position = makePosition();
    const fake = new FakePolymarketClobAdapter({
      positions: [position],
    });
    const bundle = createPolyTradeCapabilityFromAdapter({
      placeOrder: fake.placeOrder.bind(fake),
      listOpenOrders: fake.listOpenOrders.bind(fake),
      cancelOrder: fake.cancelOrder.bind(fake),
      getOrder: fake.getOrder.bind(fake),
      listPositions: fake.listPositions.bind(fake),
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
    });

    const receipt = await bundle.closePosition({
      tokenId: TOKEN_ID,
      max_size_usdc: 100,
      client_order_id: CLOSE_CLIENT_ORDER_ID,
    });

    expect(receipt.status).toBeDefined();
    // Should have issued one SELL intent
    expect(fake.calls).toHaveLength(1);
    const intent = fake.calls[0] as OrderIntent;
    expect(intent.side).toBe("SELL");
    expect(intent.client_order_id).toBe(CLOSE_CLIENT_ORDER_ID);
    expect(intent.attributes?.token_id).toBe(TOKEN_ID);
    // effective_size = min(100, 10 * 0.6) = 6
    expect(intent.size_usdc).toBeCloseTo(6);
  });

  it("no position → throws PolyTradeError(no_position_to_close)", async () => {
    const fake = new FakePolymarketClobAdapter({ positions: [] });
    const bundle = createPolyTradeCapabilityFromAdapter({
      placeOrder: fake.placeOrder.bind(fake),
      listOpenOrders: fake.listOpenOrders.bind(fake),
      cancelOrder: fake.cancelOrder.bind(fake),
      getOrder: fake.getOrder.bind(fake),
      listPositions: fake.listPositions.bind(fake),
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
    });

    let caughtError: unknown;
    try {
      await bundle.closePosition({
        tokenId: TOKEN_ID,
        max_size_usdc: 100,
        client_order_id: CLOSE_CLIENT_ORDER_ID,
      });
    } catch (e) {
      caughtError = e;
    }
    expect(caughtError).toBeInstanceOf(PolyTradeError);
    expect((caughtError as PolyTradeError).code).toBe("no_position_to_close");
    expect(fake.calls).toHaveLength(0);
  });

  it("sizing cap: max_size_usdc > position value → size = position value", async () => {
    // position value = 10 * 0.6 = 6 USDC; cap = 100 → effective = 6
    const position = makePosition({ size: 10, curPrice: 0.6 });
    const fake = new FakePolymarketClobAdapter({ positions: [position] });
    const bundle = createPolyTradeCapabilityFromAdapter({
      placeOrder: fake.placeOrder.bind(fake),
      listOpenOrders: fake.listOpenOrders.bind(fake),
      cancelOrder: fake.cancelOrder.bind(fake),
      getOrder: fake.getOrder.bind(fake),
      listPositions: fake.listPositions.bind(fake),
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
    });

    await bundle.closePosition({
      tokenId: TOKEN_ID,
      max_size_usdc: 100,
      client_order_id: CLOSE_CLIENT_ORDER_ID,
    });

    const intent = fake.calls[0] as OrderIntent;
    expect(intent.size_usdc).toBeCloseTo(6); // min(100, 6) = 6
  });

  it("sizing cap: max_size_usdc < position value → size = max_size_usdc", async () => {
    // position value = 10 * 0.6 = 6 USDC; cap = 3 → effective = 3
    const position = makePosition({ size: 10, curPrice: 0.6 });
    const fake = new FakePolymarketClobAdapter({ positions: [position] });
    const bundle = createPolyTradeCapabilityFromAdapter({
      placeOrder: fake.placeOrder.bind(fake),
      listOpenOrders: fake.listOpenOrders.bind(fake),
      cancelOrder: fake.cancelOrder.bind(fake),
      getOrder: fake.getOrder.bind(fake),
      listPositions: fake.listPositions.bind(fake),
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
    });

    await bundle.closePosition({
      tokenId: TOKEN_ID,
      max_size_usdc: 3,
      client_order_id: CLOSE_CLIENT_ORDER_ID,
    });

    const intent = fake.calls[0] as OrderIntent;
    expect(intent.size_usdc).toBeCloseTo(3); // min(3, 6) = 3
  });

  it("capability.closePosition routes to bundle.closePosition", async () => {
    const position = makePosition();
    const fake = new FakePolymarketClobAdapter({ positions: [position] });
    const bundle = createPolyTradeCapabilityFromAdapter({
      placeOrder: fake.placeOrder.bind(fake),
      listOpenOrders: fake.listOpenOrders.bind(fake),
      cancelOrder: fake.cancelOrder.bind(fake),
      getOrder: fake.getOrder.bind(fake),
      listPositions: fake.listPositions.bind(fake),
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
    });

    const receipt = await bundle.capability.closePosition({
      tokenId: TOKEN_ID,
      max_size_usdc: 100,
    });

    expect(receipt.profile_url).toContain("polymarket.com/profile/");
    expect(fake.calls).toHaveLength(1);
    expect((fake.calls[0] as OrderIntent).side).toBe("SELL");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getOrder + getOperatorPositions
// ─────────────────────────────────────────────────────────────────────────────

describe("getOrder", () => {
  it("returns { found: receipt } after a placeOrder call", async () => {
    const fake = new FakePolymarketClobAdapter();
    const bundle = createPolyTradeCapabilityFromAdapter({
      placeOrder: fake.placeOrder.bind(fake),
      listOpenOrders: fake.listOpenOrders.bind(fake),
      cancelOrder: fake.cancelOrder.bind(fake),
      getOrder: fake.getOrder.bind(fake),
      listPositions: fake.listPositions.bind(fake),
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
    });

    await bundle.capability.placeTrade({
      conditionId: CONDITION_ID,
      tokenId: TOKEN_ID,
      outcome: "Yes",
      side: "BUY",
      size_usdc: 5,
      limit_price: 0.6,
    });

    const storedReceipt = fake.orderStore.values().next().value as OrderReceipt;
    const result = await bundle.getOrder(storedReceipt.order_id);
    // GETORDER_NEVER_NULL (task.0328 CP1): result is a discriminated union
    expect("found" in result).toBe(true);
    if ("found" in result) {
      expect(result.found.order_id).toBe(storedReceipt.order_id);
    }
  });

  it("returns { status: 'not_found' } for unknown order id (was: null — task.0328 CP1)", async () => {
    const fake = new FakePolymarketClobAdapter();
    const bundle = createPolyTradeCapabilityFromAdapter({
      placeOrder: fake.placeOrder.bind(fake),
      listOpenOrders: fake.listOpenOrders.bind(fake),
      cancelOrder: fake.cancelOrder.bind(fake),
      getOrder: fake.getOrder.bind(fake),
      listPositions: fake.listPositions.bind(fake),
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
    });

    const result = await bundle.getOrder("0xunknown");
    expect(result).toEqual({ status: "not_found" });
  });
});

describe("getOperatorPositions", () => {
  it("returns pre-seeded positions", async () => {
    const position = makePosition();
    const fake = new FakePolymarketClobAdapter({ positions: [position] });
    const bundle = createPolyTradeCapabilityFromAdapter({
      placeOrder: fake.placeOrder.bind(fake),
      listOpenOrders: fake.listOpenOrders.bind(fake),
      cancelOrder: fake.cancelOrder.bind(fake),
      getOrder: fake.getOrder.bind(fake),
      listPositions: fake.listPositions.bind(fake),
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
    });

    const positions = await bundle.getOperatorPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]?.asset).toBe(TOKEN_ID);
  });

  it("returns empty array when no listPositions dep is provided", async () => {
    const fake = new FakePolymarketClobAdapter();
    const bundle = createPolyTradeCapabilityFromAdapter({
      placeOrder: fake.placeOrder.bind(fake),
      listOpenOrders: fake.listOpenOrders.bind(fake),
      cancelOrder: fake.cancelOrder.bind(fake),
      // No getOrder, no listPositions
      operatorWalletAddress: OPERATOR,
      logger: LOGGER,
    });

    const positions = await bundle.getOperatorPositions();
    expect(positions).toHaveLength(0);
  });
});
