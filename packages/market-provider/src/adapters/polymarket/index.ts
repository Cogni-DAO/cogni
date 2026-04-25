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
  type ClobFailureDetails,
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
  type PolyClobErrorCode,
  PolymarketClobAdapter,
  type PolymarketClobAdapterConfig,
} from "./polymarket.clob.adapter.js";
export {
  type ClobMarketResolutionConfig,
  type ClobPriceHistoryParams,
  type ClobPriceHistoryPoint,
  PolymarketClobPublicClient,
} from "./polymarket.clob-public.client.js";
export {
  BINARY_REDEEM_INDEX_SETS,
  normalizePolygonConditionId,
  PARENT_COLLECTION_ID_ZERO,
  POLYGON_CONDITIONAL_TOKENS,
  POLYGON_USDC_E,
  polymarketCtfRedeemAbi,
} from "./polymarket.ctf.js";
export {
  type ListTopTradersParams,
  type ListUserActivityParams,
  type ListUserPositionsParams,
  type ListUserTradesParams,
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
export {
  type GetUserPnlParams,
  PolymarketUserPnlClient,
  type PolymarketUserPnlClientConfig,
  type PolymarketUserPnlFidelity,
  PolymarketUserPnlFidelitySchema,
  type PolymarketUserPnlInterval,
  PolymarketUserPnlIntervalSchema,
  type PolymarketUserPnlPoint,
  PolymarketUserPnlPointSchema,
  PolymarketUserPnlResponseSchema,
} from "./polymarket.user-pnl.client.js";
