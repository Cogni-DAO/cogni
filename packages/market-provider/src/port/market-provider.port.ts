// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/port`
 * Purpose: MarketProviderPort interface — typed capability for prediction market platforms.
 * Scope: Port interface and credential types only. Does not contain implementations or I/O.
 * Invariants: ADAPTERS_NOT_IN_CORE, CONNECTION_ID_ONLY, PACKAGES_NO_ENV.
 * Side-effects: none
 * Links: work/items/task.0230.market-data-package.md
 * @public
 */

import type {
  ListMarketsParams,
  MarketProvider,
  NormalizedMarket,
} from "../domain/schemas.js";

/**
 * Credentials abstraction — resolved from connections table or env shim.
 * Intentionally opaque: adapters interpret per-provider.
 * CONNECTION_ID_ONLY: callers never see raw tokens in the port interface.
 */
export interface MarketCredentials {
  /** For API key auth (Kalshi) */
  readonly apiKey?: string;
  /** For RSA signing auth (Kalshi) — PEM-encoded RSA private key */
  readonly apiSecret?: string;
  /** For wallet signing auth (Polymarket trading — Run phase) */
  readonly walletKey?: string;
}

/** Config injected at construction — no env loading in adapters (PACKAGES_NO_ENV) */
export interface MarketProviderConfig {
  /** System-level credentials for reads */
  credentials?: MarketCredentials;
  /** Override base URL for testing */
  baseUrl?: string;
}

/**
 * Market provider port — covers the full provider lifecycle.
 * Crawl: listMarkets() only.
 * Walk: getPrices(), getOrderbook() added when pipeline needs them.
 * Run: placeOrder(), getPositions() added when trading starts.
 */
export interface MarketProviderPort {
  readonly provider: MarketProvider;

  /**
   * List active markets from this provider.
   * Uses constructor-injected system credentials by default.
   */
  listMarkets(params?: ListMarketsParams): Promise<NormalizedMarket[]>;
}
