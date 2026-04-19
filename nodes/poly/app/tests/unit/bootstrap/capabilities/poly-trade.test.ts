// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/bootstrap/capabilities/poly-trade`
 * Purpose: Unit tests for the poly-trade bundle — the env-driven `createPolyTradeCapability` (test mode wiring, env-gating) and the adapter-agnostic `createPolyTradeCapabilityFromAdapter` composition layer. Also asserts the CP4.3a seam split: `bundle.capability.placeTrade` and `bundle.placeIntent` share a single underlying `placeOrder` seam.
 * Scope: Does not invoke dynamic imports of `@polymarket/clob-client` or `@privy-io/node`. Uses `FakePolymarketClobAdapter` from `@/adapters/test` — the same fake the production test-mode branch wires.
 * Invariants: ENV_IS_SOLE_SWITCH (no test knob on the production factory); BUY_ONLY; PIN_CLIENT_ORDER_ID_HELPER (capability generates via `clientOrderIdFor`); SEAM_SHARES_ADAPTER (agent + placeIntent paths share one executor + one adapter).
 * Side-effects: none
 * Links: src/bootstrap/capabilities/poly-trade.ts, src/adapters/test/poly-trade/fake-polymarket-clob.adapter.ts
 * @internal
 */

import type { OrderIntent, OrderReceipt } from "@cogni/market-provider";
import { describe, expect, it, vi } from "vitest";

import { FakePolymarketClobAdapter } from "@/adapters/test";
import {
  createPolyTradeCapability,
  createPolyTradeCapabilityFromAdapter,
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
