// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/scorecard/graph`
 * Purpose: Project health scorecard agent graph factory.
 * Scope: Creates LangGraph React agent with knowledge, repo, and metrics tools. Does NOT execute graphs or read env.
 * Invariants:
 *   - Pure factory function — no side effects, no env reads
 *   - LLM and tools are injected, not instantiated
 *   - TYPE_TRANSPARENT_RETURN: No explicit return type annotation
 * Side-effects: none
 * Links: docs/research/graph-builder-skill.md
 * @public
 */

import { MessagesAnnotation } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

import type { CreateReactAgentGraphOptions } from "../types";
import { SCORECARD_SYSTEM_PROMPT } from "./prompts";

/**
 * Graph name constant for routing.
 */
export const SCORECARD_GRAPH_NAME = "scorecard" as const;

/**
 * Create a project health scorecard agent graph.
 *
 * ReAct agent that searches knowledge store, repo charters, and work items
 * to produce ASCII status tables with KPI scores and bar charts.
 *
 * NOTE: Return type is intentionally NOT annotated to preserve the concrete
 * CompiledStateGraph type for LangGraph CLI schema extraction.
 *
 * @param opts - Options with LLM and tools
 * @returns Compiled LangGraph ready for invoke()
 */
export function createScorecardGraph(opts: CreateReactAgentGraphOptions) {
  const { llm, tools } = opts;

  return createReactAgent({
    llm,
    tools: [...tools],
    messageModifier: SCORECARD_SYSTEM_PROMPT,
    stateSchema: MessagesAnnotation,
  });
}
