// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/broadcast-writer/graph`
 * Purpose: Single-call graph for platform-specific content adaptation.
 * Scope: Receives platform skill guide + content intent as user message, returns optimized post.
 *   One graph run per target platform — caller spawns N runs for N platforms.
 * Invariants:
 *   - Pure factory function — no side effects, no env reads
 *   - LLM and tools are injected, not instantiated
 *   - No tools — all context is in the user message
 *   - TYPE_TRANSPARENT_RETURN: No explicit return type annotation
 * Side-effects: none
 * Links: docs/spec/broadcasting.md, packages/broadcast-core/platform-skills/
 * @public
 */

import { MessagesAnnotation } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

import type { CreateReactAgentGraphOptions } from "../types";
import { BROADCAST_WRITER_SYSTEM_PROMPT } from "./prompts";

/**
 * Graph name constant for catalog registration and routing.
 */
export const BROADCAST_WRITER_GRAPH_NAME = "broadcast-writer" as const;

/**
 * Create a broadcast content writer graph.
 *
 * This is a single-call graph with NO tools:
 * - Receives a platform skill guide + content intent as user message
 * - Makes one LLM call to adapt the content for the target platform
 * - Returns the platform-optimized post in the response
 *
 * Caller is responsible for:
 * - Reading the platform skill doc and including it in the user message
 * - Spawning one graph run per target platform
 * - Parsing the response into a PlatformPost
 *
 * NOTE: Return type is intentionally NOT annotated to preserve the concrete
 * CompiledStateGraph type for LangGraph CLI schema extraction.
 */
export function createBroadcastWriterGraph(opts: CreateReactAgentGraphOptions) {
	const { llm, responseFormat } = opts;

	return createReactAgent({
		llm,
		tools: [],
		messageModifier: BROADCAST_WRITER_SYSTEM_PROMPT,
		...(responseFormat === undefined && { stateSchema: MessagesAnnotation }),
		...(responseFormat !== undefined && { responseFormat }),
	});
}
