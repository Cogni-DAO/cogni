// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider`
 * Purpose: Prediction market provider capability — port, domain types, and pure normalizers.
 * Scope: Root barrel exports port interface, Zod schemas, and normalizers. Does not export adapter implementations (use subpath imports).
 * Invariants: PACKAGES_NO_ENV, PACKAGES_NO_LIFECYCLE, PACKAGES_NO_SRC_IMPORTS.
 * Side-effects: none
 * Links: work/items/task.0230.market-data-package.md, work/items/task.0315.poly-copy-trade-prototype.md
 * @public
 */

// Idempotency-key helper (task.0315 CP3.3) — pinned for executor + WS path.
export { clientOrderIdFor } from "./domain/client-order-id.js";
// Order domain (Run phase — added task.0315 Phase 1)
export {
  type Fill,
  FillSchema,
  type FillSource,
  FillSourceSchema,
  type GetOrderResult,
  type LimitPriceTickNormalization,
  normalizeLimitPriceToTick,
  type OrderIntent,
  OrderIntentSchema,
  type OrderReceipt,
  OrderReceiptSchema,
  type OrderSide,
  OrderSideSchema,
  type OrderStatus,
  OrderStatusSchema,
} from "./domain/order.js";
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
export {
  BELOW_MARKET_MIN_CODE,
  type MarketConstraints,
  type MarketCredentials,
  type MarketProviderConfig,
  type MarketProviderPort,
  OrderNotSupportedError,
} from "./port/market-provider.port.js";
// Observability ports — adapters accept these via constructor; no runtime deps.
export {
  createRecordingMetrics,
  type LoggerPort,
  type MetricsPort,
  noopLogger,
  noopMetrics,
  type RecordedCounter,
  type RecordedDuration,
  type RecordedMetric,
  type RecordingMetricsPort,
} from "./port/observability.port.js";
