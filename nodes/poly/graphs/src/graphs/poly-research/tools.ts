// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-graphs/graphs/poly-research/tools`
 * Purpose: Tool IDs for the poly-research graph (single source of truth — task.0386).
 * Scope: Exports the ID array consumed by the inproc runner to bind contracts+impls. Does not enforce policy, does not execute tools.
 * Invariants: SINGLE_SOURCE_OF_TRUTH.
 * Side-effects: none
 * Links: work/items/task.0386.poly-agent-wallet-research-v0.md
 * @public
 */

import {
  MARKET_LIST_NAME,
  POLY_DATA_ACTIVITY_NAME,
  POLY_DATA_HELP_NAME,
  POLY_DATA_HOLDERS_NAME,
  POLY_DATA_POSITIONS_NAME,
  POLY_DATA_RESOLVE_USERNAME_NAME,
  POLY_DATA_TRADES_MARKET_NAME,
  POLY_DATA_VALUE_NAME,
  WALLET_TOP_TRADERS_NAME,
  WEB_SEARCH_NAME,
} from "@cogni/ai-tools";

/**
 * Tool bundle for the poly-research graph.
 *
 * 7 `core__poly_data_*` tools for Data-API research + the global leaderboard
 * (`core__wallet_top_traders`) + market browsing (`core__market_list`) + event
 * context (`core__web_search`).
 */
export const POLY_RESEARCH_TOOL_IDS = [
  POLY_DATA_HELP_NAME,
  POLY_DATA_RESOLVE_USERNAME_NAME,
  POLY_DATA_HOLDERS_NAME,
  POLY_DATA_TRADES_MARKET_NAME,
  POLY_DATA_VALUE_NAME,
  POLY_DATA_POSITIONS_NAME,
  POLY_DATA_ACTIVITY_NAME,
  WALLET_TOP_TRADERS_NAME,
  MARKET_LIST_NAME,
  WEB_SEARCH_NAME,
] as const;

export type PolyResearchToolId = (typeof POLY_RESEARCH_TOOL_IDS)[number];
