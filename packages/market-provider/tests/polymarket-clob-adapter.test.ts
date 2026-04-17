// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/tests/polymarket-clob-adapter`
 * Purpose: Unit tests for `PolymarketClobAdapter` — verifies OrderIntent↔CLOB mapping and status normalization without hitting the network.
 * Scope: Pure mapping helpers (exported) + adapter methods driven by a mocked ClobClient. Does not exercise real HTTPS, Privy, or viem signing.
 * Invariants: IDEMPOTENT_BY_CLIENT_ID (client_order_id echoes intent verbatim), status mapping is total.
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 — CP3.2)
 * @internal
 */

import { describe, expect, it, vi } from "vitest";

import {
  mapOpenOrderToReceipt,
  mapOrderResponseToReceipt,
  normalizePolymarketStatus,
  PolymarketClobAdapter,
} from "../src/adapters/polymarket/polymarket.clob.adapter.js";
import type { OrderIntent } from "../src/domain/order.js";

const BASE_INTENT: OrderIntent = {
  provider: "polymarket",
  market_id: "prediction-market:polymarket:0xabc",
  outcome: "YES",
  side: "BUY",
  size_usdc: 1,
  limit_price: 0.5,
  client_order_id: "0xclientid",
  attributes: { token_id: "7132104567...token" },
};

describe("normalizePolymarketStatus", () => {
  it("maps known statuses to canonical values", () => {
    expect(normalizePolymarketStatus("live")).toBe("open");
    expect(normalizePolymarketStatus("placed")).toBe("open");
    expect(normalizePolymarketStatus("unmatched")).toBe("open");
    expect(normalizePolymarketStatus("matched")).toBe("filled");
    expect(normalizePolymarketStatus("filled")).toBe("filled");
    expect(normalizePolymarketStatus("canceled")).toBe("canceled");
    expect(normalizePolymarketStatus("cancelled")).toBe("canceled");
    expect(normalizePolymarketStatus("error")).toBe("error");
    expect(normalizePolymarketStatus("partial_fill")).toBe("partial");
  });

  it("defaults unknown statuses to pending", () => {
    expect(normalizePolymarketStatus("SOMETHING_NEW")).toBe("pending");
  });
});

describe("mapOrderResponseToReceipt", () => {
  it("echoes client_order_id from the intent verbatim", () => {
    const receipt = mapOrderResponseToReceipt(
      { orderID: "0xorder1", status: "live" },
      BASE_INTENT
    );
    expect(receipt.client_order_id).toBe(BASE_INTENT.client_order_id);
    expect(receipt.order_id).toBe("0xorder1");
    expect(receipt.status).toBe("open");
    expect(receipt.filled_size_usdc).toBe(0);
  });

  it("converts makingAmount atomic units to USDC dollars on BUY", () => {
    const receipt = mapOrderResponseToReceipt(
      { orderID: "0xorder2", status: "matched", makingAmount: "1000000" },
      BASE_INTENT
    );
    expect(receipt.filled_size_usdc).toBe(1);
    expect(receipt.status).toBe("filled");
  });

  it("uses takingAmount for SELL-side receipts", () => {
    const sellIntent: OrderIntent = { ...BASE_INTENT, side: "SELL" };
    const receipt = mapOrderResponseToReceipt(
      { orderID: "0xorder3", status: "matched", takingAmount: "500000" },
      sellIntent
    );
    expect(receipt.filled_size_usdc).toBe(0.5);
  });

  it("throws when the CLOB response omits orderID", () => {
    expect(() =>
      mapOrderResponseToReceipt(
        { status: "error", errorMsg: "rejected" },
        BASE_INTENT
      )
    ).toThrow(/CLOB rejected order/);
  });

  it("throws when CLOB returns success=false even with an orderID populated (B2)", () => {
    expect(() =>
      mapOrderResponseToReceipt(
        {
          orderID: "0xpresent",
          success: false,
          status: "error",
          errorMsg: "insufficient allowance",
        },
        BASE_INTENT
      )
    ).toThrow(/success=false/);
  });

  it("preserves rawStatus in attributes for debugging", () => {
    const receipt = mapOrderResponseToReceipt(
      { orderID: "0xorder4", status: "live" },
      BASE_INTENT
    );
    expect(receipt.attributes?.rawStatus).toBe("live");
  });
});

describe("mapOpenOrderToReceipt", () => {
  it("converts matched shares × price into filled USDC notional", () => {
    const receipt = mapOpenOrderToReceipt({
      id: "0xopen",
      status: "live",
      side: "BUY",
      original_size: "2",
      size_matched: "2",
      price: "0.5",
    });
    expect(receipt.order_id).toBe("0xopen");
    expect(receipt.filled_size_usdc).toBe(1);
    expect(receipt.status).toBe("open");
  });
});

describe("PolymarketClobAdapter", () => {
  // Helper — construct the adapter with its underlying ClobClient replaced
  // by a stub. We avoid spinning up a real signer by asserting on the stub
  // directly after placement.
  function makeAdapter(stub: {
    createAndPostOrder?: ReturnType<typeof vi.fn>;
    cancelOrder?: ReturnType<typeof vi.fn>;
    getOrder?: ReturnType<typeof vi.fn>;
    getTickSize?: ReturnType<typeof vi.fn>;
    getNegRisk?: ReturnType<typeof vi.fn>;
  }) {
    stub.getTickSize ??= vi.fn().mockResolvedValue("0.01");
    stub.getNegRisk ??= vi.fn().mockResolvedValue(false);
    const adapter = Object.create(
      PolymarketClobAdapter.prototype
    ) as PolymarketClobAdapter;
    // @ts-expect-error — test injection
    adapter.provider = "polymarket";
    // @ts-expect-error — test injection
    adapter.client = stub;
    // @ts-expect-error — test injection
    adapter.funderAddress = "0x1111111111111111111111111111111111111111";
    return adapter;
  }

  it("placeOrder maps size_usdc → share size via limit_price and echoes client_order_id", async () => {
    const createAndPostOrder = vi.fn().mockResolvedValue({
      orderID: "0xresp",
      status: "live",
      makingAmount: "1000000",
    });
    const adapter = makeAdapter({ createAndPostOrder });

    const receipt = await adapter.placeOrder({
      ...BASE_INTENT,
      size_usdc: 1,
      limit_price: 0.5,
      side: "BUY",
    });

    expect(createAndPostOrder).toHaveBeenCalledOnce();
    const [userOrder, opts, orderType] = createAndPostOrder.mock.calls[0] as [
      { tokenID: string; price: number; size: number; side: string },
      { tickSize: string; negRisk: boolean },
      string,
    ];
    expect(userOrder.tokenID).toBe(BASE_INTENT.attributes?.token_id);
    expect(userOrder.price).toBe(0.5);
    expect(userOrder.size).toBe(2); // 1 USDC / 0.5 = 2 shares
    expect(userOrder.side).toBe("BUY");
    expect(opts.negRisk).toBe(false);
    expect(orderType).toBe("GTC");
    expect(receipt.order_id).toBe("0xresp");
    expect(receipt.client_order_id).toBe(BASE_INTENT.client_order_id);
    expect(receipt.filled_size_usdc).toBe(1);
  });

  it("placeOrder fetches per-market tickSize + negRisk and forwards them (B1)", async () => {
    const getTickSize = vi.fn().mockResolvedValue("0.001");
    const getNegRisk = vi.fn().mockResolvedValue(true);
    const createAndPostOrder = vi.fn().mockResolvedValue({
      orderID: "0xresp",
      status: "live",
    });
    const adapter = makeAdapter({
      createAndPostOrder,
      getTickSize,
      getNegRisk,
    });
    await adapter.placeOrder(BASE_INTENT);
    expect(getTickSize).toHaveBeenCalledWith(BASE_INTENT.attributes?.token_id);
    expect(getNegRisk).toHaveBeenCalledWith(BASE_INTENT.attributes?.token_id);
    const [, opts] = createAndPostOrder.mock.calls[0] as [
      unknown,
      { tickSize: string; negRisk: boolean },
      string,
    ];
    expect(opts.tickSize).toBe("0.001");
    expect(opts.negRisk).toBe(true);
  });

  it("placeOrder forwards attributes.post_only=true to the CLOB (B5 safety)", async () => {
    const createAndPostOrder = vi.fn().mockResolvedValue({
      orderID: "0xpo",
      status: "live",
    });
    const adapter = makeAdapter({ createAndPostOrder });
    await adapter.placeOrder({
      ...BASE_INTENT,
      attributes: { ...BASE_INTENT.attributes, post_only: true },
    });
    // positional args: (userOrder, options, orderType, deferExec, postOnly)
    const call = createAndPostOrder.mock.calls[0] as unknown[];
    expect(call[2]).toBe("GTC");
    expect(call[4]).toBe(true);
  });

  it("placeOrder omits postOnly by default", async () => {
    const createAndPostOrder = vi.fn().mockResolvedValue({
      orderID: "0xdef",
      status: "live",
    });
    const adapter = makeAdapter({ createAndPostOrder });
    await adapter.placeOrder(BASE_INTENT);
    const call = createAndPostOrder.mock.calls[0] as unknown[];
    expect(call[4]).toBeUndefined();
  });

  it("placeOrder rejects when token_id attribute is missing", async () => {
    const adapter = makeAdapter({});
    await expect(
      adapter.placeOrder({ ...BASE_INTENT, attributes: {} })
    ).rejects.toThrow(/token_id/);
  });

  it("cancelOrder forwards the orderID to ClobClient.cancelOrder", async () => {
    const cancelOrder = vi.fn().mockResolvedValue({ canceled: ["0xorder"] });
    const adapter = makeAdapter({ cancelOrder });
    await adapter.cancelOrder("0xorder");
    expect(cancelOrder).toHaveBeenCalledWith({ orderID: "0xorder" });
  });

  it("getOrder maps OpenOrder response to OrderReceipt", async () => {
    const getOrder = vi.fn().mockResolvedValue({
      id: "0xopen",
      status: "live",
      side: "BUY",
      original_size: "4",
      size_matched: "1",
      price: "0.25",
    });
    const adapter = makeAdapter({ getOrder });
    const receipt = await adapter.getOrder("0xopen");
    expect(getOrder).toHaveBeenCalledWith("0xopen");
    expect(receipt.status).toBe("open");
    expect(receipt.filled_size_usdc).toBe(0.25); // 1 * 0.25
  });

  it("listMarkets rejects — CLOB adapter is trade-only", async () => {
    const adapter = makeAdapter({});
    await expect(adapter.listMarkets()).rejects.toThrow(/listMarkets/);
  });
});
