// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/bootstrap/capabilities/poly-trade`
 * Purpose: Unit tests for the poly-trade capability factory — env-gating (returns undefined when credentials are missing) and placeOrderOverride happy path.
 * Scope: Does not invoke dynamic imports of @polymarket/clob-client or @privy-io/node; the override path keeps them inert.
 * Invariants: CAPABILITY_FAIL_FAST, TEST_HOOK_IS_FACTORY_PARAM, BUY_ONLY.
 * Side-effects: none
 * Links: src/bootstrap/capabilities/poly-trade.ts
 * @internal
 */

import type { OrderIntent, OrderReceipt } from "@cogni/market-provider";
import { describe, expect, it, vi } from "vitest";

import { createPolyTradeCapability } from "@/bootstrap/capabilities/poly-trade";
import { makeNoopLogger } from "@/shared/observability/server";

const LOGGER = makeNoopLogger();

const OK_RECEIPT: OrderReceipt = {
  order_id: "0xresp",
  client_order_id: "0xabc",
  status: "filled",
  filled_size_usdc: 5,
  submitted_at: "2026-04-17T17:00:00.000Z",
  attributes: { rawStatus: "matched" },
};

describe("createPolyTradeCapability — env gating", () => {
  it("returns undefined when operatorWalletAddress is missing", async () => {
    const cap = await createPolyTradeCapability({
      logger: LOGGER,
      creds: { apiKey: "k", apiSecret: "s", passphrase: "p" },
      privy: { appId: "a", appSecret: "b", signingKey: "c" },
    });
    expect(cap).toBeUndefined();
  });

  it("returns undefined when CLOB creds are missing", async () => {
    const cap = await createPolyTradeCapability({
      logger: LOGGER,
      operatorWalletAddress: "0xdCCa8D85603C2CC47dc6974a790dF846f8695056",
      privy: { appId: "a", appSecret: "b", signingKey: "c" },
    });
    expect(cap).toBeUndefined();
  });

  it("returns undefined when Privy env is missing", async () => {
    const cap = await createPolyTradeCapability({
      logger: LOGGER,
      operatorWalletAddress: "0xdCCa8D85603C2CC47dc6974a790dF846f8695056",
      creds: { apiKey: "k", apiSecret: "s", passphrase: "p" },
    });
    expect(cap).toBeUndefined();
  });
});

describe("createPolyTradeCapability — placeOrderOverride", () => {
  const OPERATOR = "0xdCCa8D85603C2CC47dc6974a790dF846f8695056" as const;

  it("skips dynamic imports and wires the fake placeOrder", async () => {
    const placeOrder = vi.fn().mockResolvedValue(OK_RECEIPT);
    const cap = await createPolyTradeCapability({
      logger: LOGGER,
      operatorWalletAddress: OPERATOR,
      placeOrderOverride: placeOrder,
    });
    expect(cap).toBeDefined();

    const receipt = await cap?.placeTrade({
      conditionId:
        "0x302f5a4e8b475db09ef63f2df542ce3330599c3c4b4aa58173208a60229e1374",
      tokenId: "12345",
      outcome: "Yes",
      side: "BUY",
      size_usdc: 5,
      limit_price: 0.6,
      client_order_id:
        "0x0000000000000000000000000000000000000000000000000000000000000001",
    });

    expect(placeOrder).toHaveBeenCalledOnce();
    const intent = placeOrder.mock.calls[0]?.[0] as OrderIntent;
    expect(intent.provider).toBe("polymarket");
    expect(intent.side).toBe("BUY");
    expect(intent.size_usdc).toBe(5);
    expect(intent.limit_price).toBe(0.6);
    expect(intent.attributes?.token_id).toBe("12345");
    expect(intent.market_id).toContain("0x302f5a4e");

    expect(receipt?.order_id).toBe("0xresp");
    expect(receipt?.status).toBe("filled");
    expect(receipt?.profile_url).toBe(
      `https://polymarket.com/profile/${OPERATOR.toLowerCase()}`
    );
  });

  it("rejects SELL (BUY-only prototype)", async () => {
    const placeOrder = vi.fn().mockResolvedValue(OK_RECEIPT);
    const cap = await createPolyTradeCapability({
      logger: LOGGER,
      operatorWalletAddress: OPERATOR,
      placeOrderOverride: placeOrder,
    });

    await expect(
      cap?.placeTrade({
        conditionId:
          "0x302f5a4e8b475db09ef63f2df542ce3330599c3c4b4aa58173208a60229e1374",
        tokenId: "12345",
        outcome: "Yes",
        // @ts-expect-error — verifying runtime rejection of SELL
        side: "SELL",
        size_usdc: 5,
        limit_price: 0.6,
        client_order_id: "0x00",
      })
    ).rejects.toThrow(/SELL/);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("propagates executor errors (CLOB rejection)", async () => {
    const placeOrder = vi
      .fn()
      .mockRejectedValue(new Error("CLOB rejected order"));
    const cap = await createPolyTradeCapability({
      logger: LOGGER,
      operatorWalletAddress: OPERATOR,
      placeOrderOverride: placeOrder,
    });
    await expect(
      cap?.placeTrade({
        conditionId:
          "0x302f5a4e8b475db09ef63f2df542ce3330599c3c4b4aa58173208a60229e1374",
        tokenId: "12345",
        outcome: "Yes",
        side: "BUY",
        size_usdc: 5,
        limit_price: 0.6,
        client_order_id: "0x00",
      })
    ).rejects.toThrow(/CLOB rejected/);
  });
});
