// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/poly-brain/graph`
 * Purpose: Prediction market brain agent graph factory.
 * Scope: Creates LangGraph React agent with market + web search tools. Does not execute graphs or read env.
 * Invariants: Pure factory, TYPE_TRANSPARENT_RETURN, PACKAGES_NO_ENV.
 * Side-effects: none
 * Links: work/items/task.0230.market-data-package.md
 * @public
 */

import { MessagesAnnotation } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

import type { CreateReactAgentGraphOptions } from "../types";
import { POLY_BRAIN_SYSTEM_PROMPT } from "./prompts";

export const POLY_BRAIN_GRAPH_NAME = "poly-brain" as const;

/**
 * Create a prediction market brain agent graph.
 *
 * ReAct agent with market listing and web search tools.
 * Analyzes prediction markets and researches underlying events.
 *
 * NOTE: Return type intentionally NOT annotated (TYPE_TRANSPARENT_RETURN).
 */
export function createPolyBrainGraph(opts: CreateReactAgentGraphOptions) {
  const { llm, tools } = opts;

  return createReactAgent({
    llm,
    tools: [...tools],
    messageModifier: POLY_BRAIN_SYSTEM_PROMPT,
    stateSchema: MessagesAnnotation,
  });
}
