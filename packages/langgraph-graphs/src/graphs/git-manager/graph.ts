// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/git-manager/graph`
 * Purpose: Pure factory for the Git Manager orchestrator graph.
 * Scope: Creates LangGraph React agent with inline system prompt. Does NOT read env or import catalog.
 * Invariants:
 *   - PURE_GRAPH_FACTORY: No side effects, no env reads
 *   - TYPE_TRANSPARENT_RETURN: No explicit return type (preserves CompiledStateGraph)
 * Side-effects: none
 * Links: docs/guides/agent-development.md
 * @public
 */

import { MessagesAnnotation } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

import type { CreateReactAgentGraphOptions } from "../types";
import { GIT_MANAGER_SYSTEM_PROMPT } from "./prompts";

export const GIT_MANAGER_GRAPH_NAME = "git-manager" as const;

/**
 * Create a Git Manager orchestrator graph.
 *
 * Uses createReactAgent with the system prompt embedded (not catalog-driven).
 * This enables server.ts/cogni-exec.ts entrypoints since makeServerGraph
 * does not pass systemPrompt.
 */
export function createGitManagerGraph(opts: CreateReactAgentGraphOptions) {
  const { llm, tools } = opts;

  return createReactAgent({
    llm,
    tools: [...tools],
    prompt: GIT_MANAGER_SYSTEM_PROMPT,
    stateSchema: MessagesAnnotation,
  });
}
