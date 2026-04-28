// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/pr-review/graph`
 * Purpose: Single-call structured output graph factory for PR review evaluation.
 * Scope: Creates a minimal LangGraph agent that evaluates PRs. Does not execute graphs or read env.
 * Invariants:
 *   - Pure factory function — no side effects, no env reads
 *   - LLM and tools are injected, not instantiated
 *   - No tools — evidence is pre-fetched outside the graph
 *   - TYPE_TRANSPARENT_RETURN: No explicit return type annotation
 * Side-effects: none
 * Links: task.0153, nodes/<node>/.cogni/rules/*.yaml
 * @public
 */

import { MessagesAnnotation } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

import type { CreateReactAgentGraphOptions } from "../types";
import { PR_REVIEW_SYSTEM_PROMPT } from "./prompts";

/**
 * Graph name constant for routing.
 */
export const PR_REVIEW_GRAPH_NAME = "pr-review" as const;

/**
 * Create a PR review evaluation graph.
 *
 * This is a single-call graph with NO tools:
 * - Receives pre-fetched PR evidence as user message content
 * - Makes one LLM call to evaluate metrics
 * - Returns scores and observations in the response
 *
 * Uses createReactAgent with empty tools array.
 * The ReAct loop completes in one iteration (no tool calls = immediate return).
 *
 * NOTE: Return type is intentionally NOT annotated to preserve the concrete
 * CompiledStateGraph type for LangGraph CLI schema extraction.
 */
export function createPrReviewGraph(opts: CreateReactAgentGraphOptions) {
  const { llm, responseFormat } = opts;

  return createReactAgent({
    llm,
    tools: [],
    messageModifier: PR_REVIEW_SYSTEM_PROMPT,
    ...(responseFormat === undefined && { stateSchema: MessagesAnnotation }),
    ...(responseFormat !== undefined && { responseFormat }),
  });
}
