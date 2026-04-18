// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-graphs/graphs/poly-brain/tools`
 * Purpose: Tool IDs for poly-brain graph (single source of truth).
 * Scope: Exports tool capability metadata. Does not enforce policy.
 * Invariants: SINGLE_SOURCE_OF_TRUTH, CAPABILITY_NOT_POLICY.
 * Side-effects: none
 * Links: work/items/task.0230.market-data-package.md
 * @public
 */

import {
  MARKET_LIST_NAME,
  POLY_CANCEL_ORDER_NAME,
  POLY_LIST_ORDERS_NAME,
  POLY_PLACE_TRADE_NAME,
  WALLET_TOP_TRADERS_NAME,
  WEB_SEARCH_NAME,
} from "@cogni/ai-tools";

/**
 * Tool IDs for poly-brain graph.
 * market_list: browse/search live prediction markets
 * wallet_top_traders: scoreboard of top Polymarket wallets by PnL (day/week/month/all)
 * poly_place_trade: place ONE BUY on Polymarket via the Cogni operator wallet
 *   (external_side_effect — real money; LLM should invoke only on explicit user request)
 * poly_list_orders: list currently-open Polymarket CLOB orders on the operator wallet
 *   (read_only — used to confirm state after placement)
 * poly_cancel_order: cancel ONE open Polymarket CLOB order by id
 *   (state_change — required before replacing a resting order, since Polymarket has no update op)
 * web_search: research events that affect market prices
 */
export const POLY_BRAIN_TOOL_IDS = [
  MARKET_LIST_NAME,
  POLY_CANCEL_ORDER_NAME,
  POLY_LIST_ORDERS_NAME,
  POLY_PLACE_TRADE_NAME,
  WALLET_TOP_TRADERS_NAME,
  WEB_SEARCH_NAME,
] as const;

export type PolyBrainToolId = (typeof POLY_BRAIN_TOOL_IDS)[number];
