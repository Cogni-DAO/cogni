// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/crew-orchestrator/graph`
 * Purpose: Crew orchestrator graph — deploys MCP server + AI agent crews to Akash.
 * Scope: Creates a React agent graph with crew deployment tools. Does NOT execute tools directly.
 * Invariants:
 *   - PURE_FACTORY: No side effects, no env reads
 *   - TOOLS_VIA_DI: All capabilities received via options, not hard-imported
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 */

import type { LanguageModelLike } from "@langchain/core/language_models/base";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { CREW_ORCHESTRATOR_SYSTEM_PROMPT } from "./prompts.js";
import {
  type CrewOrchestratorToolDeps,
  createCrewOrchestratorTools,
} from "./tools.js";

export const CREW_ORCHESTRATOR_GRAPH_NAME = "crew-orchestrator" as const;

/**
 * Options for creating the crew orchestrator graph.
 * All Akash/registry capabilities come through `deps` — no hard imports.
 *
 * Callers wire this from their runtime context:
 * ```ts
 * import { resolveMcpServer, listRegisteredMcpServers, ... } from "@cogni/akash-client";
 * const graph = createCrewOrchestratorGraph({
 *   llm: myLlm,
 *   deps: { deployer, resolveMcpServer, listRegisteredMcpServers, getRequiredEnv, getOAuthScopes },
 * });
 * ```
 */
export interface CreateCrewOrchestratorOptions {
  llm: LanguageModelLike;
  deps: CrewOrchestratorToolDeps;
}

export function createCrewOrchestratorGraph(
  options: CreateCrewOrchestratorOptions
) {
  const { llm, deps } = options;
  const tools = createCrewOrchestratorTools(deps);

  return createReactAgent({
    llm,
    tools,
    prompt: CREW_ORCHESTRATOR_SYSTEM_PROMPT,
  });
}
