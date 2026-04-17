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
} from "@polymarket/clob-client";

import type { OrderIntent, OrderReceipt } from "../../domain/order.js";
import type {
  ListMarketsParams,
  NormalizedMarket,
} from "../../domain/schemas.js";
import type { MarketProviderPort } from "../../port/market-provider.port.js";
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
} as const;

/**
 * Truncate an error message before logging — CLOB rejection bodies can include
 * long signature / domain dumps, and we don't want to blow up a log line.
 */
function truncErr(e: unknown, max = 512): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > max ? `${msg.slice(0, max)}…` : msg;
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
   */
  logger?: LoggerPort;
  /**
   * Metrics sink. Defaults to a no-op. Emits:
   *   - `poly_clob_place_total{result}` (counter; result ∈ ok|rejected|error)
   *   - `poly_clob_place_duration_ms{result}` (duration observation)
   *   - analogous pairs for `cancel` and `get_order`.
   * Dashboards reference the names in `POLY_CLOB_METRICS`.
   */
  metrics?: MetricsPort;
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

    try {
      // B1 — fetch per-market tickSize + negRisk + feeRateBps rather than hardcoding.
      // Polymarket has markets with 0.001 / 0.0001 tick sizes, neg-risk markets route
      // through a different Exchange contract, and live markets today reject
      // feeRateBps=0 with "fee rate for the market must be 1000". A stale hardcode
      // either rejects at the CLOB or produces a bad EIP-712 signature.
      const [tickSize, negRisk, feeRateBps] = await Promise.all([
        this.client.getTickSize(tokenId),
        this.client.getNegRisk(tokenId),
        this.client.getFeeRateBps(tokenId),
      ]);

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
      // B2 rejections throw from mapOrderResponseToReceipt — classify as "rejected"
      // when the error message carries the CLOB-rejection signature, otherwise "error".
      const msg = err instanceof Error ? err.message : String(err);
      const result = msg.includes("CLOB rejected order") ? "rejected" : "error";
      this.metrics.incr(POLY_CLOB_METRICS.placeTotal, { result });
      this.metrics.observeDurationMs(
        POLY_CLOB_METRICS.placeDurationMs,
        duration_ms,
        { result }
      );
      this.log.error(
        { ...baseFields, phase: result, duration_ms, error: truncErr(err) },
        `placeOrder: ${result}`
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

  async getOrder(orderId: string): Promise<OrderReceipt> {
    const start = Date.now();
    this.log.debug(
      { event: "poly.clob.get_order", phase: "start", order_id: orderId },
      "getOrder: start"
    );
    try {
      const open = await this.client.getOrder(orderId);
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
      return receipt;
    } catch (err) {
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
  status?: string;
  success?: boolean;
  errorMsg?: string;
  makingAmount?: string;
  takingAmount?: string;
  transactionsHashes?: string[];
}

export function mapOrderResponseToReceipt(
  response: unknown,
  intent: OrderIntent
): OrderReceipt {
  const r = response as ClobOrderResponseLike;
  // B2 — Polymarket returns `{success: false, errorMsg, orderID: "..."}` for
  // rejections (orderID can be populated even when the order was not accepted).
  // Treat an explicit `success === false` as a hard failure regardless of orderID.
  if (r.success === false || !r.orderID) {
    throw new Error(
      `PolymarketClobAdapter.placeOrder: CLOB rejected order (success=${String(r.success)}, orderID=${r.orderID ?? "<missing>"}, errorMsg="${r.errorMsg ?? ""}")`
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
    order_id: r.orderID,
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
}

export function mapOpenOrderToReceipt(open: ClobOpenOrderLike): OrderReceipt {
  const status = normalizePolymarketStatus(open.status);
  // size_matched is in outcome shares; convert back to USDC notional.
  const priceNum = Number(open.price);
  const matchedShares = Number(open.size_matched);
  const filled_size_usdc = Number.isFinite(priceNum * matchedShares)
    ? priceNum * matchedShares
    : 0;

  return {
    order_id: open.id,
    client_order_id: open.id, // no separate client_order_id on the platform receipt
    status,
    filled_size_usdc,
    submitted_at: new Date().toISOString(),
    attributes: {
      rawStatus: open.status,
      side: open.side,
      originalSize: open.original_size,
      sizeMatched: open.size_matched,
      price: open.price,
    },
  };
}
