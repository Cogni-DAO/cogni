// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/adapters/polymarket`
 * Purpose: Barrel export for the Polymarket adapter, config type, and raw market schema.
 * Scope: Re-exports only. Does not contain runtime logic.
 * Invariants: PACKAGES_NO_ENV.
 * Side-effects: none
 * Links: work/items/task.0230.market-data-package.md
 * @public
 */

export {
  PolymarketAdapter,
  type PolymarketAdapterConfig,
} from "./polymarket.adapter.js";
export {
  mapOpenOrderToReceipt,
  mapOrderResponseToReceipt,
  normalizePolymarketStatus,
  POLY_CLOB_METRICS,
  PolymarketClobAdapter,
  type PolymarketClobAdapterConfig,
} from "./polymarket.clob.adapter.js";
export {
  type ListTopTradersParams,
  type ListUserActivityParams,
  PolymarketDataApiClient,
  type PolymarketDataApiClientConfig,
} from "./polymarket.data-api.client.js";
export {
  type PolymarketLeaderboardEntry,
  PolymarketLeaderboardEntrySchema,
  type PolymarketLeaderboardOrderBy,
  PolymarketLeaderboardOrderBySchema,
  PolymarketLeaderboardResponseSchema,
  type PolymarketLeaderboardTimePeriod,
  PolymarketLeaderboardTimePeriodSchema,
  type PolymarketUserPosition,
  PolymarketUserPositionSchema,
  PolymarketUserPositionsResponseSchema,
  type PolymarketUserTrade,
  PolymarketUserTradeSchema,
  PolymarketUserTradesResponseSchema,
} from "./polymarket.data-api.types.js";
export {
  normalizePolymarketDataApiFill,
  type PolymarketNormalizeResult,
  type PolymarketNormalizeSkipReason,
  polymarketDataApiFillId,
} from "./polymarket.normalize-fill.js";
export { normalizePolymarketMarket } from "./polymarket.normalizer.js";
export {
  type PolymarketRawMarket,
  PolymarketRawMarketSchema,
} from "./polymarket.types.js";
