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
  POLY_CLOB_METRICS,
  PolymarketClobAdapter,
} from "../src/adapters/polymarket/polymarket.clob.adapter.js";
import type { OrderIntent } from "../src/domain/order.js";
import {
  createRecordingMetrics,
  type LoggerPort,
  type MetricsPort,
  noopLogger,
  noopMetrics,
} from "../src/port/observability.port.js";

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

  it("treats BUY makingAmount as decimal USDC dollars (B6)", () => {
    // Polymarket returns decimal USDC on the placement response
    // (e.g. "4.98473" — NOT atomic 4984730). Observed live 2026-04-17.
    const receipt = mapOrderResponseToReceipt(
      { orderID: "0xorder2", status: "matched", makingAmount: "4.98473" },
      BASE_INTENT
    );
    expect(receipt.filled_size_usdc).toBeCloseTo(4.98473, 6);
    expect(receipt.status).toBe("filled");
  });

  it("treats SELL takingAmount as decimal USDC dollars (B6)", () => {
    const sellIntent: OrderIntent = { ...BASE_INTENT, side: "SELL" };
    const receipt = mapOrderResponseToReceipt(
      { orderID: "0xorder3", status: "matched", takingAmount: "0.5" },
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
  function makeAdapter(
    stub: {
      createAndPostOrder?: ReturnType<typeof vi.fn>;
      cancelOrder?: ReturnType<typeof vi.fn>;
      getOrder?: ReturnType<typeof vi.fn>;
      getTickSize?: ReturnType<typeof vi.fn>;
      getNegRisk?: ReturnType<typeof vi.fn>;
      getFeeRateBps?: ReturnType<typeof vi.fn>;
    },
    observability?: { logger?: LoggerPort; metrics?: MetricsPort }
  ) {
    stub.getTickSize ??= vi.fn().mockResolvedValue("0.01");
    stub.getNegRisk ??= vi.fn().mockResolvedValue(false);
    stub.getFeeRateBps ??= vi.fn().mockResolvedValue(0);
    const adapter = Object.create(
      PolymarketClobAdapter.prototype
    ) as PolymarketClobAdapter;
    // @ts-expect-error — test injection
    adapter.provider = "polymarket";
    // @ts-expect-error — test injection
    adapter.client = stub;
    // @ts-expect-error — test injection
    adapter.funderAddress = "0x1111111111111111111111111111111111111111";
    // @ts-expect-error — test injection
    adapter.chainId = 137;
    // @ts-expect-error — test injection
    adapter.log = observability?.logger ?? noopLogger;
    // @ts-expect-error — test injection
    adapter.metrics = observability?.metrics ?? noopMetrics;
    return adapter;
  }

  it("placeOrder maps size_usdc → share size via limit_price and echoes client_order_id", async () => {
    const createAndPostOrder = vi.fn().mockResolvedValue({
      orderID: "0xresp",
      status: "live",
      makingAmount: "1",
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

  it("placeOrder fetches per-market feeRateBps and forwards it (B1b)", async () => {
    const getFeeRateBps = vi.fn().mockResolvedValue(1000);
    const createAndPostOrder = vi.fn().mockResolvedValue({
      orderID: "0xfee",
      status: "live",
    });
    const adapter = makeAdapter({ createAndPostOrder, getFeeRateBps });
    await adapter.placeOrder(BASE_INTENT);
    expect(getFeeRateBps).toHaveBeenCalledWith(
      BASE_INTENT.attributes?.token_id
    );
    const [userOrder] = createAndPostOrder.mock.calls[0] as [
      { feeRateBps: number },
      unknown,
      string,
    ];
    expect(userOrder.feeRateBps).toBe(1000);
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

  it("getOrder maps OpenOrder response to { found: receipt } (GETORDER_NEVER_NULL, task.0328 CP1)", async () => {
    const getOrder = vi.fn().mockResolvedValue({
      id: "0xopen",
      status: "live",
      side: "BUY",
      original_size: "4",
      size_matched: "1",
      price: "0.25",
    });
    const adapter = makeAdapter({ getOrder });
    const result = await adapter.getOrder("0xopen");
    expect(getOrder).toHaveBeenCalledWith("0xopen");
    expect("found" in result).toBe(true);
    if ("found" in result) {
      expect(result.found.status).toBe("open");
      expect(result.found.filled_size_usdc).toBe(0.25); // 1 * 0.25
    }
  });

  it("getOrder returns { status: 'not_found' } when CLOB returns null/empty body", async () => {
    const getOrder = vi.fn().mockResolvedValue(null);
    const adapter = makeAdapter({ getOrder });
    const result = await adapter.getOrder("0xgone");
    expect(result).toEqual({ status: "not_found" });
  });

  it("listMarkets rejects — CLOB adapter is trade-only", async () => {
    const adapter = makeAdapter({});
    await expect(adapter.listMarkets()).rejects.toThrow(/listMarkets/);
  });
});

// ---------------------------------------------------------------------------
// Observability (task.0315 CP3.2 — observability pass)
// ---------------------------------------------------------------------------

describe("PolymarketClobAdapter — observability", () => {
  type LogCall = {
    level: "debug" | "info" | "warn" | "error";
    obj: Record<string, unknown>;
    msg?: string;
  };

  function makeRecordingLogger(): { logger: LoggerPort; calls: LogCall[] } {
    const calls: LogCall[] = [];
    function mk(bindings: Record<string, unknown>): LoggerPort {
      const bind = { ...bindings };
      return {
        debug(obj, msg) {
          calls.push({ level: "debug", obj: { ...bind, ...obj }, msg });
        },
        info(obj, msg) {
          calls.push({ level: "info", obj: { ...bind, ...obj }, msg });
        },
        warn(obj, msg) {
          calls.push({ level: "warn", obj: { ...bind, ...obj }, msg });
        },
        error(obj, msg) {
          calls.push({ level: "error", obj: { ...bind, ...obj }, msg });
        },
        child(extra) {
          return mk({ ...bind, ...extra });
        },
      };
    }
    return { logger: mk({}), calls };
  }

  // Re-declared here so the observability suite is self-contained.
  function makeAdapter(
    stub: {
      createAndPostOrder?: ReturnType<typeof vi.fn>;
      cancelOrder?: ReturnType<typeof vi.fn>;
      getOrder?: ReturnType<typeof vi.fn>;
      getTickSize?: ReturnType<typeof vi.fn>;
      getNegRisk?: ReturnType<typeof vi.fn>;
      getFeeRateBps?: ReturnType<typeof vi.fn>;
    },
    observability: { logger?: LoggerPort; metrics?: MetricsPort } = {}
  ) {
    stub.getTickSize ??= vi.fn().mockResolvedValue("0.01");
    stub.getNegRisk ??= vi.fn().mockResolvedValue(false);
    stub.getFeeRateBps ??= vi.fn().mockResolvedValue(0);
    const adapter = Object.create(
      PolymarketClobAdapter.prototype
    ) as PolymarketClobAdapter;
    // @ts-expect-error — test injection
    adapter.provider = "polymarket";
    // @ts-expect-error — test injection
    adapter.client = stub;
    // @ts-expect-error — test injection
    adapter.funderAddress = "0x1111111111111111111111111111111111111111";
    // @ts-expect-error — test injection
    adapter.chainId = 137;
    // The real constructor binds provider/chain_id/funder on a child logger; we
    // mirror that here so the tests exercise the same shape.
    // @ts-expect-error — test injection
    adapter.log = (observability.logger ?? noopLogger).child({
      component: "poly-clob-adapter",
      provider: "polymarket",
      chain_id: 137,
      funder: "0x1111111111111111111111111111111111111111",
    });
    // @ts-expect-error — test injection
    adapter.metrics = observability.metrics ?? noopMetrics;
    return adapter;
  }

  it("placeOrder emits start + ok logs with correlation fields and result=ok metrics", async () => {
    const { logger, calls } = makeRecordingLogger();
    const metrics = createRecordingMetrics();
    const createAndPostOrder = vi.fn().mockResolvedValue({
      orderID: "0xok",
      status: "live",
    });
    const adapter = makeAdapter({ createAndPostOrder }, { logger, metrics });

    await adapter.placeOrder(BASE_INTENT);

    const starts = calls.filter((c) => c.obj.phase === "start");
    const oks = calls.filter((c) => c.obj.phase === "ok");
    expect(starts).toHaveLength(1);
    expect(oks).toHaveLength(1);

    // Correlation fields present on start.
    expect(starts[0]?.obj).toMatchObject({
      event: "poly.clob.place",
      component: "poly-clob-adapter",
      provider: "polymarket",
      chain_id: 137,
      funder: "0x1111111111111111111111111111111111111111",
      client_order_id: BASE_INTENT.client_order_id,
      token_id: BASE_INTENT.attributes?.token_id,
      side: "BUY",
      size_usdc: BASE_INTENT.size_usdc,
      limit_price: BASE_INTENT.limit_price,
    });

    // Ok log carries order_id + duration.
    expect(oks[0]?.obj).toMatchObject({
      event: "poly.clob.place",
      phase: "ok",
      order_id: "0xok",
    });
    expect(typeof oks[0]?.obj.duration_ms).toBe("number");

    // Metrics: one counter with result=ok, one duration with result=ok.
    const okCounters = metrics.emissions.filter(
      (e) =>
        e.kind === "counter" &&
        e.name === POLY_CLOB_METRICS.placeTotal &&
        e.labels.result === "ok"
    );
    expect(okCounters).toHaveLength(1);
    const okDurations = metrics.emissions.filter(
      (e) =>
        e.kind === "duration" &&
        e.name === POLY_CLOB_METRICS.placeDurationMs &&
        e.labels.result === "ok"
    );
    expect(okDurations).toHaveLength(1);
  });

  it("placeOrder classifies success=false response as result=rejected and logs error", async () => {
    const { logger, calls } = makeRecordingLogger();
    const metrics = createRecordingMetrics();
    const createAndPostOrder = vi.fn().mockResolvedValue({
      orderID: "0xrej",
      success: false,
      errorMsg: "fee rate for the market must be 1000",
    });
    const adapter = makeAdapter({ createAndPostOrder }, { logger, metrics });

    await expect(adapter.placeOrder(BASE_INTENT)).rejects.toThrow(
      /CLOB rejected order/
    );

    // Counter labeled result=rejected (not error) — distinct for dashboards.
    const rejects = metrics.emissions.filter(
      (e) =>
        e.kind === "counter" &&
        e.name === POLY_CLOB_METRICS.placeTotal &&
        e.labels.result === "rejected"
    );
    expect(rejects).toHaveLength(1);

    const errLog = calls.find((c) => c.level === "error");
    expect(errLog?.obj).toMatchObject({
      event: "poly.clob.place",
      phase: "rejected",
      client_order_id: BASE_INTENT.client_order_id,
    });
    expect(typeof errLog?.obj.duration_ms).toBe("number");
    expect(String(errLog?.obj.error)).toContain("fee rate for the market");
  });

  it("placeOrder classifies thrown network errors as result=error", async () => {
    const { logger, calls } = makeRecordingLogger();
    const metrics = createRecordingMetrics();
    const createAndPostOrder = vi
      .fn()
      .mockRejectedValue(new Error("ECONNRESET"));
    const adapter = makeAdapter({ createAndPostOrder }, { logger, metrics });

    await expect(adapter.placeOrder(BASE_INTENT)).rejects.toThrow(/ECONNRESET/);

    const errs = metrics.emissions.filter(
      (e) =>
        e.kind === "counter" &&
        e.name === POLY_CLOB_METRICS.placeTotal &&
        e.labels.result === "error"
    );
    expect(errs).toHaveLength(1);
    const errLog = calls.find((c) => c.level === "error");
    expect(errLog?.obj.phase).toBe("error");
    expect(String(errLog?.obj.error)).toContain("ECONNRESET");
  });

  it("placeOrder with missing token_id emits error metric and log before throwing", async () => {
    const { logger, calls } = makeRecordingLogger();
    const metrics = createRecordingMetrics();
    const adapter = makeAdapter({}, { logger, metrics });

    const badIntent: OrderIntent = {
      ...BASE_INTENT,
      attributes: {},
    };

    await expect(adapter.placeOrder(badIntent)).rejects.toThrow(/token_id/);

    const errs = metrics.emissions.filter(
      (e) =>
        e.kind === "counter" &&
        e.name === POLY_CLOB_METRICS.placeTotal &&
        e.labels.result === "error"
    );
    expect(errs).toHaveLength(1);
    const errLog = calls.find((c) => c.level === "error");
    expect(errLog?.obj.reason).toBe("missing_token_id");
  });

  it("cancelOrder emits start + ok logs and cancel counter", async () => {
    const { logger, calls } = makeRecordingLogger();
    const metrics = createRecordingMetrics();
    const cancelOrder = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ cancelOrder }, { logger, metrics });

    await adapter.cancelOrder("0xabc");

    expect(
      calls.filter((c) => c.obj.event === "poly.clob.cancel")
    ).toHaveLength(2);
    const okCounter = metrics.emissions.find(
      (e) =>
        e.kind === "counter" &&
        e.name === POLY_CLOB_METRICS.cancelTotal &&
        e.labels.result === "ok"
    );
    expect(okCounter).toBeDefined();
  });

  it("cancelOrder error path increments cancel_total{result=error}", async () => {
    const { logger } = makeRecordingLogger();
    const metrics = createRecordingMetrics();
    const cancelOrder = vi.fn().mockRejectedValue(new Error("not found"));
    const adapter = makeAdapter({ cancelOrder }, { logger, metrics });

    await expect(adapter.cancelOrder("0xabc")).rejects.toThrow(/not found/);
    const errCounter = metrics.emissions.find(
      (e) =>
        e.kind === "counter" &&
        e.name === POLY_CLOB_METRICS.cancelTotal &&
        e.labels.result === "error"
    );
    expect(errCounter).toBeDefined();
  });

  it("getOrder emits get_order metrics with result=ok", async () => {
    const { logger } = makeRecordingLogger();
    const metrics = createRecordingMetrics();
    const getOrder = vi.fn().mockResolvedValue({
      id: "0xq",
      status: "live",
      side: "BUY",
      original_size: "1",
      size_matched: "0",
      price: "0.5",
    });
    const adapter = makeAdapter({ getOrder }, { logger, metrics });

    const result = await adapter.getOrder("0xq");
    expect("found" in result).toBe(true);

    const okCounter = metrics.emissions.find(
      (e) =>
        e.kind === "counter" &&
        e.name === POLY_CLOB_METRICS.getOrderTotal &&
        e.labels.result === "ok"
    );
    expect(okCounter).toBeDefined();
  });

  it("getOrder emits get_order metrics with result=not_found for null CLOB response", async () => {
    const { logger } = makeRecordingLogger();
    const metrics = createRecordingMetrics();
    const getOrder = vi.fn().mockResolvedValue(null);
    const adapter = makeAdapter({ getOrder }, { logger, metrics });

    const result = await adapter.getOrder("0xgone");
    expect(result).toEqual({ status: "not_found" });

    const nfCounter = metrics.emissions.find(
      (e) =>
        e.kind === "counter" &&
        e.name === POLY_CLOB_METRICS.getOrderTotal &&
        e.labels.result === "not_found"
    );
    expect(nfCounter).toBeDefined();
  });
});
