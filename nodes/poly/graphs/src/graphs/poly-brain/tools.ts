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

import { WEB_SEARCH_NAME } from "@cogni/ai-tools";
import {
  MARKET_LIST_NAME,
  WALLET_TOP_TRADERS_NAME,
} from "@cogni/poly-ai-tools";

/**
 * Tool IDs for poly-brain graph.
 * market_list: browse/search live prediction markets
 * wallet_top_traders: scoreboard of top Polymarket wallets by PnL (day/week/month/all)
 * web_search: research events that affect market prices
 *
 * NOTE: poly_place_trade / poly_list_orders / poly_cancel_order were removed
 * post-Ckpt-3 (bug.0319) — their contracts still live in @cogni/poly-ai-tools
 * but they are absent from POLY_TOOL_BUNDLE pending per-tenant routing through
 * PolyTradeExecutor with actor identity at tool-invocation time. Re-add to
 * POLY_BRAIN_TOOL_IDS only after the trade tools are bound again.
 */
export const POLY_BRAIN_TOOL_IDS = [
  MARKET_LIST_NAME,
  WALLET_TOP_TRADERS_NAME,
  WEB_SEARCH_NAME,
] as const;

export type PolyBrainToolId = (typeof POLY_BRAIN_TOOL_IDS)[number];
