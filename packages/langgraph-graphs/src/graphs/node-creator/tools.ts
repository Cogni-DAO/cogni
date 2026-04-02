// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/node-creator/tools`
 * Purpose: Tool IDs for the Node Creator graph.
 * Scope: Display-only tools for rendering interactive cards + existing VCS/repo tools.
 * Invariants:
 *   - SINGLE_SOURCE_OF_TRUTH: THE list of tools the node-creator graph can use
 *   - CAPABILITY_NOT_POLICY: Capabilities, not authorization
 * Side-effects: none
 * Links: work/items/task.0260.node-creation-chat-orchestration.md
 * @public
 */

import {
  GET_CURRENT_TIME_NAME,
  PRESENT_NODE_SUMMARY_NAME,
  PRESENT_PR_NAME,
  PROPOSE_NODE_IDENTITY_NAME,
  REPO_LIST_NAME,
  REPO_OPEN_NAME,
  REPO_SEARCH_NAME,
  REQUEST_DAO_FORMATION_NAME,
  VCS_CREATE_BRANCH_NAME,
  VCS_LIST_PRS_NAME,
  WEB_SEARCH_NAME,
} from "@cogni/ai-tools";

/**
 * Tool IDs for Node Creator.
 *
 * Display-only tools (trigger UI rendering):
 * - propose_node_identity: renders IdentityProposalCard
 * - request_dao_formation: renders DAOFormationCard
 * - present_pr: renders PRReviewCard
 * - present_node_summary: renders NodeSummaryCard
 *
 * Existing tools (for research + context during intake):
 * - web_search: research the node's domain
 * - repo_list/open/search: understand codebase structure
 * - vcs_create_branch/list_prs: branch + PR operations
 * - get_current_time: timestamps
 */
export const NODE_CREATOR_TOOL_IDS = [
  // Display-only (task.0260)
  PROPOSE_NODE_IDENTITY_NAME,
  REQUEST_DAO_FORMATION_NAME,
  PRESENT_PR_NAME,
  PRESENT_NODE_SUMMARY_NAME,
  // Existing tools for research + operations
  WEB_SEARCH_NAME,
  REPO_LIST_NAME,
  REPO_OPEN_NAME,
  REPO_SEARCH_NAME,
  VCS_CREATE_BRANCH_NAME,
  VCS_LIST_PRS_NAME,
  GET_CURRENT_TIME_NAME,
] as const;
