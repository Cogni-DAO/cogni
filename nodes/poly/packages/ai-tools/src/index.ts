// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-ai-tools`
 * Purpose: Barrel export for poly-only tool definitions and contracts.
 * Scope: Re-exports all poly-owned tools and POLY_TOOL_BUNDLE for node composition.
 *        Does NOT import LangChain. Does NOT read env vars.
 * Invariants:
 *   - SINGLE_DOMAIN_HARD_FAIL: all content lives under nodes/poly/
 *   - PURE_LIBRARY: no env loading, no process lifecycle
 *   - TOOL_ID_STABILITY: IDs unchanged from packages/ai-tools (no rename in this phase)
 * Side-effects: none
 * Links: work/items/bug.0319.ai-tools-per-node-packages.md (Phase 2)
 * @public
 */

// Capabilities
export type {
  PolyDataActivityOutput,
  PolyDataActivityType,
  PolyDataCapability,
  PolyDataHoldersOutput,
  PolyDataMarketTradesOutput,
  PolyDataPositionsOutput,
  PolyDataResolveUsernameOutput,
  PolyDataUserPnlOutput,
  PolyDataValueOutput,
} from "./capabilities/poly-data";

// Tools
export {
  createMarketListImplementation,
  MARKET_LIST_NAME,
  type MarketCapability,
  type MarketItem,
  MarketItemSchema,
  type MarketListDeps,
  type MarketListInput,
  MarketListInputSchema,
  type MarketListOutput,
  MarketListOutputSchema,
  type MarketListRedacted,
  marketListBoundTool,
  marketListContract,
  marketListStubImplementation,
} from "./tools/market-list";
export {
  createPolyCancelOrderImplementation,
  POLY_CANCEL_ORDER_NAME,
  type PolyCancelOrderDeps,
  type PolyCancelOrderInput,
  PolyCancelOrderInputSchema,
  type PolyCancelOrderOutput,
  PolyCancelOrderOutputSchema,
  type PolyCancelOrderRedacted,
  polyCancelOrderBoundTool,
  polyCancelOrderContract,
  polyCancelOrderStubImplementation,
} from "./tools/poly-cancel-order";
export {
  createPolyDataActivityImplementation,
  POLY_DATA_ACTIVITY_NAME,
  type PolyDataActivityDeps,
  type PolyDataActivityInput,
  PolyDataActivityInputSchema,
  PolyDataActivityOutputSchema,
  type PolyDataActivityRedacted,
  PolyDataActivityTypeSchema,
  polyDataActivityBoundTool,
  polyDataActivityContract,
  polyDataActivityStubImplementation,
} from "./tools/poly-data-activity";
export {
  POLY_DATA_HELP_NAME,
  type PolyDataHelpInput,
  PolyDataHelpInputSchema,
  type PolyDataHelpOutput,
  PolyDataHelpOutputSchema,
  type PolyDataHelpRedacted,
  polyDataHelpBoundTool,
  polyDataHelpContract,
  polyDataHelpImplementation,
} from "./tools/poly-data-help";
export {
  createPolyDataHoldersImplementation,
  POLY_DATA_HOLDERS_NAME,
  type PolyDataHoldersDeps,
  type PolyDataHoldersInput,
  PolyDataHoldersInputSchema,
  PolyDataHoldersOutputSchema,
  type PolyDataHoldersRedacted,
  polyDataHoldersBoundTool,
  polyDataHoldersContract,
  polyDataHoldersStubImplementation,
} from "./tools/poly-data-holders";
export {
  createPolyDataPositionsImplementation,
  POLY_DATA_POSITIONS_NAME,
  type PolyDataPositionsDeps,
  type PolyDataPositionsInput,
  PolyDataPositionsInputSchema,
  PolyDataPositionsOutputSchema,
  type PolyDataPositionsRedacted,
  polyDataPositionsBoundTool,
  polyDataPositionsContract,
  polyDataPositionsStubImplementation,
} from "./tools/poly-data-positions";
export {
  createPolyDataResolveUsernameImplementation,
  POLY_DATA_RESOLVE_USERNAME_NAME,
  type PolyDataResolveUsernameDeps,
  type PolyDataResolveUsernameInput,
  PolyDataResolveUsernameInputSchema,
  PolyDataResolveUsernameOutputSchema,
  type PolyDataResolveUsernameRedacted,
  polyDataResolveUsernameBoundTool,
  polyDataResolveUsernameContract,
  polyDataResolveUsernameStubImplementation,
} from "./tools/poly-data-resolve-username";
export {
  createPolyDataTradesMarketImplementation,
  POLY_DATA_TRADES_MARKET_NAME,
  type PolyDataTradesMarketDeps,
  type PolyDataTradesMarketInput,
  PolyDataTradesMarketInputSchema,
  PolyDataTradesMarketOutputSchema,
  type PolyDataTradesMarketRedacted,
  polyDataTradesMarketBoundTool,
  polyDataTradesMarketContract,
  polyDataTradesMarketStubImplementation,
} from "./tools/poly-data-trades-market";
export {
  createPolyDataUserPnlSummaryImplementation,
  POLY_DATA_USER_PNL_SUMMARY_NAME,
  type PolyDataUserPnlSummaryDeps,
  type PolyDataUserPnlSummaryInput,
  PolyDataUserPnlSummaryInputSchema,
  type PolyDataUserPnlSummaryOutput,
  PolyDataUserPnlSummaryOutputSchema,
  type PolyDataUserPnlSummaryRedacted,
  polyDataUserPnlSummaryBoundTool,
  polyDataUserPnlSummaryContract,
  polyDataUserPnlSummaryStubImplementation,
} from "./tools/poly-data-user-pnl-summary";
export {
  createPolyDataValueImplementation,
  POLY_DATA_VALUE_NAME,
  type PolyDataValueDeps,
  type PolyDataValueInput,
  PolyDataValueInputSchema,
  PolyDataValueOutputSchema,
  type PolyDataValueRedacted,
  polyDataValueBoundTool,
  polyDataValueContract,
  polyDataValueStubImplementation,
} from "./tools/poly-data-value";
export {
  createPolyListOrdersImplementation,
  POLY_LIST_ORDERS_NAME,
  type PolyListOrdersDeps,
  type PolyListOrdersInput,
  PolyListOrdersInputSchema,
  type PolyListOrdersOutput,
  PolyListOrdersOutputSchema,
  type PolyListOrdersRedacted,
  polyListOrdersBoundTool,
  polyListOrdersContract,
  polyListOrdersStubImplementation,
} from "./tools/poly-list-orders";
export {
  createPolyPlaceTradeImplementation,
  POLY_PLACE_TRADE_NAME,
  type PolyClosePositionRequest,
  type PolyListOpenOrdersRequest,
  type PolyOpenOrder,
  type PolyPlaceTradeDeps,
  type PolyPlaceTradeInput,
  PolyPlaceTradeInputSchema,
  type PolyPlaceTradeOutput,
  PolyPlaceTradeOutputSchema,
  type PolyPlaceTradeReceipt,
  type PolyPlaceTradeRedacted,
  type PolyPlaceTradeRequest,
  type PolyTradeCapability,
  polyPlaceTradeBoundTool,
  polyPlaceTradeContract,
  polyPlaceTradeStubImplementation,
} from "./tools/poly-place-trade";
export {
  createWalletTopTradersImplementation,
  WALLET_TOP_TRADERS_NAME,
  type WalletCapability,
  type WalletOrderBy,
  WalletOrderBySchema,
  type WalletTimePeriod,
  WalletTimePeriodSchema,
  type WalletTopTraderItem,
  WalletTopTraderItemSchema,
  type WalletTopTradersDeps,
  type WalletTopTradersInput,
  WalletTopTradersInputSchema,
  type WalletTopTradersOutput,
  WalletTopTradersOutputSchema,
  type WalletTopTradersRedacted,
  walletTopTradersBoundTool,
  walletTopTradersContract,
  walletTopTradersStubImplementation,
} from "./tools/wallet-top-traders";

// ─────────────────────────────────────────────────────────────────────────────
// POLY_TOOL_BUNDLE
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogBoundTool } from "@cogni/ai-tools";
import { marketListBoundTool } from "./tools/market-list";
import { polyDataActivityBoundTool } from "./tools/poly-data-activity";
import { polyDataHelpBoundTool } from "./tools/poly-data-help";
import { polyDataHoldersBoundTool } from "./tools/poly-data-holders";
import { polyDataPositionsBoundTool } from "./tools/poly-data-positions";
import { polyDataResolveUsernameBoundTool } from "./tools/poly-data-resolve-username";
import { polyDataTradesMarketBoundTool } from "./tools/poly-data-trades-market";
import { polyDataUserPnlSummaryBoundTool } from "./tools/poly-data-user-pnl-summary";
import { polyDataValueBoundTool } from "./tools/poly-data-value";
import { walletTopTradersBoundTool } from "./tools/wallet-top-traders";

/**
 * Poly-only tool bundle. Imported by nodes/poly/app composition.
 *
 * Non-poly nodes (operator, resy, node-template) use CORE_TOOL_BUNDLE only
 * from @cogni/ai-tools. This bundle is the second half of poly's composition:
 *   createBoundToolSource([...CORE_TOOL_BUNDLE, ...POLY_TOOL_BUNDLE], toolBindings)
 *
 * Tools NOT in the bundle but still exported by the package (contracts kept
 * for future re-wire — agent surface is closed today):
 *   - polyPlaceTradeBoundTool / polyListOrdersBoundTool / polyCancelOrderBoundTool —
 *     pending per-tenant routing through PolyTradeExecutor with actor identity at
 *     tool-invocation time (see bug.0319 ckpt 3).
 */
export const POLY_TOOL_BUNDLE: readonly CatalogBoundTool[] = [
  marketListBoundTool as CatalogBoundTool,
  polyDataActivityBoundTool as CatalogBoundTool,
  polyDataHelpBoundTool as CatalogBoundTool,
  polyDataHoldersBoundTool as CatalogBoundTool,
  polyDataPositionsBoundTool as CatalogBoundTool,
  polyDataResolveUsernameBoundTool as CatalogBoundTool,
  polyDataTradesMarketBoundTool as CatalogBoundTool,
  polyDataUserPnlSummaryBoundTool as CatalogBoundTool,
  polyDataValueBoundTool as CatalogBoundTool,
  walletTopTradersBoundTool as CatalogBoundTool,
];
