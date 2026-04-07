// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/scorecard/tools`
 * Purpose: Tool IDs for scorecard graph (single source of truth).
 * Scope: Exports tool capability metadata. Does NOT enforce policy (that's ToolRunner's job).
 * Invariants:
 *   - SINGLE_SOURCE_OF_TRUTH: This is THE list of tools scorecard can use
 *   - CAPABILITY_NOT_POLICY: These are capabilities, not authorization
 * Side-effects: none
 * Links: docs/research/graph-builder-skill.md
 * @public
 */

import {
  KNOWLEDGE_READ_NAME,
  KNOWLEDGE_SEARCH_NAME,
  METRICS_QUERY_NAME,
  REPO_LIST_NAME,
  REPO_OPEN_NAME,
  REPO_SEARCH_NAME,
  WEB_SEARCH_NAME,
  WORK_ITEM_QUERY_NAME,
} from "@cogni/ai-tools";

/**
 * Tool IDs for scorecard graph.
 * Single source of truth - imported by cogni-exec.ts and catalog.ts.
 */
export const SCORECARD_TOOL_IDS = [
  KNOWLEDGE_SEARCH_NAME,
  KNOWLEDGE_READ_NAME,
  REPO_LIST_NAME,
  REPO_SEARCH_NAME,
  REPO_OPEN_NAME,
  WORK_ITEM_QUERY_NAME,
  METRICS_QUERY_NAME,
  WEB_SEARCH_NAME,
] as const;

/**
 * Type for scorecard tool IDs.
 */
export type ScorecardToolId = (typeof SCORECARD_TOOL_IDS)[number];
