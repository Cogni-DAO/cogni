// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/operator/tools`
 * Purpose: Tool IDs for operator roles (CEO, Git Reviewer).
 * Scope: Exports tool capability metadata. Does NOT enforce policy.
 * Invariants:
 *   - SINGLE_SOURCE_OF_TRUTH: This is THE list of tools each operator role can use
 *   - CAPABILITY_NOT_POLICY: These are capabilities, not authorization
 * Side-effects: none
 * Links: agent-roles spec, TOOL_USE_SPEC.md
 * @public
 */

import { GET_CURRENT_TIME_NAME, METRICS_QUERY_NAME } from "@cogni/ai-tools";

/**
 * Tool IDs for CEO Operator.
 * Uses existing tools. Work item tools (query, transition) will be added
 * when implemented in @cogni/ai-tools.
 */
export const CEO_OPERATOR_TOOL_IDS = [
  GET_CURRENT_TIME_NAME,
  METRICS_QUERY_NAME,
] as const;

/**
 * Tool IDs for Git Reviewer.
 * Uses existing tools. GitHub PR tools (read, comment) will be added
 * when implemented in @cogni/ai-tools.
 */
export const GIT_REVIEWER_TOOL_IDS = [GET_CURRENT_TIME_NAME] as const;
