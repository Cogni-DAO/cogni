// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/adapters/kalshi`
 * Purpose: Barrel export for the Kalshi adapter, config type, and raw market schema.
 * Scope: Re-exports only. Does not contain runtime logic.
 * Invariants: PACKAGES_NO_ENV.
 * Side-effects: none
 * Links: work/items/task.0230.market-data-package.md
 * @public
 */

export {
  KalshiAdapter,
  type KalshiAdapterConfig,
} from "./kalshi.adapter.js";
export { normalizeKalshiMarket } from "./kalshi.normalizer.js";
export {
  type KalshiRawMarket,
  KalshiRawMarketSchema,
} from "./kalshi.types.js";
