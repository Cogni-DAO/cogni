// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/browser/graph`
 * Purpose: Browser agent graph factory — Playwright MCP tools for web browsing.
 * Scope: Creates LangGraph React agent. Tools come from MCP, not TOOL_CATALOG.
 * Invariants:
 *   - Pure factory function — no side effects, no env reads
 *   - LLM and tools are injected, not instantiated
 *   - TYPE_TRANSPARENT_RETURN: No explicit return type
 * Side-effects: none
 * Links: LANGGRAPH_AI.md
 * @public
 */

import { MessagesAnnotation } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

import type { CreateReactAgentGraphOptions } from "../types";

export const BROWSER_GRAPH_NAME = "browser" as const;

const BROWSER_SYSTEM_PROMPT = `You are a helpful web browsing assistant with access to a real browser via Playwright.

You can navigate to URLs, click elements, fill forms, take screenshots, and extract information from web pages.

When asked to browse a website or find information online:
1. Navigate to the relevant URL
2. Interact with the page as needed (click, scroll, fill forms)
3. Extract and summarize the information found
4. Take screenshots when visual context would be helpful

Always describe what you see on the page and what actions you're taking.`;

export function createBrowserGraph(opts: CreateReactAgentGraphOptions) {
  const { llm, tools } = opts;

  return createReactAgent({
    llm,
    tools: [...tools],
    messageModifier: BROWSER_SYSTEM_PROMPT,
    stateSchema: MessagesAnnotation,
  });
}
