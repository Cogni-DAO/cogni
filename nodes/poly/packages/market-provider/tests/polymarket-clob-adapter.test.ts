// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider/tests/polymarket-clob-adapter`
 * Purpose: Unit tests for `PolymarketClobAdapter` — verifies OrderIntent↔CLOB mapping and status normalization without hitting the network.
 * Scope: Pure mapping helpers (exported) + adapter methods driven by a mocked ClobClient. Does not exercise real HTTPS, Privy, or viem signing.
 * Invariants: IDEMPOTENT_BY_CLIENT_ID (client_order_id echoes intent verbatim), status mapping is total.
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 — CP3.2)
 * @internal
 */

import { describe, expect, it, vi } from "vitest";

import {
  ClobRejectionError,
  classifyClientError,
  classifyClobFailure,
  coerceNegRiskApiValue,
  extractClobPlacedOrderId,
  mapOpenOrderToReceipt,
  mapOrderResponseToReceipt,
  normalizePolymarketStatus,
  POLY_CLOB_ERROR_CODES,
  POLY_CLOB_METRICS,
  PolymarketClobAdapter,
  sanitizeClobDiagnosticText,
  withSuppressedClobSdkDiagnostics,
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

describe("coerceNegRiskApiValue (bug.0329)", () => {
  it("maps API string/numeric toggles to boolean", () => {
    expect(coerceNegRiskApiValue(true)).toBe(true);
    expect(coerceNegRiskApiValue(false)).toBe(false);
    expect(coerceNegRiskApiValue(1)).toBe(true);
    expect(coerceNegRiskApiValue(0)).toBe(false);
    expect(coerceNegRiskApiValue("1")).toBe(true);
    expect(coerceNegRiskApiValue("0")).toBe(false);
    expect(coerceNegRiskApiValue("true")).toBe(true);
    expect(coerceNegRiskApiValue("false")).toBe(false);
  });
});

describe("CLOB diagnostic suppression", () => {
  it("redacts Polymarket auth fields from diagnostic strings", () => {
    const raw =
      '{"headers":{"POLY_SIGNATURE":"sig_live","POLY_API_KEY":"key_live","POLY_PASSPHRASE":"pass_live","authorization":"Bearer token_live"}}';

    const safe = sanitizeClobDiagnosticText(raw);

    expect(safe).not.toContain("sig_live");
    expect(safe).not.toContain("key_live");
    expect(safe).not.toContain("pass_live");
    expect(safe).not.toContain("token_live");
    expect(safe).toContain("[REDACTED]");
  });

  it("drops clob-client console diagnostics instead of emitting sanitized dumps", async () => {
    const original = console.error;
    const spy = vi.fn();
    console.error = spy;
    try {
      await withSuppressedClobSdkDiagnostics(async () => {
        console.error(
          "[CLOB Client] request error",
          JSON.stringify({
            status: 400,
            config: {
              headers: {
                POLY_SIGNATURE: "sig_live",
                POLY_API_KEY: "key_live",
                POLY_PASSPHRASE: "pass_live",
              },
            },
          })
        );
      });
    } finally {
      console.error = original;
    }

    const emitted = JSON.stringify(spy.mock.calls);
    expect(spy).not.toHaveBeenCalled();
    expect(emitted).not.toContain("sig_live");
    expect(emitted).not.toContain("key_live");
    expect(emitted).not.toContain("pass_live");
    expect(emitted).not.toContain("config");
  });

  it("drops clob-client warn/log/stdout/stderr diagnostics", async () => {
    const originalWarn = console.warn;
    const originalLog = console.log;
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    const warnSpy = vi.fn();
    const logSpy = vi.fn();
    const stdoutSpy = vi.fn(() => true);
    const stderrSpy = vi.fn(() => true);
    console.warn = warnSpy;
    console.log = logSpy;
    process.stdout.write = stdoutSpy as typeof process.stdout.write;
    process.stderr.write = stderrSpy as typeof process.stderr.write;
    try {
      await withSuppressedClobSdkDiagnostics(async () => {
        console.warn("[CLOB Client] request error", {
          config: { headers: { POLY_API_KEY: "key_live" } },
        });
        console.log("[CLOB Client-v2] request error", {
          body: "<html>cloudflare</html>",
        });
        process.stdout.write(
          '[CLOB Client] request error {"config":{"headers":{"POLY_SIGNATURE":"sig_live"}}}'
        );
        process.stderr.write(
          '[CLOB Client-v2] request error {"body":"<html>cloudflare</html>"}'
        );
      });
    } finally {
      console.warn = originalWarn;
      console.log = originalLog;
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    }

    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("drops delayed clob-client diagnostics after the awaited SDK call returns", async () => {
    const original = console.error;
    const spy = vi.fn();
    console.error = spy;
    try {
      await withSuppressedClobSdkDiagnostics(async () => {
        setTimeout(() => {
          console.error("[CLOB Client] request error", {
            config: {
              headers: {
                POLY_SIGNATURE: "sig_live",
                POLY_API_KEY: "key_live",
              },
            },
            body: "<html>cloudflare</html>",
          });
        }, 0);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      console.error = original;
    }

    const emitted = JSON.stringify(spy.mock.calls);
    expect(spy).not.toHaveBeenCalled();
    expect(emitted).not.toContain("sig_live");
    expect(emitted).not.toContain("key_live");
    expect(emitted).not.toContain("cloudflare");
  });

  it("classifies thrown request-config errors without leaking auth headers", () => {
    const details = classifyClientError(
      new Error(
        'Request failed with config {"headers":{"POLY_SIGNATURE":"sig_live","POLY_API_KEY":"key_live","POLY_PASSPHRASE":"pass_live"}}'
      )
    );

    const emitted = JSON.stringify(details);
    expect(emitted).not.toContain("sig_live");
    expect(emitted).not.toContain("key_live");
    expect(emitted).not.toContain("pass_live");
    expect(emitted).not.toContain("headers");
    expect(details.reason).toBe(POLY_CLOB_ERROR_CODES.invalidSignature);
  });
});

describe("extractClobPlacedOrderId", () => {
  it("reads orderID, orderId, then order_id", () => {
    expect(extractClobPlacedOrderId({ orderID: "a" })).toBe("a");
    expect(extractClobPlacedOrderId({ orderId: "b" })).toBe("b");
    expect(extractClobPlacedOrderId({ order_id: "c" })).toBe("c");
    expect(
      extractClobPlacedOrderId({ orderId: "wins", orderID: "first" })
    ).toBe("first");
  });
});

describe("mapOrderResponseToReceipt", () => {
  it("accepts camelCase orderId when orderID is absent", () => {
    const receipt = mapOrderResponseToReceipt(
      { orderId: "0xcamel", status: "live" },
      BASE_INTENT
    );
    expect(receipt.order_id).toBe("0xcamel");
  });

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

  it("throws ClobRejectionError when the CLOB response omits orderID", () => {
    expect(() =>
      mapOrderResponseToReceipt(
        { status: "error", errorMsg: "rejected" },
        BASE_INTENT
      )
    ).toThrow(ClobRejectionError);
  });

  it("throws when CLOB returns success=false even with an orderID populated (B2)", () => {
    let caught: unknown;
    try {
      mapOrderResponseToReceipt(
        {
          orderID: "0xpresent",
          success: false,
          status: "error",
          errorMsg: "insufficient allowance",
        },
        BASE_INTENT
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ClobRejectionError);
    expect((caught as ClobRejectionError).details.error_code).toBe(
      POLY_CLOB_ERROR_CODES.insufficientAllowance
    );
  });

  it("preserves rawStatus in attributes for debugging", () => {
    const receipt = mapOrderResponseToReceipt(
      { orderID: "0xorder4", status: "live" },
      BASE_INTENT
    );
    expect(receipt.attributes?.rawStatus).toBe("live");
  });
});

describe("classifyClobFailure (bug.0335 diagnostics)", () => {
  it("flags a bare empty object as empty_response", () => {
    const details = classifyClobFailure({});
    expect(details.error_code).toBe(POLY_CLOB_ERROR_CODES.emptyResponse);
    expect(details.response_keys).toEqual([]);
  });

  it("classifies the empty-string-errorMsg production signature without dropping the field shape", () => {
    // Matches the Loki signature observed on candidate-a 2026-04-19T23:52Z:
    //   `{success: undefined, orderID: <missing>, errorMsg: ""}` — the shape
    //   had NO usable fields and we lost the whole signal.
    const details = classifyClobFailure({
      success: undefined,
      orderID: undefined,
      errorMsg: "",
    });
    expect(details.error_code).toBe(POLY_CLOB_ERROR_CODES.emptyResponse);
    expect(details.response_keys).toEqual(
      expect.arrayContaining(["success", "orderID", "errorMsg"])
    );
    expect(details.reason).toMatch(/empty_error_fields/);
  });

  it("maps 'not enough balance' → insufficient_balance", () => {
    const details = classifyClobFailure({
      success: false,
      errorMsg: "not enough balance",
    });
    expect(details.error_code).toBe(POLY_CLOB_ERROR_CODES.insufficientBalance);
    expect(details.reason).toBe(POLY_CLOB_ERROR_CODES.insufficientBalance);
  });

  it("maps an 'allowance' errorMsg → insufficient_allowance", () => {
    const details = classifyClobFailure({
      success: false,
      errorMsg: "allowance exceeded",
    });
    expect(details.error_code).toBe(
      POLY_CLOB_ERROR_CODES.insufficientAllowance
    );
  });

  it("reads `error` field when `errorMsg` is absent (unknown response shape)", () => {
    const details = classifyClobFailure({ error: "invalid api key" });
    expect(details.error_code).toBe(POLY_CLOB_ERROR_CODES.staleApiKey);
    expect(details.response_keys).toEqual(["error"]);
  });

  it("uses a stable reason code for unclassified provider text", () => {
    const details = classifyClobFailure({
      errorMsg: "x".repeat(500),
    });
    expect(details.reason).toBe(POLY_CLOB_ERROR_CODES.unknown);
  });

  // Live signatures from candidate-a 2026-04-21 — bug.0342 surface.
  // Before the classifier extension these landed as error_code: "unknown".
  it("maps share-min signature → below_min_order_size", () => {
    const details = classifyClobFailure({
      error: "order 0xabc is invalid. Size (1.58) lower than the minimum: 5",
      status: "error",
    });
    expect(details.error_code).toBe(POLY_CLOB_ERROR_CODES.belowMinOrderSize);
    expect(details.response_keys).toEqual(["error", "status"]);
  });

  it("maps USDC-amount-min signature → below_min_order_size", () => {
    const details = classifyClobFailure({
      error:
        "invalid amount for a marketable BUY order ($0.9996), min size: $1",
      status: "error",
    });
    expect(details.error_code).toBe(POLY_CLOB_ERROR_CODES.belowMinOrderSize);
  });
});

describe("classifyClientError (axios / network)", () => {
  it("surfaces http_status and routes 401 → stale_api_key", () => {
    const axiosErr = {
      message: "Request failed with status code 401",
      response: { status: 401, data: {} },
    };
    const details = classifyClientError(axiosErr);
    expect(details.http_status).toBe(401);
    expect(details.error_code).toBe(POLY_CLOB_ERROR_CODES.staleApiKey);
  });

  it("extracts keys from axios response.data when present", () => {
    const axiosErr = {
      message: "boom",
      response: { status: 400, data: { error: "not enough balance" } },
    };
    const details = classifyClientError(axiosErr);
    expect(details.http_status).toBe(400);
    expect(details.error_code).toBe(POLY_CLOB_ERROR_CODES.insufficientBalance);
    expect(details.response_keys).toEqual(["error"]);
  });

  it("falls back to http_error for non-4xx without a parseable body", () => {
    const axiosErr = {
      message: "Request failed with status code 502",
      response: { status: 502 },
    };
    const details = classifyClientError(axiosErr);
    expect(details.http_status).toBe(502);
    expect(details.error_code).toBe(POLY_CLOB_ERROR_CODES.httpError);
  });

  it("classifies plain errors by message when no axios shape present", () => {
    const details = classifyClientError(new Error("invalid signature"));
    expect(details.http_status).toBeUndefined();
    expect(details.error_code).toBe(POLY_CLOB_ERROR_CODES.invalidSignature);
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
      createAndPostMarketOrder?: ReturnType<typeof vi.fn>;
      cancelOrder?: ReturnType<typeof vi.fn>;
      getOrder?: ReturnType<typeof vi.fn>;
      getTickSize?: ReturnType<typeof vi.fn>;
      getNegRisk?: ReturnType<typeof vi.fn>;
      getFeeRateBps?: ReturnType<typeof vi.fn>;
      getOrderBook?: ReturnType<typeof vi.fn>;
      getOpenOrders?: ReturnType<typeof vi.fn>;
    },
    observability?: { logger?: LoggerPort; metrics?: MetricsPort }
  ) {
    stub.getTickSize ??= vi.fn().mockResolvedValue("0.01");
    stub.getNegRisk ??= vi.fn().mockResolvedValue(false);
    stub.getFeeRateBps ??= vi.fn().mockResolvedValue(0);
    // Default orderBook: minShares=1 so legacy tests (BASE_INTENT size_usdc=1
    // at price 0.5 = 2 shares ≥ 1) pass through without triggering the
    // bug.0342 defense-in-depth guard. Tests that exercise the guard override
    // min_order_size explicitly.
    stub.getOrderBook ??= vi
      .fn()
      .mockResolvedValue({ min_order_size: "1", tick_size: "0.01" });
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

  it("placeOrder uses market FOK by default (BUY: amount=USDC) and echoes client_order_id (bug.0405)", async () => {
    const createAndPostMarketOrder = vi.fn().mockResolvedValue({
      orderID: "0xresp",
      status: "matched",
      makingAmount: "1",
    });
    const adapter = makeAdapter({ createAndPostMarketOrder });

    const receipt = await adapter.placeOrder({
      ...BASE_INTENT,
      size_usdc: 1,
      limit_price: 0.5,
      side: "BUY",
    });

    expect(createAndPostMarketOrder).toHaveBeenCalledOnce();
    const [userOrder, opts, orderType] = createAndPostMarketOrder.mock
      .calls[0] as [
      { tokenID: string; price: number; amount: number; side: string },
      { tickSize: string; negRisk: boolean },
      string,
    ];
    expect(userOrder.tokenID).toBe(BASE_INTENT.attributes?.token_id);
    // FILL_NEVER_BELOW_FLOOR: BUY market FOK uses USDC amount with price as cap.
    expect(userOrder.price).toBe(0.5);
    expect(userOrder.amount).toBe(1); // size_usdc=1 forwards as-is
    expect(userOrder.side).toBe("BUY");
    expect(opts.negRisk).toBe(false);
    expect(orderType).toBe("FOK");
    expect(receipt.order_id).toBe("0xresp");
    expect(receipt.client_order_id).toBe(BASE_INTENT.client_order_id);
    expect(receipt.filled_size_usdc).toBe(1);
  });

  it("placeOrder uses market FOK on SELL (amount=shares) per bug.0405", async () => {
    const createAndPostMarketOrder = vi.fn().mockResolvedValue({
      orderID: "0xsell",
      status: "matched",
      takingAmount: "1",
    });
    const adapter = makeAdapter({ createAndPostMarketOrder });
    await adapter.placeOrder({
      ...BASE_INTENT,
      size_usdc: 1,
      limit_price: 0.5,
      side: "SELL",
    });
    const [userOrder, , orderType] = createAndPostMarketOrder.mock.calls[0] as [
      { amount: number; side: string },
      unknown,
      string,
    ];
    expect(userOrder.side).toBe("SELL");
    expect(userOrder.amount).toBe(2); // SELL: 1 USDC / 0.5 = 2 shares
    expect(orderType).toBe("FOK");
  });

  it("placeOrder fetches per-market tickSize + negRisk and forwards them (B1)", async () => {
    const getTickSize = vi.fn().mockResolvedValue("0.001");
    const getNegRisk = vi.fn().mockResolvedValue(true);
    const createAndPostMarketOrder = vi.fn().mockResolvedValue({
      orderID: "0xresp",
      status: "matched",
      makingAmount: "1",
    });
    const adapter = makeAdapter({
      createAndPostMarketOrder,
      getTickSize,
      getNegRisk,
    });
    await adapter.placeOrder(BASE_INTENT);
    expect(getTickSize).toHaveBeenCalledWith(BASE_INTENT.attributes?.token_id);
    expect(getNegRisk).toHaveBeenCalledWith(BASE_INTENT.attributes?.token_id);
    const [, opts] = createAndPostMarketOrder.mock.calls[0] as [
      unknown,
      { tickSize: string; negRisk: boolean },
      string,
    ];
    expect(opts.tickSize).toBe("0.001");
    expect(opts.negRisk).toBe(true);
  });

  it("placeOrder fetches per-market feeRateBps and forwards it (B1b)", async () => {
    const getFeeRateBps = vi.fn().mockResolvedValue(1000);
    const createAndPostMarketOrder = vi.fn().mockResolvedValue({
      orderID: "0xfee",
      status: "matched",
      makingAmount: "1",
    });
    const adapter = makeAdapter({ createAndPostMarketOrder, getFeeRateBps });
    await adapter.placeOrder(BASE_INTENT);
    expect(getFeeRateBps).toHaveBeenCalledWith(
      BASE_INTENT.attributes?.token_id
    );
    const [userOrder] = createAndPostMarketOrder.mock.calls[0] as [
      { feeRateBps: number },
      unknown,
      string,
    ];
    expect(userOrder.feeRateBps).toBe(1000);
  });

  it("placeOrder forwards attributes.post_only=true via limit GTC (postOnly is incompatible with market FOK)", async () => {
    const createAndPostOrder = vi.fn().mockResolvedValue({
      orderID: "0xpo",
      status: "live",
    });
    const adapter = makeAdapter({ createAndPostOrder });
    await adapter.placeOrder({
      ...BASE_INTENT,
      attributes: { ...BASE_INTENT.attributes, post_only: true },
    });
    // postOnly path uses createAndPostOrder (limit) with GTC + postOnly=true.
    // clob-client-v2 positional args: (userOrder, options, orderType, postOnly, deferExec).
    const call = createAndPostOrder.mock.calls[0] as unknown[];
    expect(call[2]).toBe("GTC");
    expect(call[3]).toBe(true);
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

  it("sellPositionAtMarket posts a market SELL using the exact share balance", async () => {
    const createAndPostMarketOrder = vi.fn().mockResolvedValue({
      orderID: "0xmarket",
      status: "matched",
      takingAmount: "1.25",
    });
    const getTickSize = vi.fn().mockResolvedValue("0.001");
    const getNegRisk = vi.fn().mockResolvedValue(true);
    const getFeeRateBps = vi.fn().mockResolvedValue(1000);
    const adapter = makeAdapter({
      createAndPostMarketOrder,
      getTickSize,
      getNegRisk,
      getFeeRateBps,
    });

    const receipt = await adapter.sellPositionAtMarket({
      tokenId: "0xtoken",
      shares: 5,
      client_order_id: "0xclientid",
      orderType: "FAK",
    });

    expect(createAndPostMarketOrder).toHaveBeenCalledOnce();
    const [userOrder, opts, orderType] = createAndPostMarketOrder.mock
      .calls[0] as [
      { tokenID: string; amount: number; side: string; feeRateBps: number },
      { tickSize: string; negRisk: boolean },
      string,
    ];
    expect(userOrder).toEqual({
      tokenID: "0xtoken",
      amount: 5,
      side: "SELL",
      feeRateBps: 1000,
    });
    expect(opts).toEqual({ tickSize: "0.001", negRisk: true });
    expect(orderType).toBe("FAK");
    expect(receipt.order_id).toBe("0xmarket");
    expect(receipt.client_order_id).toBe("0xclientid");
    expect(receipt.filled_size_usdc).toBe(1.25);
  });

  it("sellPositionAtMarket rejects a share balance below the market minimum", async () => {
    const createAndPostMarketOrder = vi.fn();
    const getOrderBook = vi.fn().mockResolvedValue({
      min_order_size: "5",
      tick_size: "0.01",
    });
    const adapter = makeAdapter({ createAndPostMarketOrder, getOrderBook });

    let caught: unknown;
    try {
      await adapter.sellPositionAtMarket({
        tokenId: "0xtoken",
        shares: 2,
        client_order_id: "0xclientid",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code?: string }).code).toBe("BELOW_MARKET_MIN");
    expect(createAndPostMarketOrder).not.toHaveBeenCalled();
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

  it("listOpenOrders maps array responses", async () => {
    const getOpenOrders = vi.fn().mockResolvedValue([
      {
        id: "0xopen",
        status: "live",
        side: "BUY",
        original_size: "2",
        size_matched: "1",
        price: "0.5",
      },
    ]);
    const adapter = makeAdapter({ getOpenOrders });

    const orders = await adapter.listOpenOrders({ tokenId: "asset-1" });

    expect(getOpenOrders).toHaveBeenCalledWith({ asset_id: "asset-1" });
    expect(orders).toEqual([
      expect.objectContaining({
        order_id: "0xopen",
        status: "open",
        filled_size_usdc: 0.5,
      }),
    ]);
  });

  it("listOpenOrders returns [] when CLOB returns an error object", async () => {
    const metrics = createRecordingMetrics();
    const getOpenOrders = vi
      .fn()
      .mockResolvedValue({ error: "service not ready", status: 503 });
    const adapter = makeAdapter({ getOpenOrders }, { metrics });

    await expect(adapter.listOpenOrders()).resolves.toEqual([]);
    expect(metrics.emissions).toContainEqual({
      kind: "counter",
      name: POLY_CLOB_METRICS.listOpenOrdersUnavailableTotal,
      labels: { reason: POLY_CLOB_ERROR_CODES.unknown },
    });
  });

  it("listOpenOrders returns [] when CLOB returns null", async () => {
    const getOpenOrders = vi.fn().mockResolvedValue(null);
    const adapter = makeAdapter({ getOpenOrders });

    await expect(adapter.listOpenOrders()).resolves.toEqual([]);
  });

  it("listOpenOrders returns [] when the SDK throws during degraded CLOB reads", async () => {
    const getOpenOrders = vi
      .fn()
      .mockRejectedValue(new TypeError("n.data is not iterable"));
    const adapter = makeAdapter({ getOpenOrders });

    await expect(adapter.listOpenOrders()).resolves.toEqual([]);
  });

  it("listMarkets rejects — CLOB adapter is trade-only", async () => {
    const adapter = makeAdapter({});
    await expect(adapter.listMarkets()).rejects.toThrow(/listMarkets/);
  });

  // bug.0342 ----------------------------------------------------------------

  it("getMarketConstraints returns minShares + tickSize + Polymarket $1 USDC-notional floor", async () => {
    const getOrderBook = vi.fn().mockResolvedValue({
      min_order_size: "5",
      tick_size: "0.01",
    });
    const getTickSize = vi.fn().mockResolvedValue("0.001");
    const adapter = makeAdapter({ getOrderBook, getTickSize });

    const constraints = await adapter.getMarketConstraints("0xtoken");

    expect(getOrderBook).toHaveBeenCalledWith("0xtoken");
    expect(getTickSize).toHaveBeenCalledWith("0xtoken");
    expect(constraints).toEqual({
      minShares: 5,
      tickSize: 0.001,
      minUsdcNotional: 1,
    });
  });

  it("placeOrder rounds limit_price to market tick before submission (bug.5160)", async () => {
    const createAndPostOrder = vi.fn().mockResolvedValue({
      orderID: "0xrounded",
      status: "live",
      makingAmount: "0",
    });
    const adapter = makeAdapter({
      createAndPostOrder,
      getTickSize: vi.fn().mockResolvedValue("0.01"),
    });

    await adapter.placeOrder({
      ...BASE_INTENT,
      attributes: { ...BASE_INTENT.attributes, placement: "limit" },
      size_usdc: 1,
      limit_price: 0.991000089100001,
      side: "BUY",
    });

    const [userOrder] = createAndPostOrder.mock.calls[0] as [
      { price: number; size: number },
      unknown,
      string,
    ];
    expect(userOrder.price).toBe(0.99);
    expect(userOrder.size).toBeCloseTo(1 / 0.99);
  });

  it("placeOrder rejects prices too far outside the market tick grid before hitting CLOB", async () => {
    const createAndPostOrder = vi.fn();
    const adapter = makeAdapter({
      createAndPostOrder,
      getTickSize: vi.fn().mockResolvedValue("0.01"),
    });

    await expect(
      adapter.placeOrder({
        ...BASE_INTENT,
        attributes: { ...BASE_INTENT.attributes, placement: "limit" },
        limit_price: 0.002,
      })
    ).rejects.toMatchObject({
      details: { error_code: POLY_CLOB_ERROR_CODES.invalidPriceOrTick },
    });
    expect(createAndPostOrder).not.toHaveBeenCalled();
  });

  it("placeOrder throws BELOW_MARKET_MIN on sub-$1 USDC-notional BUY (1-share-min cheap market)", async () => {
    const createAndPostOrder = vi.fn(); // must NOT be called
    // 1-share-min market, price 0.49, size_usdc 1 → shareSize 2.04 ≥ 1
    // (share-min OK), but effectiveUsdc = 2.04 × 0.49 = 1.000 → right at
    // boundary. Use a size that yields $0.9996.
    const getOrderBook = vi.fn().mockResolvedValue({
      min_order_size: "1",
      tick_size: "0.01",
    });
    const adapter = makeAdapter({ createAndPostOrder, getOrderBook });

    let caught: unknown;
    try {
      // 1.02 × 0.98 = 0.9996 USDC — share-min passes (1.04 ≥ 1) but usdc-min fails
      await adapter.placeOrder({
        ...BASE_INTENT,
        size_usdc: 0.9996,
        limit_price: 0.98,
        side: "BUY",
      });
    } catch (err) {
      caught = err;
    }
    const errObj = caught as { code?: string };
    expect(errObj.code).toBe("BELOW_MARKET_MIN");
    expect(createAndPostOrder).not.toHaveBeenCalled();
  });

  it("placeOrder throws a classified BELOW_MARKET_MIN error when shareSize < min_order_size", async () => {
    const createAndPostOrder = vi.fn(); // must NOT be called
    // $1 @ 0.64 → 1.5625 shares, market min 5 shares → rejected
    const getOrderBook = vi.fn().mockResolvedValue({
      min_order_size: "5",
      tick_size: "0.01",
    });
    const adapter = makeAdapter({ createAndPostOrder, getOrderBook });

    let caught: unknown;
    try {
      await adapter.placeOrder({
        ...BASE_INTENT,
        size_usdc: 1,
        limit_price: 0.64,
      });
    } catch (err) {
      caught = err;
    }

    // Classify via `err.code` not `instanceof` (cross-package bundling safety).
    expect(caught).toBeInstanceOf(Error);
    const errObj = caught as { code?: string; name?: string; message?: string };
    expect(errObj.code).toBe("BELOW_MARKET_MIN");
    expect(errObj.name).toBe("BelowMarketMinError");
    expect(errObj.message).toMatch(/below market floor/);
    expect(createAndPostOrder).not.toHaveBeenCalled();
  });

  it("placeOrder tolerates float-lossy round-trip at the USDC-notional floor (bug.0342 regression)", async () => {
    // size_usdc=1, price=0.09 → shareSize=11.11…, effectiveUsdc=0.9999999999999999.
    // The round-trip loses precision but the intent clears the floor by
    // design; without epsilon tolerance the adapter bounced prod mirror
    // placements.
    const createAndPostMarketOrder = vi.fn().mockResolvedValue({
      orderID: "0xresp",
      status: "matched",
      makingAmount: "1",
    });
    const getOrderBook = vi.fn().mockResolvedValue({
      min_order_size: "5",
      tick_size: "0.01",
    });
    const adapter = makeAdapter({ createAndPostMarketOrder, getOrderBook });

    await expect(
      adapter.placeOrder({
        ...BASE_INTENT,
        size_usdc: 1,
        limit_price: 0.09,
        side: "BUY",
      })
    ).resolves.toMatchObject({ order_id: "0xresp" });
    expect(createAndPostMarketOrder).toHaveBeenCalled();
  });

  it("placeOrder proceeds when shareSize >= min_order_size", async () => {
    const createAndPostMarketOrder = vi.fn().mockResolvedValue({
      orderID: "0xresp",
      status: "matched",
      makingAmount: "5",
    });
    // $5 @ 0.50 → 10 shares ≥ 5-share min
    const getOrderBook = vi.fn().mockResolvedValue({
      min_order_size: "5",
      tick_size: "0.01",
    });
    const adapter = makeAdapter({ createAndPostMarketOrder, getOrderBook });

    const receipt = await adapter.placeOrder({
      ...BASE_INTENT,
      size_usdc: 5,
      limit_price: 0.5,
    });

    expect(createAndPostMarketOrder).toHaveBeenCalledOnce();
    expect(receipt.order_id).toBe("0xresp");
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
      createAndPostMarketOrder?: ReturnType<typeof vi.fn>;
      cancelOrder?: ReturnType<typeof vi.fn>;
      getOrder?: ReturnType<typeof vi.fn>;
      getTickSize?: ReturnType<typeof vi.fn>;
      getNegRisk?: ReturnType<typeof vi.fn>;
      getFeeRateBps?: ReturnType<typeof vi.fn>;
      getOrderBook?: ReturnType<typeof vi.fn>;
      getOpenOrders?: ReturnType<typeof vi.fn>;
    },
    observability: { logger?: LoggerPort; metrics?: MetricsPort } = {}
  ) {
    stub.getTickSize ??= vi.fn().mockResolvedValue("0.01");
    stub.getNegRisk ??= vi.fn().mockResolvedValue(false);
    stub.getFeeRateBps ??= vi.fn().mockResolvedValue(0);
    stub.getOrderBook ??= vi
      .fn()
      .mockResolvedValue({ min_order_size: "1", tick_size: "0.01" });
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
    const createAndPostMarketOrder = vi.fn().mockResolvedValue({
      orderID: "0xok",
      status: "matched",
      makingAmount: "1",
    });
    const adapter = makeAdapter(
      { createAndPostMarketOrder },
      { logger, metrics }
    );

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
    const createAndPostMarketOrder = vi.fn().mockResolvedValue({
      orderID: "0xrej",
      success: false,
      errorMsg: "fee rate for the market must be 1000",
    });
    const adapter = makeAdapter(
      { createAndPostMarketOrder },
      { logger, metrics }
    );

    await expect(adapter.placeOrder(BASE_INTENT)).rejects.toThrow(
      /CLOB rejected order/
    );

    // Counter labeled result=rejected (not error), carries error_code sub-label
    // so dashboards can split silent rejects by class (bug.0335).
    const rejects = metrics.emissions.filter(
      (e) =>
        e.kind === "counter" &&
        e.name === POLY_CLOB_METRICS.placeTotal &&
        e.labels.result === "rejected"
    );
    expect(rejects).toHaveLength(1);
    expect(rejects[0]?.labels.error_code).toBe(POLY_CLOB_ERROR_CODES.unknown);

    const errLog = calls.find((c) => c.level === "error");
    expect(errLog?.obj).toMatchObject({
      event: "poly.clob.place",
      phase: "rejected",
      client_order_id: BASE_INTENT.client_order_id,
      error_code: POLY_CLOB_ERROR_CODES.unknown,
      reason: POLY_CLOB_ERROR_CODES.unknown,
    });
    expect(typeof errLog?.obj.duration_ms).toBe("number");
  });

  it("placeOrder classifies thrown network errors as result=error", async () => {
    const { logger, calls } = makeRecordingLogger();
    const metrics = createRecordingMetrics();
    const createAndPostMarketOrder = vi
      .fn()
      .mockRejectedValue(new Error("ECONNRESET"));
    const adapter = makeAdapter(
      { createAndPostMarketOrder },
      { logger, metrics }
    );

    await expect(adapter.placeOrder(BASE_INTENT)).rejects.toThrow(/ECONNRESET/);

    const errs = metrics.emissions.filter(
      (e) =>
        e.kind === "counter" &&
        e.name === POLY_CLOB_METRICS.placeTotal &&
        e.labels.result === "error"
    );
    expect(errs).toHaveLength(1);
    expect(errs[0]?.labels.error_code).toBe(POLY_CLOB_ERROR_CODES.unknown);
    const errLog = calls.find((c) => c.level === "error");
    expect(errLog?.obj.phase).toBe("error");
    expect(errLog?.obj.reason).toBe(POLY_CLOB_ERROR_CODES.unknown);
  });

  it("placeOrder reclassifies FOK empty-response rejects as fok_no_match (bug.0405)", async () => {
    const { logger, calls } = makeRecordingLogger();
    const metrics = createRecordingMetrics();
    // Polymarket CLOB returns `{}` (or `{success:false}` with no orderID) when
    // FOK can't fully match. Should bucket as `fok_no_match` so the coordinator
    // can skip cleanly without retry, distinct from real errors.
    const createAndPostMarketOrder = vi.fn().mockResolvedValue({});
    const adapter = makeAdapter(
      { createAndPostMarketOrder },
      { logger, metrics }
    );

    await expect(adapter.placeOrder(BASE_INTENT)).rejects.toThrow(
      /CLOB rejected order/
    );

    const rejects = metrics.emissions.filter(
      (e) =>
        e.kind === "counter" &&
        e.name === POLY_CLOB_METRICS.placeTotal &&
        e.labels.result === "rejected"
    );
    expect(rejects).toHaveLength(1);
    expect(rejects[0]?.labels.error_code).toBe(
      POLY_CLOB_ERROR_CODES.fokNoMatch
    );
    const errLog = calls.find((c) => c.level === "error");
    expect(errLog?.obj.error_code).toBe(POLY_CLOB_ERROR_CODES.fokNoMatch);
  });

  it("placeOrder reclassifies FOK success-with-zero-fill as fok_no_match (bug.0420)", async () => {
    const { logger, calls } = makeRecordingLogger();
    const metrics = createRecordingMetrics();
    // Observed live 2026-04-29 (PR #1118 follow-up): CLOB can return
    // `{success:true, orderID:"0x..", makingAmount:"0"}` when FOK accepts the
    // order shape but no liquidity matches at limit_price. Without this
    // reclassification the mirror logged outcome=placed for a fill that
    // acquired zero shares.
    const createAndPostMarketOrder = vi.fn().mockResolvedValue({
      success: true,
      orderID: "0x220cd5d9",
      status: "matched",
      makingAmount: "0",
    });
    const adapter = makeAdapter(
      { createAndPostMarketOrder },
      { logger, metrics }
    );

    await expect(adapter.placeOrder(BASE_INTENT)).rejects.toThrow(
      /FOK matched zero shares/
    );

    const rejects = metrics.emissions.filter(
      (e) =>
        e.kind === "counter" &&
        e.name === POLY_CLOB_METRICS.placeTotal &&
        e.labels.result === "rejected"
    );
    expect(rejects).toHaveLength(1);
    expect(rejects[0]?.labels.error_code).toBe(
      POLY_CLOB_ERROR_CODES.fokNoMatch
    );
    const errLog = calls.find((c) => c.level === "error");
    expect(errLog?.obj.error_code).toBe(POLY_CLOB_ERROR_CODES.fokNoMatch);
    expect(errLog?.obj.reason).toBe("fok_zero_fill");
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
    const cancelOrder = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const adapter = makeAdapter({ cancelOrder }, { logger, metrics });

    await expect(adapter.cancelOrder("0xabc")).rejects.toThrow(/ECONNRESET/);
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
