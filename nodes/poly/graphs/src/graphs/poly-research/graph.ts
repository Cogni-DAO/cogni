// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-graphs/graphs/poly-research/graph`
 * Purpose: Peer graph to poly-brain — patient wallet-research agent that returns a
 *          structured `PolyResearchReport` via LangGraph `responseFormat` (task.0386).
 * Scope: Pure factory. Does not load env, does not perform IO, does not import adapters.
 * Invariants: TYPE_TRANSPARENT_RETURN, PACKAGES_NO_ENV, GRAPH_PEER_NOT_NESTED.
 * Side-effects: none
 * Links: work/items/task.0386.poly-agent-wallet-research-v0.md
 * @public
 */

import type { CreateReactAgentGraphOptions } from "@cogni/langgraph-graphs/graphs";
import { MessagesAnnotation } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { POLY_RESEARCH_SYSTEM_PROMPT } from "./prompts";

export const POLY_RESEARCH_GRAPH_NAME = "poly-research" as const;

/**
 * Create the poly-research ReAct agent graph.
 *
 * v0 does NOT use LangGraph `responseFormat` — the system prompt instructs the
 * agent to emit a JSON `PolyResearchReport` as its final message, and the
 * caller parses `choices[0].message.content` against `PolyResearchReportSchema`
 * (exported from `@cogni/node-contracts`). This keeps the graph resilient to
 * early-stop / recursion-limit cases where the structured-output node would
 * otherwise reject a partial response with an opaque ZodError.
 *
 * NOTE: Return type intentionally NOT annotated (TYPE_TRANSPARENT_RETURN).
 */
export function createPolyResearchGraph(opts: CreateReactAgentGraphOptions) {
  const { llm, tools } = opts;

  return createReactAgent({
    llm,
    tools: [...tools],
    messageModifier: POLY_RESEARCH_SYSTEM_PROMPT,
    stateSchema: MessagesAnnotation,
  });
}
