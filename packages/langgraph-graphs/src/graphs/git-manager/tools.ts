// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/git-manager/tools`
 * Purpose: Tool ID constants for the Git Manager agent graph.
 * Scope: References tool IDs from @cogni/ai-tools. Does NOT import implementations.
 * Invariants: TOOL_CATALOG_IS_CANONICAL — IDs only, resolution at runtime.
 * Side-effects: none
 * Links: docs/guides/agent-development.md
 * @public
 */

import {
  REPO_LIST_NAME,
  REPO_OPEN_NAME,
  REPO_SEARCH_NAME,
  SCHEDULE_LIST_NAME,
  SCHEDULE_MANAGE_NAME,
  VCS_CREATE_BRANCH_NAME,
  VCS_GET_CI_STATUS_NAME,
  VCS_LIST_PRS_NAME,
  VCS_MERGE_PR_NAME,
  WORK_ITEM_QUERY_NAME,
  WORK_ITEM_TRANSITION_NAME,
} from "@cogni/ai-tools";

/**
 * Tool IDs available to the Git Manager agent.
 *
 * - VCS tools: GitHub App-authed PR/branch lifecycle
 * - Repo tools: search/open for playbook + context access
 * - Schedule tools: dispatch and manage other agent runs
 * - Work item tools: cross-reference PRs ↔ tasks, template work for dev agents
 *
 * Single source of truth — imported by server.ts, cogni-exec.ts, and catalog.ts.
 */
export const GIT_MANAGER_TOOL_IDS = [
  // Observation
  REPO_OPEN_NAME,
  REPO_SEARCH_NAME,
  REPO_LIST_NAME,
  VCS_LIST_PRS_NAME,
  VCS_GET_CI_STATUS_NAME,
  // Branch operations (integration branches only)
  VCS_CREATE_BRANCH_NAME,
  VCS_MERGE_PR_NAME,
  // Agent orchestration
  SCHEDULE_LIST_NAME,
  SCHEDULE_MANAGE_NAME,
  // Work item lifecycle
  WORK_ITEM_QUERY_NAME,
  WORK_ITEM_TRANSITION_NAME,
] as const;
