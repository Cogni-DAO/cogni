// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/catalog`
 * Purpose: Canonical registry of all tool definitions. Single source of truth.
 * Scope: Exports TOOL_CATALOG and createToolCatalog helper. Does NOT import @langchain.
 * Invariants:
 *   - TOOL_CATALOG_IS_CANONICAL: Single source of truth for core__ tools
 *   - TOOL_ID_STABILITY: Duplicate IDs throw at construction time
 *   - TOOL_ID_NAMESPACED: IDs use core__<name> format
 * Side-effects: none
 * Links: TOOL_USE_SPEC.md, LANGGRAPH_AI.md
 * @public
 */

import { getCurrentTimeBoundTool } from "./tools/get-current-time";
import { knowledgeReadBoundTool } from "./tools/knowledge-read";
import { knowledgeSearchBoundTool } from "./tools/knowledge-search";
import { knowledgeWriteBoundTool } from "./tools/knowledge-write";
import { marketListBoundTool } from "./tools/market-list";
import { metricsQueryBoundTool } from "./tools/metrics-query";
import { repoListBoundTool } from "./tools/repo-list";
import { repoOpenBoundTool } from "./tools/repo-open";
import { repoSearchBoundTool } from "./tools/repo-search";
import { scheduleListBoundTool } from "./tools/schedule-list";
import { scheduleManageBoundTool } from "./tools/schedule-manage";
import { vcsCreateBranchBoundTool } from "./tools/vcs-create-branch";
import { vcsGetCiStatusBoundTool } from "./tools/vcs-get-ci-status";
import { vcsListPrsBoundTool } from "./tools/vcs-list-prs";
import { vcsMergePrBoundTool } from "./tools/vcs-merge-pr";
import { webSearchBoundTool } from "./tools/web-search";
import { workItemQueryBoundTool } from "./tools/work-item-query";
import { workItemTransitionBoundTool } from "./tools/work-item-transition";
import type { BoundTool } from "./types";

/**
 * Generic bound tool type for catalog entries.
 * Uses widened types to allow any conforming BoundTool.
 */
export type CatalogBoundTool = BoundTool<
  string,
  unknown,
  unknown,
  Record<string, unknown>
>;

/**
 * Tool catalog type.
 * Maps tool ID → BoundTool.
 */
export type ToolCatalog = Readonly<Record<string, CatalogBoundTool>>;

/**
 * Create a tool catalog from an array of bound tools.
 * Validates uniqueness of tool IDs at construction time.
 *
 * @param tools - Array of bound tools to register
 * @returns Frozen tool catalog
 * @throws Error if duplicate tool IDs are detected
 *
 * @example
 * ```typescript
 * const catalog = createToolCatalog([
 *   getCurrentTimeBoundTool,
 *   webSearchBoundTool,
 * ]);
 * ```
 */
export function createToolCatalog(
  tools: readonly CatalogBoundTool[]
): ToolCatalog {
  const catalog: Record<string, CatalogBoundTool> = {};

  for (const tool of tools) {
    const toolId = tool.contract.name;

    // TOOL_ID_STABILITY: Throw on duplicate, never silently overwrite
    if (toolId in catalog) {
      throw new Error(
        `TOOL_ID_STABILITY violation: Duplicate tool ID "${toolId}" in catalog. ` +
          "Tool IDs must be unique. Check for duplicate registrations."
      );
    }

    catalog[toolId] = tool;
  }

  return Object.freeze(catalog);
}

/**
 * TOOL_CATALOG: Canonical registry of all tool definitions.
 *
 * This is the single source of truth for tools in the system.
 * langgraph-graphs wraps tools from this catalog; it does not define contracts.
 *
 * To add a new tool:
 * 1. Create contract + implementation in tools/<name>.ts
 * 2. Add BoundTool to this catalog
 * 3. langgraph-graphs will pick it up automatically
 *
 * Per TOOL_ID_STABILITY: Duplicate IDs throw at construction time.
 */
export const TOOL_CATALOG: ToolCatalog = createToolCatalog([
  // Core tools (core__ prefix)
  getCurrentTimeBoundTool as CatalogBoundTool,
  knowledgeReadBoundTool as CatalogBoundTool,
  knowledgeSearchBoundTool as CatalogBoundTool,
  knowledgeWriteBoundTool as CatalogBoundTool,
  marketListBoundTool as CatalogBoundTool,
  metricsQueryBoundTool as CatalogBoundTool,
  repoListBoundTool as CatalogBoundTool,
  repoOpenBoundTool as CatalogBoundTool,
  repoSearchBoundTool as CatalogBoundTool,
  scheduleListBoundTool as CatalogBoundTool,
  scheduleManageBoundTool as CatalogBoundTool,
  vcsCreateBranchBoundTool as CatalogBoundTool,
  vcsGetCiStatusBoundTool as CatalogBoundTool,
  vcsListPrsBoundTool as CatalogBoundTool,
  vcsMergePrBoundTool as CatalogBoundTool,
  webSearchBoundTool as CatalogBoundTool,
  workItemQueryBoundTool as CatalogBoundTool,
  workItemTransitionBoundTool as CatalogBoundTool,
]);

/**
 * Get all tool IDs in the catalog.
 */
export function getToolIds(): readonly string[] {
  return Object.keys(TOOL_CATALOG);
}

/**
 * Get a tool by ID from the catalog.
 * Returns undefined if not found.
 */
export function getToolById(toolId: string): CatalogBoundTool | undefined {
  return TOOL_CATALOG[toolId];
}

/**
 * Check if a tool ID exists in the catalog.
 */
export function hasToolId(toolId: string): boolean {
  return toolId in TOOL_CATALOG;
}
