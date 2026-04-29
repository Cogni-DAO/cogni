// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider/tests/order-schemas`
 * Purpose: Zod round-trip + validation tests for the Run-phase order domain.
 * Scope: Parses valid and invalid payloads against OrderIntent, OrderReceipt, and Fill schemas; asserts the read-only adapters throw OrderNotSupportedError. Does not exercise network I/O, DB state, or adapter signing — those land in CP2+ tests.
 * Invariants: FILL_ID_COMPOSITE, IDEMPOTENT_BY_CLIENT_ID, PROVIDER_AGNOSTIC.
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 — CP1)
 * @internal
 */

import { describe, expect, it } from "vitest";

import { KalshiAdapter } from "../src/adapters/kalshi/kalshi.adapter.js";
import { PaperAdapter } from "../src/adapters/paper/paper.adapter.js";
import { PolymarketAdapter } from "../src/adapters/polymarket/polymarket.adapter.js";
import {
  FillSchema,
  OrderIntentSchema,
  OrderReceiptSchema,
  OrderStatusSchema,
} from "../src/domain/order.js";
import { OrderNotSupportedError } from "../src/port/market-provider.port.js";

describe("OrderIntentSchema", () => {
  const validIntent = {
    provider: "polymarket",
    market_id: "prediction-market:polymarket:0xabc",
    outcome: "YES",
    side: "BUY",
    size_usdc: 1.0,
    limit_price: 0.52,
    client_order_id: "target-7:data-api:0xabc:0x7e:BUY:1713302400",
    attributes: { asset: "0x7eabc", orderType: "GTC" },
  };

  it("round-trips a valid OrderIntent", () => {
    const parsed = OrderIntentSchema.parse(validIntent);
    expect(parsed).toEqual(validIntent);
  });

  it.each([
    ["zero size_usdc", { ...validIntent, size_usdc: 0 }],
    ["negative size_usdc", { ...validIntent, size_usdc: -1 }],
    ["zero limit_price", { ...validIntent, limit_price: 0 }],
    ["missing client_order_id", { ...validIntent, client_order_id: "" }],
    ["unknown provider", { ...validIntent, provider: "kraken" }],
    ["empty market_id", { ...validIntent, market_id: "" }],
  ])("rejects %s", (_label, bad) => {
    expect(() => OrderIntentSchema.parse(bad)).toThrow();
  });

  it("accepts omitted attributes (provider-agnostic)", () => {
    const { attributes: _attrs, ...noAttrs } = validIntent;
    expect(() => OrderIntentSchema.parse(noAttrs)).not.toThrow();
  });
});

describe("OrderReceiptSchema", () => {
  it("round-trips across every OrderStatus value", () => {
    for (const status of OrderStatusSchema.options) {
      const receipt = {
        order_id: "op-123",
        client_order_id: "cli-abc",
        status,
        filled_size_usdc: 0,
        submitted_at: "2026-04-16T00:00:00.000Z",
      };
      expect(OrderReceiptSchema.parse(receipt).status).toBe(status);
    }
  });

  it("rejects a negative filled_size_usdc", () => {
    expect(() =>
      OrderReceiptSchema.parse({
        order_id: "op-1",
        client_order_id: "cli-1",
        status: "filled",
        filled_size_usdc: -1,
        submitted_at: "2026-04-16T00:00:00.000Z",
      })
    ).toThrow();
  });
});

describe("FillSchema — composite fill_id (P0.2)", () => {
  const baseFill = {
    target_wallet: "0x" + "a".repeat(40),
    fill_id:
      "data-api:0x" +
      "f".repeat(64) +
      ":0x" +
      "7".repeat(64) +
      ":BUY:1713302400",
    source: "data-api",
    market_id: "prediction-market:polymarket:cond-1",
    outcome: "YES",
    side: "BUY",
    price: 0.54,
    size_usdc: 100,
    observed_at: "2026-04-16T12:34:56.000Z",
  };

  it("accepts a Data-API-sourced Fill with composite native_id", () => {
    expect(FillSchema.parse(baseFill).fill_id).toBe(baseFill.fill_id);
  });

  it("accepts a clob-ws-sourced Fill (P4 shape)", () => {
    const wsFill = {
      ...baseFill,
      source: "clob-ws",
      fill_id: "clob-ws:operator-trade-abc-123",
    };
    expect(FillSchema.parse(wsFill).source).toBe("clob-ws");
  });

  it("rejects a target_wallet that is not a hex address", () => {
    expect(() =>
      FillSchema.parse({ ...baseFill, target_wallet: "not-an-address" })
    ).toThrow();
  });

  it("rejects a fill with unknown source", () => {
    expect(() =>
      FillSchema.parse({ ...baseFill, source: "goldsky" })
    ).toThrow();
  });
});

describe("OrderNotSupportedError — read-only adapter surface", () => {
  it("polymarket baseline adapter throws on every Run method", async () => {
    const adapter = new PolymarketAdapter();
    await expect(
      adapter.placeOrder({
        provider: "polymarket",
        market_id: "m",
        outcome: "YES",
        side: "BUY",
        size_usdc: 1,
        limit_price: 0.5,
        client_order_id: "c",
      })
    ).rejects.toBeInstanceOf(OrderNotSupportedError);
    await expect(adapter.cancelOrder("x")).rejects.toBeInstanceOf(
      OrderNotSupportedError
    );
    await expect(adapter.getOrder("x")).rejects.toBeInstanceOf(
      OrderNotSupportedError
    );
  });

  it("kalshi adapter throws OrderNotSupportedError with provider=kalshi", async () => {
    const adapter = new KalshiAdapter({
      credentials: {
        apiKey: "test-key",
        apiSecret:
          "-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----",
      },
    });
    try {
      await adapter.placeOrder({
        provider: "kalshi",
        market_id: "m",
        outcome: "YES",
        side: "BUY",
        size_usdc: 1,
        limit_price: 0.5,
        client_order_id: "c",
      });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OrderNotSupportedError);
      expect((err as OrderNotSupportedError).provider).toBe("kalshi");
      expect((err as OrderNotSupportedError).operation).toBe("placeOrder");
    }
  });

  it("paper adapter throws NotImplementedError on every method (P3 stubs)", async () => {
    const adapter = new PaperAdapter();
    await expect(adapter.listMarkets()).rejects.toMatchObject({
      name: "NotImplementedError",
    });
    await expect(
      adapter.placeOrder({
        provider: "polymarket",
        market_id: "m",
        outcome: "YES",
        side: "BUY",
        size_usdc: 1,
        limit_price: 0.5,
        client_order_id: "c",
      })
    ).rejects.toMatchObject({ name: "NotImplementedError" });
    await expect(adapter.cancelOrder("x")).rejects.toMatchObject({
      name: "NotImplementedError",
    });
    await expect(adapter.getOrder("x")).rejects.toMatchObject({
      name: "NotImplementedError",
    });
  });
});
