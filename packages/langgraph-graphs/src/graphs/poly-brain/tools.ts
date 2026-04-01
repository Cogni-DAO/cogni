// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/poly-brain/tools`
 * Purpose: Tool IDs for poly-brain graph (single source of truth).
 * Scope: Exports tool capability metadata. Does not enforce policy.
 * Invariants: SINGLE_SOURCE_OF_TRUTH, CAPABILITY_NOT_POLICY.
 * Side-effects: none
 * Links: work/items/task.0230.market-data-package.md
 * @public
 */

import { MARKET_LIST_NAME, WEB_SEARCH_NAME } from "@cogni/ai-tools";

/**
 * Tool IDs for poly-brain graph.
 * market_list: browse/search live prediction markets
 * web_search: research events that affect market prices
 */
export const POLY_BRAIN_TOOL_IDS = [MARKET_LIST_NAME, WEB_SEARCH_NAME] as const;

export type PolyBrainToolId = (typeof POLY_BRAIN_TOOL_IDS)[number];
