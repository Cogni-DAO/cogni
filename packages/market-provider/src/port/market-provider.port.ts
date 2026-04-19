// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/port`
 * Purpose: MarketProviderPort interface — typed capability for prediction market platforms.
 * Scope: Port interface, credential types, and Run-phase error type. Does not contain implementations or I/O.
 * Invariants:
 *   - ADAPTERS_NOT_IN_CORE, CONNECTION_ID_ONLY, PACKAGES_NO_ENV.
 *   - PORT_IS_EXISTING (task.0315): Run-phase methods extend THIS port; no new port package.
 *   - IDEMPOTENT_BY_CLIENT_ID: `placeOrder` dedupes server-side on `intent.client_order_id`.
 * Side-effects: none
 * Links: work/items/task.0230.market-data-package.md, work/items/task.0315.poly-copy-trade-prototype.md
 * @public
 */

import type {
  GetOrderResult,
  OrderIntent,
  OrderReceipt,
} from "../domain/order.js";
import type {
  ListMarketsParams,
  MarketProvider,
  NormalizedMarket,
} from "../domain/schemas.js";

/**
 * Credentials abstraction — resolved from connections table or env shim.
 * Intentionally opaque: adapters interpret per-provider.
 * CONNECTION_ID_ONLY: callers never see raw tokens in the port interface.
 *
 * Polymarket CLOB order signing does NOT flow through here — the Run-phase
 * adapter takes a viem `LocalAccount` (from `@privy-io/node/viem#createViemAccount`)
 * via constructor injection. No raw key material on the port surface.
 */
export interface MarketCredentials {
  /** For API key auth (Kalshi) */
  readonly apiKey?: string;
  /** For RSA signing auth (Kalshi) — PEM-encoded RSA private key */
  readonly apiSecret?: string;
}

/** Config injected at construction — no env loading in adapters (PACKAGES_NO_ENV) */
export interface MarketProviderConfig {
  /** System-level credentials for reads */
  credentials?: MarketCredentials;
  /** Override base URL for testing */
  baseUrl?: string;
}

/**
 * Thrown by read-only adapters when a Run-phase method is invoked. Preserves the
 * full port surface at compile time without silently allowing misuse at runtime.
 * Adapters that intentionally do not support order placement (Kalshi, paper stub
 * before Phase 3) throw this from `placeOrder` / `cancelOrder` / `getOrder`.
 */
export class OrderNotSupportedError extends Error {
  readonly provider: MarketProvider;
  readonly operation: "placeOrder" | "cancelOrder" | "getOrder";

  constructor(
    provider: MarketProvider,
    operation: "placeOrder" | "cancelOrder" | "getOrder",
    reason?: string
  ) {
    super(
      reason ??
        `${provider} adapter does not support ${operation} (read-only or not-yet-implemented)`
    );
    this.name = "OrderNotSupportedError";
    this.provider = provider;
    this.operation = operation;
  }
}

/**
 * Market provider port — covers the full provider lifecycle.
 * Crawl: listMarkets().
 * Run: placeOrder(), cancelOrder(), getOrder() — added Phase 1 for copy-trade.
 *
 * Adapters that do not support Run phase (e.g., Kalshi read-only, paper stub
 * before Phase 3) MUST throw `OrderNotSupportedError` from Run methods rather
 * than returning a sentinel — callers rely on the exception surface.
 */
export interface MarketProviderPort {
  readonly provider: MarketProvider;

  /**
   * List active markets from this provider.
   * Uses constructor-injected system credentials by default.
   */
  listMarkets(params?: ListMarketsParams): Promise<NormalizedMarket[]>;

  /**
   * Submit an order. Platform dedupes server-side on `intent.client_order_id`
   * (IDEMPOTENT_BY_CLIENT_ID): a repeat submission of the same id returns the
   * existing order's receipt rather than placing a second order.
   *
   * @throws OrderNotSupportedError if the adapter is read-only (e.g., Kalshi).
   */
  placeOrder(intent: OrderIntent): Promise<OrderReceipt>;

  /**
   * Cancel an open order by platform `order_id`. Idempotent — cancelling an
   * already-cancelled or already-filled order is not an error.
   *
   * @throws OrderNotSupportedError if the adapter is read-only.
   */
  cancelOrder(orderId: string): Promise<void>;

  /**
   * Look up an order's current status by platform `order_id`.
   *
   * Returns `{ found: receipt }` when the order exists, or `{ status: "not_found" }`
   * when the CLOB returns a 404 / empty body. Network errors still throw.
   * GETORDER_NEVER_NULL invariant (task.0328 CP1): null is never returned.
   *
   * @throws OrderNotSupportedError if the adapter is read-only.
   */
  getOrder(orderId: string): Promise<GetOrderResult>;
}
