// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/adapters/polymarket/polymarket.adapter`
 * Purpose: Polymarket Gamma API adapter — public market listing, no auth required.
 * Scope: Implements MarketProviderPort for Polymarket. Config via constructor injection. Does not load env vars or manage lifecycle.
 * Invariants: ADAPTERS_NOT_IN_CORE, PACKAGES_NO_ENV.
 * Side-effects: IO (HTTP fetch to Polymarket Gamma API)
 * Links: work/items/task.0230.market-data-package.md
 * @public
 */

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
  type MarketConstraints,
  type MarketProviderConfig,
  type MarketProviderPort,
  OrderNotSupportedError,
} from "../../port/market-provider.port.js";
import { normalizePolymarketMarket } from "./polymarket.normalizer.js";
import { PolymarketMarketsResponseSchema } from "./polymarket.types.js";

const DEFAULT_GAMMA_BASE_URL = "https://gamma-api.polymarket.com";

export interface PolymarketAdapterConfig extends MarketProviderConfig {
  /** Gamma API base URL (default: https://gamma-api.polymarket.com) */
  baseUrl?: string;
}

/**
 * Polymarket adapter — implements MarketProviderPort using Gamma API.
 * Public reads, no auth required for market listing.
 * PACKAGES_NO_ENV: all config via constructor injection.
 */
export class PolymarketAdapter implements MarketProviderPort {
  readonly provider = "polymarket" as const;
  private readonly baseUrl: string;

  constructor(config?: PolymarketAdapterConfig) {
    this.baseUrl = config?.baseUrl ?? DEFAULT_GAMMA_BASE_URL;
  }

  async listMarkets(params?: ListMarketsParams): Promise<NormalizedMarket[]> {
    const url = new URL("/markets", this.baseUrl);
    url.searchParams.set("limit", String(params?.limit ?? 100));
    url.searchParams.set("active", String(params?.activeOnly ?? true));
    url.searchParams.set("closed", "false");

    if (params?.cursor) {
      url.searchParams.set("offset", params.cursor);
    }
    if (params?.category) {
      url.searchParams.set("tag", params.category);
    }
    if (params?.search) {
      url.searchParams.set("_q", params.search);
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(
        `Polymarket API error: ${response.status} ${response.statusText}`
      );
    }

    const json: unknown = await response.json();
    const raw = PolymarketMarketsResponseSchema.parse(json);

    return raw.map(normalizePolymarketMarket);
  }

  // Run-phase surface — wired to `@polymarket/clob-client` in Phase 1 CP3.
  // This baseline adapter (Gamma reads only, no signer, no CLOB creds) MUST
  // continue to throw: a read-only Polymarket instance must not accidentally
  // place orders because the port contract widened.

  placeOrder(_intent: OrderIntent): Promise<OrderReceipt> {
    return Promise.reject(
      new OrderNotSupportedError(
        "polymarket",
        "placeOrder",
        "PolymarketAdapter (Gamma read-only) does not support placeOrder. Use PolymarketClobAdapter with a viem LocalAccount + ApiKeyCreds."
      )
    );
  }

  cancelOrder(_orderId: string): Promise<void> {
    return Promise.reject(
      new OrderNotSupportedError(
        "polymarket",
        "cancelOrder",
        "PolymarketAdapter (Gamma read-only) does not support cancelOrder. Use PolymarketClobAdapter (CP3)."
      )
    );
  }

  getOrder(_orderId: string): Promise<GetOrderResult> {
    return Promise.reject(
      new OrderNotSupportedError(
        "polymarket",
        "getOrder",
        "PolymarketAdapter (Gamma read-only) does not support getOrder. Use PolymarketClobAdapter (CP3)."
      )
    );
  }

  getMarketConstraints(_tokenId: string): Promise<MarketConstraints> {
    return Promise.reject(
      new OrderNotSupportedError(
        "polymarket",
        "getMarketConstraints",
        "PolymarketAdapter (Gamma read-only) does not support getMarketConstraints. Use PolymarketClobAdapter."
      )
    );
  }
}
