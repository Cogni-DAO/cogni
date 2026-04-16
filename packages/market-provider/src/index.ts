// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider`
 * Purpose: Prediction market provider capability — port, domain types, and pure normalizers.
 * Scope: Root barrel exports port interface, Zod schemas, and normalizers. Does not export adapter implementations (use subpath imports).
 * Invariants: PACKAGES_NO_ENV, PACKAGES_NO_LIFECYCLE, PACKAGES_NO_SRC_IMPORTS.
 * Side-effects: none
 * Links: work/items/task.0230.market-data-package.md
 * @public
 */

// Domain types
export {
  type ListMarketsParams,
  ListMarketsParamsSchema,
  type MarketOutcome,
  MarketOutcomeSchema,
  type MarketProvider,
  MarketProviderSchema,
  type NormalizedMarket,
  NormalizedMarketSchema,
} from "./domain/schemas.js";
// Port interface
export type {
  MarketCredentials,
  MarketProviderConfig,
  MarketProviderPort,
} from "./port/market-provider.port.js";
