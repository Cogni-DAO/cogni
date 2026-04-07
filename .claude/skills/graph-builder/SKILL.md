---
name: graph-builder
description: "Scaffold a new LangGraph agent from a template. Guides the user through intent, I/O shape, and prompt design, then generates the 5-file graph package + catalog entry. Use when: 'create a new agent', 'build a graph', 'scaffold an agent', 'new graph', 'add an agent'."
---

# Graph Builder — Scaffold a LangGraph Agent

You are a graph scaffolding assistant. Your job: guide the user from intent to a working, compilable LangGraph agent in this codebase.

## Prerequisites — Read First

Before generating anything, read these files to understand the current state:

1. `packages/langgraph-graphs/src/catalog.ts` — existing catalog entries (avoid name collisions)
2. `packages/langgraph-graphs/src/graphs/index.ts` — barrel exports
3. `packages/langgraph-graphs/src/graphs/types.ts` — `CreateReactAgentGraphOptions` interface

## Step 1: Assess Intent

Ask the user **three questions** (adapt based on context — skip if already answered):

1. **What does your agent do?** (one sentence)
2. **Which template fits best?**
   - **Chat assistant** — custom persona with minimal tools (like `poet`)
   - **Tool-calling agent** — multi-tool ReAct agent (like `brain`)
   - **Research agent** — web search + knowledge store (like `research`)
   - **Structured output** — no tools, schema-driven response (like `pr-review`)
3. **What tools does it need?** Present the available tool catalog:

   | Tool ID                      | What it does                   |
   | ---------------------------- | ------------------------------ |
   | `core__get_current_time`     | Current timestamp              |
   | `core__repo_list`            | List files by glob pattern     |
   | `core__repo_search`          | Search file contents (ripgrep) |
   | `core__repo_open`            | Read a specific file           |
   | `core__knowledge_search`     | Search curated knowledge store |
   | `core__knowledge_read`       | Read knowledge entry by ID     |
   | `core__knowledge_write`      | Save new knowledge entry       |
   | `core__web_search`           | Web search via Tavily          |
   | `core__schedule_list`        | List scheduled executions      |
   | `core__schedule_manage`      | Create/update/delete schedules |
   | `core__work_item_query`      | Query work items               |
   | `core__work_item_transition` | Transition work item status    |
   | `core__vcs_list_prs`         | List pull requests             |
   | `core__vcs_create_branch`    | Create a git branch            |
   | `core__vcs_get_ci_status`    | Check CI status                |
   | `core__vcs_merge_pr`         | Merge a pull request           |
   | `core__metrics_query`        | Query system metrics           |
   | `core__market_list`          | List prediction markets        |

## Step 2: Name the Graph

Ask for a **kebab-case** name (e.g., `haiku-reviewer`, `docs-scanner`, `market-analyst`).

Validate:

- Must be kebab-case (`/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`)
- Must not collide with existing names in `LANGGRAPH_CATALOG`
- Derive the constant name: `HAIKU_REVIEWER_GRAPH_NAME`, function name: `createHaikuReviewerGraph`

## Step 3: Design the System Prompt

Help the user craft a system prompt. Guidelines:

- Start with role identity ("You are...")
- List available tools and when to use each
- Define output format expectations
- Keep under 2000 chars for v0
- Reference existing prompts in `packages/langgraph-graphs/src/graphs/*/prompts.ts` as examples

## Step 4: Generate the 5-File Scaffold

Generate all files under `packages/langgraph-graphs/src/graphs/<name>/`:

### 4a. `tools.ts`

```typescript
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { /* selected tool name constants */ } from "@cogni/ai-tools";

export const <NAME>_TOOL_IDS = [
  // ... selected tool IDs
] as const;

export type <Name>ToolId = (typeof <NAME>_TOOL_IDS)[number];
```

### 4b. `prompts.ts`

```typescript
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

export const <NAME>_SYSTEM_PROMPT = `
<user's system prompt>
` as const;
```

### 4c. `graph.ts`

For **chat-assistant**, **tool-agent**, **researcher** templates:

```typescript
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { MessagesAnnotation } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import type { CreateReactAgentGraphOptions } from "../types";
import { <NAME>_SYSTEM_PROMPT } from "./prompts";

export const <NAME>_GRAPH_NAME = "<kebab-name>" as const;

export function create<PascalName>Graph(opts: CreateReactAgentGraphOptions) {
  const { llm, tools } = opts;
  return createReactAgent({
    llm,
    tools: [...tools],
    messageModifier: <NAME>_SYSTEM_PROMPT,
    stateSchema: MessagesAnnotation,
  });
}
```

For **structured-output** template, use `responseFormat` instead of tools — reference `packages/langgraph-graphs/src/graphs/pr-review/graph.ts` for the pattern.

### 4d. `cogni-exec.ts`

```typescript
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { makeCogniGraph } from "../../runtime/cogni/make-cogni-graph";
import { <NAME>_GRAPH_NAME, create<PascalName>Graph } from "./graph";
import { <NAME>_TOOL_IDS } from "./tools";

export const <camelName>Graph = makeCogniGraph({
  name: <NAME>_GRAPH_NAME,
  createGraph: create<PascalName>Graph,
  toolIds: <NAME>_TOOL_IDS,
});
```

### 4e. Header comment convention

Every file must include:

```typescript
/**
 * Module: `@cogni/langgraph-graphs/graphs/<name>/<file>`
 * Purpose: <one-line purpose>
 * Scope: <what it does and doesn't do>
 * Invariants: <relevant invariants from the codebase>
 * Side-effects: none
 * Links: <relevant spec links>
 * @public
 */
```

## Step 5: Register in Catalog

Update `packages/langgraph-graphs/src/catalog.ts`:

1. Add import for `create<PascalName>Graph` and `<NAME>_GRAPH_NAME` from the new graph
2. Add import for `<NAME>_TOOL_IDS` from the new tools
3. Add catalog entry to `LANGGRAPH_CATALOG`:

```typescript
[<NAME>_GRAPH_NAME]: {
  displayName: "<Display Name>",
  description: "<one-line description>",
  toolIds: <NAME>_TOOL_IDS,
  graphFactory: create<PascalName>Graph,
},
```

4. Add to `LANGGRAPH_GRAPH_IDS`:

```typescript
"<kebab-name>": `${LANGGRAPH_PROVIDER_ID}:${<NAME>_GRAPH_NAME}`,
```

5. Add union member to `LangGraphGraphId` type.

## Step 6: Update Barrel Export

Add to `packages/langgraph-graphs/src/graphs/index.ts`:

```typescript
export { create<PascalName>Graph, <NAME>_GRAPH_NAME } from "./<name>/graph";
```

## Step 7: Choose Target Node

Ask the user which node this agent should be added to. Default is **operator**.

Available nodes (check `nodes/` directory for current list):

- **operator** (default) — the main Cogni operator node. Graph goes in `packages/langgraph-graphs/src/graphs/` and `LANGGRAPH_CATALOG`.
- **node-specific** (e.g., poly, resy) — graph goes in `nodes/<slug>/graphs/src/graphs/` and that node's local catalog (e.g., `POLY_LANGGRAPH_CATALOG`).

**For operator (default):**

- Files: `packages/langgraph-graphs/src/graphs/<name>/`
- Catalog: `packages/langgraph-graphs/src/catalog.ts` → `LANGGRAPH_CATALOG`
- Barrel: `packages/langgraph-graphs/src/graphs/index.ts`
- UI wiring: Add entry to `AVAILABLE_GRAPHS` in **both**:
  - `nodes/operator/app/src/features/ai/components/ChatComposerExtras.tsx`
  - `nodes/node-template/app/src/features/ai/components/ChatComposerExtras.tsx`

**For a specific node (e.g., poly):**

- Files: `nodes/<slug>/graphs/src/graphs/<name>/`
- Catalog: `nodes/<slug>/graphs/src/index.ts` → node-local catalog (e.g., `POLY_LANGGRAPH_CATALOG`)
- UI wiring: Add entry to `AVAILABLE_GRAPHS` in `nodes/<slug>/app/src/features/ai/components/ChatComposerExtras.tsx`

> **vNext**: This step will be replaced by agent-registry auto-registration — merge to canary auto-registers the graph as a callable agent.

## Step 8: Validate

Run:

```bash
pnpm packages:build
```

If it compiles, the graph is ready. The user can test it by:

1. `pnpm dev` (starts the operator)
2. Open the chat UI and select the new graph from the model dropdown
3. Or call `/api/v1/chat/completions` with `"model": "<kebab-name>"`

## Rules

- **FOLLOW_EXISTING_PATTERNS**: Every generated file must match the style of existing graphs (poet, brain, research). Read them if unsure.
- **NO_ENV_READS**: Graph factories are pure. No `process.env`, no `import { serverEnv }`.
- **NO_SRC_IMPORTS**: Package code never imports from `src/`. Only `@cogni/ai-tools`, `@langchain/*`, and sibling graph code.
- **TOOLS_BY_ID**: Reference tools by string ID constant, not by importing tool implementations.
- **TYPE_TRANSPARENT_RETURN**: Do NOT annotate return types on graph factory functions.
- **LICENSE_HEADERS**: Every `.ts` file starts with the SPDX license header.
