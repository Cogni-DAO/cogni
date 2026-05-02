// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider/adapters/polymarket`
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
  installClobSdkDiagnosticSuppression,
  mapOpenOrderToReceipt,
  mapOrderResponseToReceipt,
  normalizePolymarketStatus,
  POLY_CLOB_ERROR_CODES,
  POLY_CLOB_METRICS,
  type PolyClobErrorCode,
  PolymarketClobAdapter,
  type PolymarketClobAdapterConfig,
  sanitizeClobDiagnosticText,
  withSanitizedClobSdkConsoleErrors,
  withSuppressedClobSdkDiagnostics,
} from "./polymarket.clob.adapter.js";
export {
  type ClobMarketResolutionConfig,
  type ClobPriceHistoryParams,
  type ClobPriceHistoryPoint,
  PolymarketClobPublicClient,
} from "./polymarket.clob-public.client.js";
export {
  normalizePolygonConditionId,
  PARENT_COLLECTION_ID_ZERO,
  POLYGON_CONDITIONAL_TOKENS,
  POLYGON_PUSD,
  POLYGON_USDC_E,
  polymarketCtfEventsAbi,
  polymarketCtfPositionIdAbi,
  polymarketCtfRedeemAbi,
} from "./polymarket.ctf.js";
export {
  type GetHoldersParams,
  type GetValueParams,
  type ListActivityParams,
  type ListMarketTradesParams,
  type ListTopTradersParams,
  type ListUserActivityParams,
  type ListUserPositionsParams,
  type ListUserTradesParams,
  PolyDataApiValidationError,
  PolymarketDataApiClient,
  type PolymarketDataApiClientConfig,
  type ResolveUsernameParams,
} from "./polymarket.data-api.client.js";
export {
  type ActivityEvent,
  ActivityEventSchema,
  ActivityEventsResponseSchema,
  type ActivityEventType,
  ActivityEventTypeSchema,
  type GammaProfile,
  GammaProfileSchema,
  GammaPublicSearchResponseSchema,
  type MarketHolder,
  MarketHolderSchema,
  MarketHoldersResponseSchema,
  type MarketTrade,
  MarketTradeSchema,
  MarketTradesResponseSchema,
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
  UserValueEntrySchema,
  UserValueResponseSchema,
} from "./polymarket.data-api.types.js";
export {
  POLYGON_NEG_RISK_ADAPTER,
  polymarketNegRiskAdapterAbi,
} from "./polymarket.neg-risk-adapter.js";
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
