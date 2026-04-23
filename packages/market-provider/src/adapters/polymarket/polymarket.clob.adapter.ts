// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/adapters/polymarket/clob`
 * Purpose: Polymarket CLOB Run-phase adapter — place / cancel / status orders via `@polymarket/clob-client`.
 * Scope: Trade-only adapter. Constructor injects a `ClobSigner` (viem WalletClient) + L2 API creds + host + chainId + funder EOA. Does not list markets (use the Gamma `PolymarketAdapter` for reads). Does not load env, does not create the signer, does not know about Privy.
 * Invariants:
 *   - PACKAGES_NO_ENV — all config via constructor.
 *   - SIGNER_VIA_LOCAL_ACCOUNT — caller passes a viem `LocalAccount` wrapped in a `WalletClient`. No custom signer port.
 *   - EOA_PATH_ONLY — signatureType defaults to `SignatureType.EOA`. Safe-proxy accounts are out of scope (see task.0315 Phase 1 "Custody model").
 * Side-effects: IO (HTTPS to the Polymarket CLOB).
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 CP3.2)
 * @public
 */

import {
  type ApiKeyCreds,
  Chain,
  ClobClient,
  type ClobSigner,
  OrderType,
  Side,
  SignatureType,
  type TickSize,
} from "@polymarket/clob-client";

import type {
  GetOrderResult,
  OrderIntent,
  OrderReceipt,
} from "../../domain/order.js";
import type {
  ListMarketsParams,
  NormalizedMarket,
} from "../../domain/schemas.js";
import {
  BELOW_MARKET_MIN_CODE,
  type MarketConstraints,
  type MarketProviderPort,
} from "../../port/market-provider.port.js";
import {
  type LoggerPort,
  type MetricsPort,
  noopLogger,
  noopMetrics,
} from "../../port/observability.port.js";

/** Metric names emitted by this adapter. Stable — dashboards reference these. */
export const POLY_CLOB_METRICS = {
  placeTotal: "poly_clob_place_total",
  placeDurationMs: "poly_clob_place_duration_ms",
  cancelTotal: "poly_clob_cancel_total",
  cancelDurationMs: "poly_clob_cancel_duration_ms",
  getOrderTotal: "poly_clob_get_order_total",
  getOrderDurationMs: "poly_clob_get_order_duration_ms",
  listOpenOrdersTotal: "poly_clob_list_open_orders_total",
  listOpenOrdersDurationMs: "poly_clob_list_open_orders_duration_ms",
} as const;

/**
 * Truncate an error message before logging — CLOB rejection bodies can include
 * long signature / domain dumps, and we don't want to blow up a log line.
 */
function truncErr(e: unknown, max = 512): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > max ? `${msg.slice(0, max)}…` : msg;
}

function makeBelowMarketMinError(message: string): Error {
  const err = new Error(message);
  // Discriminator for cross-package catch blocks — `err.code` is
  // bundler-stable where `instanceof` is not.
  (err as unknown as { code: string }).code = BELOW_MARKET_MIN_CODE;
  err.name = "BelowMarketMinError";
  return err;
}

/**
 * `/neg-risk` and tick-size helpers sometimes return `"0"`/`"1"` or numbers —
 * `createAndPostOrder` needs a real boolean or EIP-712 targets the wrong exchange (bug.0329).
 */
export function coerceNegRiskApiValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === true) return true;
  if (value === 0 || value === "0" || value === false) return false;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  return Boolean(value);
}

/** Placement responses may use `orderID`, `orderId`, or `order_id`. */
export function extractClobPlacedOrderId(
  response: unknown
): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const r = response as Record<string, unknown>;
  const candidates = [r.orderID, r.orderId, r.order_id];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return undefined;
}

/** Default Polymarket CLOB host. */
const DEFAULT_CLOB_HOST = "https://clob.polymarket.com";

export interface PolymarketClobAdapterConfig {
  /** viem `WalletClient` (or ethers v5 `Signer`) — holds the Polymarket EOA. */
  signer: ClobSigner;
  /** L2 API creds from `createOrDeriveApiKey` (task.0315 CP2.5). */
  creds: ApiKeyCreds;
  /** Funder EOA — for EOA-path accounts this equals the signer address. */
  funderAddress: `0x${string}`;
  /** Override CLOB host (default: https://clob.polymarket.com). */
  host?: string;
  /** Chain id — defaults to Polygon mainnet (137). */
  chainId?: Chain;
  /** Signature type — defaults to EOA. Safe-proxy path is out of scope for P1. */
  signatureType?: SignatureType;
  /**
   * Structured-log sink. Defaults to a no-op; the node-app bootstrap should
   * pass a pino child logger bound with `{component: "poly-clob-adapter"}`.
   * Every log line carries `provider`, `chain_id`, `funder`, and — where
   * applicable — `token_id`, `client_order_id`, `order_id`, `duration_ms`.
   * On `phase: rejected|error` the line additionally carries `error_code`
   * (from `POLY_CLOB_ERROR_CODES`), `http_status`, `response_keys`, `reason`,
   * and the preflight market context (`tick_size`, `neg_risk`, `fee_rate_bps`).
   */
  logger?: LoggerPort;
  /**
   * Metrics sink. Defaults to a no-op. Emits:
   *   - `poly_clob_place_total{result, error_code}` (counter; result ∈ ok|rejected|error; error_code set on non-ok)
   *   - `poly_clob_place_duration_ms{result, error_code}` (duration observation)
   *   - analogous pairs for `cancel` and `get_order` (without error_code).
   * Dashboards reference the names in `POLY_CLOB_METRICS`.
   */
  metrics?: MetricsPort;
}

export interface PolymarketMarketSellParams {
  /** ERC-1155 asset id being sold. */
  tokenId: string;
  /** Exact number of outcome shares to sell. */
  shares: number;
  /** Caller correlation key echoed in the receipt. */
  client_order_id: string;
  /** Market order execution policy. */
  orderType?: OrderType.FOK | OrderType.FAK;
}

/**
 * Polymarket CLOB Run-phase adapter.
 *
 * Conversions:
 *   - OrderIntent.size_usdc (USDC dollars) → CLOB `size` (outcome shares): `size_usdc / limit_price`.
 *   - OrderIntent.attributes.token_id (Polymarket ERC-1155 asset id) → CLOB `tokenID`. Required.
 *   - Polymarket CLOB `OrderResponse.status` → canonical `OrderStatus` via small mapping.
 *
 * NOT wired:
 *   - `listMarkets` — throws; use the Gamma `PolymarketAdapter` for reads.
 *   - Server-side `client_order_id` dedupe — Polymarket's CLOB does not accept a
 *     caller-supplied idempotency key, so the receipt's `client_order_id` echoes
 *     the intent verbatim and the caller's PK (`poly_copy_trade_fills`) is the
 *     sole dedupe gate. See task.0315 `IDEMPOTENT_BY_CLIENT_ID`.
 */
export class PolymarketClobAdapter implements MarketProviderPort {
  readonly provider = "polymarket" as const;
  private readonly client: ClobClient;
  private readonly funderAddress: `0x${string}`;
  private readonly log: LoggerPort;
  private readonly metrics: MetricsPort;
  private readonly chainId: Chain;

  constructor(config: PolymarketClobAdapterConfig) {
    this.funderAddress = config.funderAddress;
    this.chainId = config.chainId ?? Chain.POLYGON;
    this.client = new ClobClient(
      config.host ?? DEFAULT_CLOB_HOST,
      this.chainId,
      config.signer,
      config.creds,
      config.signatureType ?? SignatureType.EOA,
      config.funderAddress
    );
    const baseLog = config.logger ?? noopLogger;
    this.log = baseLog.child({
      component: "poly-clob-adapter",
      provider: this.provider,
      chain_id: this.chainId,
      funder: this.funderAddress,
    });
    this.metrics = config.metrics ?? noopMetrics;
  }

  listMarkets(_params?: ListMarketsParams): Promise<NormalizedMarket[]> {
    return Promise.reject(
      new Error(
        "PolymarketClobAdapter does not implement listMarkets — use the Gamma PolymarketAdapter for reads."
      )
    );
  }

  async placeOrder(intent: OrderIntent): Promise<OrderReceipt> {
    const start = Date.now();
    const tokenId = readStringAttribute(intent, "token_id");
    const baseFields = {
      event: "poly.clob.place",
      market_id: intent.market_id,
      outcome: intent.outcome,
      side: intent.side,
      size_usdc: intent.size_usdc,
      limit_price: intent.limit_price,
      client_order_id: intent.client_order_id,
      token_id: tokenId,
      post_only: intent.attributes?.post_only === true,
    };
    this.log.info({ ...baseFields, phase: "start" }, "placeOrder: start");

    if (!tokenId) {
      const duration_ms = Date.now() - start;
      this.metrics.incr(POLY_CLOB_METRICS.placeTotal, { result: "error" });
      this.metrics.observeDurationMs(
        POLY_CLOB_METRICS.placeDurationMs,
        duration_ms,
        { result: "error" }
      );
      this.log.error(
        {
          ...baseFields,
          phase: "error",
          duration_ms,
          reason: "missing_token_id",
        },
        "placeOrder: missing token_id"
      );
      throw new Error(
        "PolymarketClobAdapter.placeOrder requires intent.attributes.token_id (ERC-1155 asset id)."
      );
    }

    const shareSize = intent.size_usdc / intent.limit_price;
    const side = intent.side === "BUY" ? Side.BUY : Side.SELL;

    // Hoisted so the error path can include market context (bug.0335 — a
    // tick-size/fee-rate mismatch previously only appeared on the success log).
    let tickSize: TickSize | undefined;
    let negRisk: boolean | undefined;
    let feeRateBps: number | undefined;

    try {
      // B1 — fetch per-market tickSize + negRisk + feeRateBps rather than hardcoding.
      // Polymarket has markets with 0.001 / 0.0001 tick sizes, neg-risk markets route
      // through a different Exchange contract, and live markets today reject
      // feeRateBps=0 with "fee rate for the market must be 1000". A stale hardcode
      // either rejects at the CLOB or produces a bad EIP-712 signature.
      //
      // `orderBook.min_order_size` joins the parallel fetch for bug.0342:
      // Polymarket rejects sub-min orders with an empty `{}` body — the adapter
      // MUST pre-check before signing. The share-space guard below runs
      // regardless of whether the coordinator already scaled the intent.
      const preflight = await Promise.all([
        this.client.getTickSize(tokenId),
        this.client.getNegRisk(tokenId),
        this.client.getFeeRateBps(tokenId),
        this.client.getOrderBook(tokenId),
      ]);
      [tickSize, negRisk, feeRateBps] = preflight;
      negRisk = coerceNegRiskApiValue(negRisk);
      const orderBook = preflight[3];

      const minShares = Number(orderBook.min_order_size);
      const effectiveUsdc = shareSize * intent.limit_price;
      // Polymarket marketable-BUY $1 USDC notional floor is platform-level,
      // not exposed per-market. Hardcoded here; kept in lock-step with
      // getMarketConstraints.minUsdcNotional. bug.0342.
      const POLY_MARKETABLE_BUY_MIN_USDC = 1;
      const belowShareMin = Number.isFinite(minShares) && shareSize < minShares;
      const belowUsdcMin =
        intent.side === "BUY" &&
        intent.attributes?.post_only !== true &&
        effectiveUsdc < POLY_MARKETABLE_BUY_MIN_USDC;
      if (belowShareMin || belowUsdcMin) {
        throw makeBelowMarketMinError(
          `PolymarketClobAdapter.placeOrder: intent below market floor (gotShares=${shareSize}, minShares=${minShares}, gotUsdc=${effectiveUsdc}, minUsdc=${POLY_MARKETABLE_BUY_MIN_USDC}, tokenId=${tokenId}). Coordinator should have scaled or skipped. bug.0342.`
        );
      }

      const postOnly = intent.attributes?.post_only === true;

      const response: unknown = await this.client.createAndPostOrder(
        {
          tokenID: tokenId,
          price: intent.limit_price,
          size: shareSize,
          side,
          feeRateBps,
        },
        { tickSize, negRisk },
        OrderType.GTC,
        /* deferExec */ undefined,
        /* postOnly */ postOnly || undefined
      );

      const receipt = mapOrderResponseToReceipt(response, intent);
      const duration_ms = Date.now() - start;
      this.metrics.incr(POLY_CLOB_METRICS.placeTotal, { result: "ok" });
      this.metrics.observeDurationMs(
        POLY_CLOB_METRICS.placeDurationMs,
        duration_ms,
        { result: "ok" }
      );
      this.log.info(
        {
          ...baseFields,
          phase: "ok",
          duration_ms,
          order_id: receipt.order_id,
          status: receipt.status,
          filled_size_usdc: receipt.filled_size_usdc,
          tick_size: tickSize,
          neg_risk: negRisk,
          fee_rate_bps: feeRateBps,
        },
        "placeOrder: ok"
      );
      return receipt;
    } catch (err) {
      const duration_ms = Date.now() - start;
      // Rejections from mapOrderResponseToReceipt throw ClobRejectionError; other
      // thrown errors (axios non-2xx, network, etc.) come via classifyClientError.
      const details =
        err instanceof ClobRejectionError
          ? err.details
          : classifyClientError(err);
      const result = err instanceof ClobRejectionError ? "rejected" : "error";
      this.metrics.incr(POLY_CLOB_METRICS.placeTotal, {
        result,
        error_code: details.error_code,
      });
      this.metrics.observeDurationMs(
        POLY_CLOB_METRICS.placeDurationMs,
        duration_ms,
        { result, error_code: details.error_code }
      );
      this.log.error(
        {
          ...baseFields,
          phase: result,
          duration_ms,
          tick_size: tickSize,
          neg_risk: negRisk,
          fee_rate_bps: feeRateBps,
          error_code: details.error_code,
          http_status: details.http_status,
          response_keys: details.response_keys,
          reason: details.reason,
        },
        `placeOrder: ${result}`
      );
      throw err;
    }
  }

  async sellPositionAtMarket(
    params: PolymarketMarketSellParams
  ): Promise<OrderReceipt> {
    const start = Date.now();
    const baseFields = {
      event: "poly.clob.place",
      side: "SELL" as const,
      token_id: params.tokenId,
      client_order_id: params.client_order_id,
      shares: params.shares,
      order_mode: "market",
    };
    this.log.info(
      { ...baseFields, phase: "start" },
      "sellPositionAtMarket: start"
    );

    let tickSize: TickSize | undefined;
    let negRisk: boolean | undefined;
    let feeRateBps: number | undefined;

    try {
      const preflight = await Promise.all([
        this.client.getTickSize(params.tokenId),
        this.client.getNegRisk(params.tokenId),
        this.client.getFeeRateBps(params.tokenId),
        this.client.getOrderBook(params.tokenId),
      ]);
      [tickSize, negRisk, feeRateBps] = preflight;
      negRisk = coerceNegRiskApiValue(negRisk);
      const orderBook = preflight[3];
      const minShares = Number(orderBook.min_order_size);
      if (Number.isFinite(minShares) && params.shares < minShares) {
        throw makeBelowMarketMinError(
          `PolymarketClobAdapter.sellPositionAtMarket: share balance below market floor (gotShares=${params.shares}, minShares=${minShares}, tokenId=${params.tokenId}).`
        );
      }

      const response: unknown = await this.client.createAndPostMarketOrder(
        {
          tokenID: params.tokenId,
          amount: params.shares,
          side: Side.SELL,
          feeRateBps,
        },
        { tickSize, negRisk },
        params.orderType ?? OrderType.FAK
      );

      const receipt = mapOrderResponseToReceipt(response, {
        provider: "polymarket",
        market_id: `prediction-market:polymarket:${params.tokenId}`,
        outcome: "EXIT",
        side: "SELL",
        size_usdc: params.shares,
        limit_price: 1,
        client_order_id: params.client_order_id,
        attributes: { token_id: params.tokenId, order_mode: "market" },
      });
      const duration_ms = Date.now() - start;
      this.metrics.incr(POLY_CLOB_METRICS.placeTotal, { result: "ok" });
      this.metrics.observeDurationMs(
        POLY_CLOB_METRICS.placeDurationMs,
        duration_ms,
        { result: "ok" }
      );
      this.log.info(
        {
          ...baseFields,
          phase: "ok",
          duration_ms,
          order_id: receipt.order_id,
          status: receipt.status,
          filled_size_usdc: receipt.filled_size_usdc,
          tick_size: tickSize,
          neg_risk: negRisk,
          fee_rate_bps: feeRateBps,
        },
        "sellPositionAtMarket: ok"
      );
      return receipt;
    } catch (err) {
      const duration_ms = Date.now() - start;
      const details =
        err instanceof ClobRejectionError
          ? err.details
          : classifyClientError(err);
      const result = err instanceof ClobRejectionError ? "rejected" : "error";
      this.metrics.incr(POLY_CLOB_METRICS.placeTotal, {
        result,
        error_code: details.error_code,
      });
      this.metrics.observeDurationMs(
        POLY_CLOB_METRICS.placeDurationMs,
        duration_ms,
        { result, error_code: details.error_code }
      );
      this.log.error(
        {
          ...baseFields,
          phase: result,
          duration_ms,
          tick_size: tickSize,
          neg_risk: negRisk,
          fee_rate_bps: feeRateBps,
          error_code: details.error_code,
          http_status: details.http_status,
          response_keys: details.response_keys,
          reason: details.reason,
        },
        `sellPositionAtMarket: ${result}`
      );
      throw err;
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    const start = Date.now();
    this.log.info(
      { event: "poly.clob.cancel", phase: "start", order_id: orderId },
      "cancelOrder: start"
    );
    try {
      await this.client.cancelOrder({ orderID: orderId });
      const duration_ms = Date.now() - start;
      this.metrics.incr(POLY_CLOB_METRICS.cancelTotal, { result: "ok" });
      this.metrics.observeDurationMs(
        POLY_CLOB_METRICS.cancelDurationMs,
        duration_ms,
        { result: "ok" }
      );
      this.log.info(
        {
          event: "poly.clob.cancel",
          phase: "ok",
          duration_ms,
          order_id: orderId,
        },
        "cancelOrder: ok"
      );
    } catch (err) {
      const duration_ms = Date.now() - start;
      this.metrics.incr(POLY_CLOB_METRICS.cancelTotal, { result: "error" });
      this.metrics.observeDurationMs(
        POLY_CLOB_METRICS.cancelDurationMs,
        duration_ms,
        { result: "error" }
      );
      this.log.error(
        {
          event: "poly.clob.cancel",
          phase: "error",
          duration_ms,
          order_id: orderId,
          error: truncErr(err),
        },
        "cancelOrder: error"
      );
      throw err;
    }
  }

  async getOrder(orderId: string): Promise<GetOrderResult> {
    const start = Date.now();
    this.log.debug(
      { event: "poly.clob.get_order", phase: "start", order_id: orderId },
      "getOrder: start"
    );
    try {
      const open = await this.client.getOrder(orderId);
      // GETORDER_NEVER_NULL (task.0328 CP1): a null / empty body from the CLOB
      // means the order is not found — return the discriminant rather than null.
      if (!open || !open.id) {
        const duration_ms = Date.now() - start;
        this.metrics.incr(POLY_CLOB_METRICS.getOrderTotal, {
          result: "not_found",
        });
        this.metrics.observeDurationMs(
          POLY_CLOB_METRICS.getOrderDurationMs,
          duration_ms,
          { result: "not_found" }
        );
        this.log.debug(
          {
            event: "poly.clob.get_order",
            phase: "not_found",
            duration_ms,
            order_id: orderId,
          },
          "getOrder: not_found"
        );
        return { status: "not_found" };
      }
      const receipt = mapOpenOrderToReceipt(open);
      const duration_ms = Date.now() - start;
      this.metrics.incr(POLY_CLOB_METRICS.getOrderTotal, { result: "ok" });
      this.metrics.observeDurationMs(
        POLY_CLOB_METRICS.getOrderDurationMs,
        duration_ms,
        { result: "ok" }
      );
      this.log.debug(
        {
          event: "poly.clob.get_order",
          phase: "ok",
          duration_ms,
          order_id: orderId,
          status: receipt.status,
          filled_size_usdc: receipt.filled_size_usdc,
        },
        "getOrder: ok"
      );
      return { found: receipt };
    } catch (err) {
      // 404-style errors from the CLOB client surface as thrown errors with
      // messages like "Order not found" or HTTP 404. Treat those as not_found
      // rather than hard errors — the order may have been purged from CLOB.
      const errMsg =
        err instanceof Error ? err.message.toLowerCase() : String(err);
      if (
        errMsg.includes("not found") ||
        errMsg.includes("404") ||
        errMsg.includes("order does not exist")
      ) {
        const duration_ms = Date.now() - start;
        this.metrics.incr(POLY_CLOB_METRICS.getOrderTotal, {
          result: "not_found",
        });
        this.metrics.observeDurationMs(
          POLY_CLOB_METRICS.getOrderDurationMs,
          duration_ms,
          { result: "not_found" }
        );
        this.log.debug(
          {
            event: "poly.clob.get_order",
            phase: "not_found",
            duration_ms,
            order_id: orderId,
            error: truncErr(err),
          },
          "getOrder: not_found (CLOB 404)"
        );
        return { status: "not_found" };
      }
      const duration_ms = Date.now() - start;
      this.metrics.incr(POLY_CLOB_METRICS.getOrderTotal, { result: "error" });
      this.metrics.observeDurationMs(
        POLY_CLOB_METRICS.getOrderDurationMs,
        duration_ms,
        { result: "error" }
      );
      this.log.error(
        {
          event: "poly.clob.get_order",
          phase: "error",
          duration_ms,
          order_id: orderId,
          error: truncErr(err),
        },
        "getOrder: error"
      );
      throw err;
    }
  }

  async listOpenOrders(params?: {
    tokenId?: string;
    market?: string;
  }): Promise<OrderReceipt[]> {
    const start = Date.now();
    const apiParams: { asset_id?: string; market?: string } = {};
    if (params?.tokenId) apiParams.asset_id = params.tokenId;
    if (params?.market) apiParams.market = params.market;
    this.log.debug(
      {
        event: "poly.clob.list_open_orders",
        phase: "start",
        token_id: params?.tokenId,
        market: params?.market,
      },
      "listOpenOrders: start"
    );
    try {
      const open = await this.client.getOpenOrders(apiParams);
      const rows: OrderReceipt[] = Array.isArray(open)
        ? open.map(mapOpenOrderToReceipt)
        : [];
      const duration_ms = Date.now() - start;
      this.metrics.incr(POLY_CLOB_METRICS.listOpenOrdersTotal, {
        result: "ok",
      });
      this.metrics.observeDurationMs(
        POLY_CLOB_METRICS.listOpenOrdersDurationMs,
        duration_ms,
        { result: "ok" }
      );
      this.log.debug(
        {
          event: "poly.clob.list_open_orders",
          phase: "ok",
          duration_ms,
          count: rows.length,
        },
        "listOpenOrders: ok"
      );
      return rows;
    } catch (err) {
      const duration_ms = Date.now() - start;
      this.metrics.incr(POLY_CLOB_METRICS.listOpenOrdersTotal, {
        result: "error",
      });
      this.metrics.observeDurationMs(
        POLY_CLOB_METRICS.listOpenOrdersDurationMs,
        duration_ms,
        { result: "error" }
      );
      this.log.error(
        {
          event: "poly.clob.list_open_orders",
          phase: "error",
          duration_ms,
          error: truncErr(err),
        },
        "listOpenOrders: error"
      );
      throw err;
    }
  }

  /**
   * Fetch `min_order_size` from the token's order book. Polymarket exposes
   * market-min on `OrderBookSummary.min_order_size` (string; verified on SDK
   * 5.8.1 `types.d.ts`). bug.0342.
   */
  async getMarketConstraints(tokenId: string): Promise<MarketConstraints> {
    const start = Date.now();
    try {
      const book = await this.client.getOrderBook(tokenId);
      const minShares = Number(book.min_order_size);
      if (!Number.isFinite(minShares) || minShares <= 0) {
        throw new Error(
          `PolymarketClobAdapter.getMarketConstraints: unexpected min_order_size=${book.min_order_size} for token ${tokenId}`
        );
      }
      // Polymarket platform rule: marketable BUY orders must be ≥ $1 USDC
      // notional. This is a platform constant (not a per-market field exposed
      // by the SDK), hardcoded here so the coordinator can pre-scale intents.
      // Observed live on candidate-a 2026-04-21: "invalid amount for a
      // marketable BUY order ($0.9996), min size: $1".
      const POLY_MARKETABLE_BUY_MIN_USDC = 1;
      const duration_ms = Date.now() - start;
      this.log.debug(
        {
          event: "poly.clob.get_market_constraints",
          phase: "ok",
          duration_ms,
          token_id: tokenId,
          min_shares: minShares,
          min_usdc_notional: POLY_MARKETABLE_BUY_MIN_USDC,
        },
        "getMarketConstraints: ok"
      );
      return {
        minShares,
        minUsdcNotional: POLY_MARKETABLE_BUY_MIN_USDC,
      };
    } catch (err) {
      const duration_ms = Date.now() - start;
      this.log.error(
        {
          event: "poly.clob.get_market_constraints",
          phase: "error",
          duration_ms,
          token_id: tokenId,
          error: truncErr(err),
        },
        "getMarketConstraints: error"
      );
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Mapping helpers (exported for unit tests)
// ---------------------------------------------------------------------------

function readStringAttribute(
  intent: OrderIntent,
  key: string
): string | undefined {
  const value = intent.attributes?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Normalize a Polymarket CLOB status string to the canonical `OrderStatus`.
 * Polymarket's live statuses include: `live`, `unmatched`, `matched`, `canceled`,
 * `error`, etc. Unknown values collapse to `pending`; the raw string is preserved
 * on the receipt under `attributes.rawStatus` for debugging.
 */
export function normalizePolymarketStatus(raw: string): OrderReceipt["status"] {
  const lowered = raw.toLowerCase();
  if (lowered === "filled" || lowered === "matched") return "filled";
  if (lowered === "live" || lowered === "placed" || lowered === "unmatched")
    return "open";
  if (lowered === "canceled" || lowered === "cancelled") return "canceled";
  if (lowered === "error" || lowered === "failed") return "error";
  if (lowered.includes("partial")) return "partial";
  return "pending";
}

interface ClobOrderResponseLike {
  orderID?: string;
  orderId?: string;
  order_id?: string;
  status?: string;
  success?: boolean;
  errorMsg?: string;
  /**
   * Rejection payloads observed live on candidate-a 2026-04-21 carry `{error, status}`
   * rather than the documented `{success, errorMsg, orderID}` shape. `classifyClobFailure`
   * reads `errorMsg` then falls back to `error` / `message`. Keep both typed so new call
   * paths don't regress on the discovered shape.
   */
  error?: string;
  message?: string;
  makingAmount?: string;
  takingAmount?: string;
  transactionsHashes?: string[];
}

/**
 * Enum of known CLOB rejection classes. Logged as `error_code` on the adapter
 * error event and as a metric label. Expand the switch in `classifyClobFailure`
 * when a new signature shows up in Loki and we decide it's worth alerting on.
 */
export const POLY_CLOB_ERROR_CODES = {
  insufficientBalance: "insufficient_balance",
  insufficientAllowance: "insufficient_allowance",
  staleApiKey: "stale_api_key",
  invalidSignature: "invalid_signature",
  invalidPriceOrTick: "invalid_price_or_tick",
  /**
   * Order size below the market's minimum (per-market, dynamic). CLOB returns
   * messages like `"Size (1.58) lower than the minimum: 5"` or `"invalid
   * amount for a marketable BUY order ($0.9996), min size: $1"`. Pair with
   * bug.0342 (dynamic scale-up-to-min).
   */
  belowMinOrderSize: "below_min_order_size",
  emptyResponse: "empty_response",
  httpError: "http_error",
  unknown: "unknown",
} as const;
export type PolyClobErrorCode =
  (typeof POLY_CLOB_ERROR_CODES)[keyof typeof POLY_CLOB_ERROR_CODES];

export interface ClobFailureDetails {
  error_code: PolyClobErrorCode;
  /** Keys present on the response body — useful when CLOB returns an unexpected shape. */
  response_keys: string[];
  /** HTTP status if the underlying client threw an axios-like error. */
  http_status?: number;
  /** Short operator-facing reason text, truncated. Never contains user content. */
  reason?: string;
}

export class ClobRejectionError extends Error {
  readonly details: ClobFailureDetails;
  constructor(message: string, details: ClobFailureDetails) {
    super(message);
    this.name = "ClobRejectionError";
    this.details = details;
  }
}

function classifyRejectionMessage(msg: string): PolyClobErrorCode {
  const lowered = msg.toLowerCase();
  if (
    lowered.includes("not enough balance") ||
    lowered.includes("insufficient funds")
  )
    return POLY_CLOB_ERROR_CODES.insufficientBalance;
  if (lowered.includes("allowance"))
    return POLY_CLOB_ERROR_CODES.insufficientAllowance;
  if (
    lowered.includes("invalid api key") ||
    lowered.includes("api key") ||
    lowered.includes("unauthorized") ||
    lowered.includes("forbidden")
  )
    return POLY_CLOB_ERROR_CODES.staleApiKey;
  if (lowered.includes("signature"))
    return POLY_CLOB_ERROR_CODES.invalidSignature;
  // Min-order-size signatures observed live on candidate-a (bug.0342):
  //   "Size (1.58) lower than the minimum: 5"
  //   "invalid amount for a marketable BUY order ($0.9996), min size: $1"
  if (
    lowered.includes("minimum") ||
    lowered.includes("min size") ||
    lowered.includes("invalid amount")
  )
    return POLY_CLOB_ERROR_CODES.belowMinOrderSize;
  if (lowered.includes("tick") || lowered.includes("price"))
    return POLY_CLOB_ERROR_CODES.invalidPriceOrTick;
  return POLY_CLOB_ERROR_CODES.unknown;
}

/**
 * Extract a structured failure summary from whatever CLOB returned. Used to
 * replace the ad-hoc `(success=undefined, orderID=<missing>, errorMsg="")`
 * string — that format dropped the HTTP status, response shape, and any
 * fields outside the 4-prop `ClobOrderResponseLike` interface, which made
 * silent rejects (bug.0335) indistinguishable in Loki.
 *
 * `response_keys` captures the top-level field names so we can tell a bare
 * `{}` from a `{error, code}` shape without dumping payload contents.
 */
export function classifyClobFailure(response: unknown): ClobFailureDetails {
  if (response == null || typeof response !== "object") {
    return {
      error_code: POLY_CLOB_ERROR_CODES.emptyResponse,
      response_keys: [],
      reason:
        response == null ? "null_response" : `non_object:${typeof response}`,
    };
  }
  const r = response as Record<string, unknown>;
  const response_keys = Object.keys(r);
  const errorText =
    (typeof r.errorMsg === "string" && r.errorMsg) ||
    (typeof r.error === "string" && r.error) ||
    (typeof r.message === "string" && r.message) ||
    "";
  if (response_keys.length === 0) {
    return {
      error_code: POLY_CLOB_ERROR_CODES.emptyResponse,
      response_keys,
    };
  }
  const error_code = errorText
    ? classifyRejectionMessage(errorText)
    : POLY_CLOB_ERROR_CODES.emptyResponse;
  const reason = errorText
    ? errorText.slice(0, 128)
    : `empty_error_fields:[${response_keys.join(",")}]`;
  return { error_code, response_keys, reason };
}

/**
 * Build a `ClobFailureDetails` from a thrown error (pre-`mapOrderResponseToReceipt`
 * — e.g. an axios error from `createAndPostOrder`). Looks for axios shape
 * (`err.response.{status,data}`) and falls back to message-classification.
 */
export function classifyClientError(err: unknown): ClobFailureDetails {
  const anyErr = err as {
    response?: { status?: unknown; data?: unknown };
    message?: unknown;
  } | null;
  const http_status =
    typeof anyErr?.response?.status === "number"
      ? anyErr.response.status
      : undefined;
  const message =
    typeof anyErr?.message === "string" ? anyErr.message : String(err);

  // HTTP status is the strongest signal when present — 401/403 = stale creds
  // regardless of what the body looks like.
  if (http_status === 401 || http_status === 403) {
    return {
      error_code: POLY_CLOB_ERROR_CODES.staleApiKey,
      response_keys: [],
      ...(http_status !== undefined ? { http_status } : {}),
      reason: message.slice(0, 128),
    };
  }

  // Body classification wins for other 4xx (e.g. 400 with "not enough balance").
  const data = anyErr?.response?.data;
  if (data && typeof data === "object" && Object.keys(data).length > 0) {
    const fromBody = classifyClobFailure(data);
    return {
      ...fromBody,
      ...(http_status !== undefined ? { http_status } : {}),
    };
  }

  const error_code = http_status
    ? POLY_CLOB_ERROR_CODES.httpError
    : classifyRejectionMessage(message);
  return {
    error_code,
    response_keys: [],
    ...(http_status !== undefined ? { http_status } : {}),
    reason: message.slice(0, 128),
  };
}

export function mapOrderResponseToReceipt(
  response: unknown,
  intent: OrderIntent
): OrderReceipt {
  const r = response as ClobOrderResponseLike;
  const placedOrderId = extractClobPlacedOrderId(response);
  // B2 — Polymarket returns `{success: false, errorMsg, orderID: "..."}` for
  // rejections (orderID can be populated even when the order was not accepted).
  // Treat an explicit `success === false` as a hard failure regardless of orderID.
  if (r.success === false || !placedOrderId) {
    const details = classifyClobFailure(response);
    throw new ClobRejectionError(
      `PolymarketClobAdapter.placeOrder: CLOB rejected order (error_code=${details.error_code}, response_keys=[${details.response_keys.join(",")}], reason="${details.reason ?? ""}")`,
      details
    );
  }

  const rawStatus = r.status ?? "pending";
  const status = normalizePolymarketStatus(rawStatus);

  // B6 — Polymarket CLOB OrderResponse returns makingAmount/takingAmount as
  // DECIMAL USDC strings (e.g. "4.98473"), not atomic 1e6 units. An earlier
  // revision divided by 1,000,000 and produced filled_size_usdc off by a
  // factor of ~1M (observed live on 2026-04-17 fill 0x61f7ae0d…b58a).
  // For BUY, makingAmount is USDC paid; for SELL, takingAmount is USDC received.
  const filledUsdcRaw = intent.side === "BUY" ? r.makingAmount : r.takingAmount;
  const filled_size_usdc = filledUsdcRaw ? Number(filledUsdcRaw) : 0;

  return {
    order_id: placedOrderId,
    client_order_id: intent.client_order_id,
    status,
    filled_size_usdc,
    submitted_at: new Date().toISOString(),
    attributes: {
      rawStatus,
      success: r.success,
      transactionsHashes: r.transactionsHashes ?? [],
    },
  };
}

interface ClobOpenOrderLike {
  id: string;
  status: string;
  side: string;
  original_size: string;
  size_matched: string;
  price: string;
  /** conditionId. Present on `getOpenOrders` rows, absent on `getOrder`. */
  market?: string;
  /** ERC-1155 asset id. Present on `getOpenOrders` rows. */
  asset_id?: string;
  /** Human outcome label. Present on `getOpenOrders` rows. */
  outcome?: string;
  /** Unix seconds. Present on `getOpenOrders` rows. */
  created_at?: number;
}

export function mapOpenOrderToReceipt(open: ClobOpenOrderLike): OrderReceipt {
  const status = normalizePolymarketStatus(open.status);
  // size_matched is in outcome shares; convert back to USDC notional.
  const priceNum = Number(open.price);
  const matchedShares = Number(open.size_matched);
  const filled_size_usdc = Number.isFinite(priceNum * matchedShares)
    ? priceNum * matchedShares
    : 0;

  const submitted_at =
    typeof open.created_at === "number" && open.created_at > 0
      ? new Date(open.created_at * 1000).toISOString()
      : new Date().toISOString();

  return {
    order_id: open.id,
    client_order_id: open.id, // no separate client_order_id on the platform receipt
    status,
    filled_size_usdc,
    submitted_at,
    attributes: {
      rawStatus: open.status,
      side: open.side,
      originalSize: open.original_size,
      sizeMatched: open.size_matched,
      price: open.price,
      ...(open.market ? { market: open.market } : {}),
      ...(open.asset_id ? { tokenId: open.asset_id } : {}),
      ...(open.outcome ? { outcome: open.outcome } : {}),
      ...(typeof open.created_at === "number"
        ? { createdAt: open.created_at }
        : {}),
    },
  };
}
