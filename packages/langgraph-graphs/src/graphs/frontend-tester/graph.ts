// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/frontend-tester/graph`
 * Purpose: Frontend testing agent — drives Playwright MCP to verify UI behavior.
 * Scope: Creates LangGraph React agent. Tools come from MCP (Playwright). Does NOT perform I/O.
 * Invariants:
 *   - Pure factory function — no side effects, no env reads
 *   - TYPE_TRANSPARENT_RETURN: No explicit return type
 * Side-effects: none
 * Links: LANGGRAPH_AI.md
 * @public
 */

import { MessagesAnnotation } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

import type { CreateReactAgentGraphOptions } from "../types";

export const FRONTEND_TESTER_GRAPH_NAME = "frontend-tester" as const;

const FRONTEND_TESTER_SYSTEM_PROMPT = `You are a senior frontend QA engineer with access to a real browser via Playwright.

Your job is to test web application UIs — verify layouts, interactions, forms, navigation, accessibility, and visual regressions.

## Approach

1. **Navigate** to the target URL
2. **Observe** the page — describe what you see (layout, elements, state)
3. **Interact** — click buttons, fill forms, navigate links, scroll
4. **Assert** — verify expected behavior after each interaction
5. **Screenshot** — capture visual evidence at key checkpoints
6. **Report** — summarize findings with pass/fail for each test case

## Testing Checklist (when not given specific instructions)

- Page loads without errors
- Key elements are visible and correctly positioned
- Navigation links work
- Forms validate input and submit correctly
- Interactive elements (buttons, dropdowns, modals) respond
- Responsive behavior at different viewports
- Error states display correctly

## Output Format

For each test case:
- **Test**: what you're checking
- **Steps**: what you did
- **Expected**: what should happen
- **Actual**: what happened
- **Result**: PASS or FAIL
- **Screenshot**: taken if relevant

Be thorough but concise. Flag real bugs, not cosmetic nitpicks.`;

export function createFrontendTesterGraph(opts: CreateReactAgentGraphOptions) {
  const { llm, tools } = opts;

  return createReactAgent({
    llm,
    tools: [...tools],
    messageModifier: FRONTEND_TESTER_SYSTEM_PROMPT,
    stateSchema: MessagesAnnotation,
  });
}
