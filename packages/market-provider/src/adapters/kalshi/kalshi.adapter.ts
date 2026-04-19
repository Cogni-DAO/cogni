// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/adapters/kalshi/kalshi.adapter`
 * Purpose: Kalshi Trading API adapter — RSA-PSS signed auth, market listing via GET /markets.
 * Scope: Implements MarketProviderPort for Kalshi. Config via constructor injection. Does not call POST/PUT endpoints or load env vars.
 * Invariants: ADAPTERS_NOT_IN_CORE, PACKAGES_NO_ENV, CONNECTION_ID_ONLY.
 * Side-effects: IO (HTTP fetch to Kalshi Trading API)
 * Links: work/items/task.0230.market-data-package.md
 * @public
 */

import { constants, createSign } from "node:crypto";
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
  type MarketCredentials,
  type MarketProviderConfig,
  type MarketProviderPort,
  OrderNotSupportedError,
} from "../../port/market-provider.port.js";
import { normalizeKalshiMarket } from "./kalshi.normalizer.js";
import { KalshiMarketsResponseSchema } from "./kalshi.types.js";

const DEFAULT_KALSHI_BASE_URL = "https://api.elections.kalshi.com/trade-api/v2";

export interface KalshiAdapterConfig extends MarketProviderConfig {
  /** Trading API base URL (default: https://api.elections.kalshi.com/trade-api/v2) */
  baseUrl?: string;
  /** Required — Kalshi requires auth for all endpoints */
  credentials: MarketCredentials;
}

/**
 * Sign a Kalshi API request using RSA-PSS with SHA-256.
 * Message format: "{timestamp_ms}{METHOD}{path}"
 * Returns base64-encoded signature.
 */
function signRequest(
  rsaPrivateKeyPem: string,
  timestampMs: string,
  method: string,
  path: string
): string {
  const message = `${timestampMs}${method}${path}`;
  const signer = createSign("RSA-SHA256");
  signer.update(message);
  return signer.sign(
    {
      key: rsaPrivateKeyPem,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32, // SHA-256 digest length
    },
    "base64"
  );
}

/**
 * Kalshi adapter — implements MarketProviderPort using Trading API.
 * All endpoints require RSA-PSS signed auth.
 * PACKAGES_NO_ENV: credentials via constructor injection.
 * READ-ONLY: this adapter NEVER calls POST/PUT endpoints.
 */
export class KalshiAdapter implements MarketProviderPort {
  readonly provider = "kalshi" as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(config: KalshiAdapterConfig) {
    if (!config.credentials.apiKey || !config.credentials.apiSecret) {
      throw new Error(
        "KalshiAdapter requires credentials.apiKey and credentials.apiSecret (RSA PEM)"
      );
    }
    this.baseUrl = config.baseUrl ?? DEFAULT_KALSHI_BASE_URL;
    this.apiKey = config.credentials.apiKey;
    this.apiSecret = config.credentials.apiSecret;
  }

  private buildAuthHeaders(
    method: string,
    path: string
  ): Record<string, string> {
    const timestampMs = Date.now().toString();
    const signature = signRequest(this.apiSecret, timestampMs, method, path);
    return {
      "KALSHI-ACCESS-KEY": this.apiKey,
      "KALSHI-ACCESS-TIMESTAMP": timestampMs,
      "KALSHI-ACCESS-SIGNATURE": signature,
    };
  }

  async listMarkets(params?: ListMarketsParams): Promise<NormalizedMarket[]> {
    const url = new URL(`${this.baseUrl}/markets`);
    url.searchParams.set("limit", String(params?.limit ?? 100));

    // Kalshi API returns active markets by default (no status filter param)
    if (params?.cursor) {
      url.searchParams.set("cursor", params.cursor);
    }
    if (params?.category) {
      url.searchParams.set("category", params.category);
    }

    // Auth headers sign the full path WITHOUT query params
    const authHeaders = this.buildAuthHeaders("GET", url.pathname);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        ...authHeaders,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Kalshi API error: ${response.status} ${response.statusText}`
      );
    }

    const json: unknown = await response.json();
    const parsed = KalshiMarketsResponseSchema.parse(json);

    return parsed.markets.map(normalizeKalshiMarket);
  }

  // Kalshi adapter is READ-ONLY by design (AGENTS.md): the Kalshi API key may
  // hold real money and this package MUST NEVER call POST/PUT endpoints. The
  // Run-phase methods are present solely to satisfy the widened port contract
  // and always throw.

  placeOrder(_intent: OrderIntent): Promise<OrderReceipt> {
    return Promise.reject(
      new OrderNotSupportedError(
        "kalshi",
        "placeOrder",
        "KalshiAdapter is read-only by design — no order placement."
      )
    );
  }

  cancelOrder(_orderId: string): Promise<void> {
    return Promise.reject(
      new OrderNotSupportedError(
        "kalshi",
        "cancelOrder",
        "KalshiAdapter is read-only by design."
      )
    );
  }

  getOrder(_orderId: string): Promise<GetOrderResult> {
    return Promise.reject(
      new OrderNotSupportedError(
        "kalshi",
        "getOrder",
        "KalshiAdapter is read-only by design."
      )
    );
  }
}
