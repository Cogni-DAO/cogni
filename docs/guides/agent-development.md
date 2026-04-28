---
id: agent-development-guide
type: guide
title: Agent Development Guide
status: draft
trust: draft
summary: Step-by-step checklist for adding new agent graphs (single-node and composed) to the LangGraph package.
read_when: Adding a new AI agent graph — cross-node (packages/langgraph-graphs/) or node-only (nodes/<node>/graphs/).
owner: derekg1729
created: 2026-02-06
verified: 2026-04-27
tags: [ai, agents, dev]
---

# Agent Development Guide

> Quick reference for adding new agent graphs. For architecture details, see [LangGraph Patterns spec](../spec/langgraph-patterns.md).

## When to Use This

You are adding a new AI agent graph. This covers cross-node agents (Tier 1a, `packages/langgraph-graphs`), node-only agents (Tier 1b, `nodes/<node>/graphs/`), and composed multi-node graphs (Tier 2).

## Decide first: cross-node or node-only?

Per `SINGLE_DOMAIN_HARD_FAIL` (see [`node-ci-cd-contract.md`](../spec/node-ci-cd-contract.md#single-domain-scope)) and the bug.0319 substrate move, decide where the agent lives before scaffolding files:

| Question                                                                            | Place in                                       | Catalog                    | Reference graph                               |
| ----------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------- | --------------------------------------------- |
| Will every node expose this agent? (e.g. `brain`, `poet`, `research`, `pr-manager`) | `packages/langgraph-graphs/src/graphs/<name>/` | `LANGGRAPH_CATALOG`        | `ponderer/`                                   |
| Only one node consumes it? (e.g. `poly-brain`, `poly-research` for poly)            | `nodes/<node>/graphs/src/graphs/<name>/`       | `<NODE>_LANGGRAPH_CATALOG` | `nodes/poly/graphs/src/graphs/poly-research/` |

Default to node-scoped — promoting node→core later is a deliberate hoist. Adding to `LANGGRAPH_CATALOG` when only one node uses it forces every other node to potentially ship dead-graph metadata.

## Preconditions

- [ ] `packages/langgraph-graphs` builds cleanly (`pnpm packages:build`)
- [ ] Agent purpose and required tools identified
- [ ] Familiar with the `ponderer/` graph as a reference implementation

## Steps

### Tier 1a: Cross-Node Agent (cross-node `LANGGRAPH_CATALOG`)

**File Structure:**

```
packages/langgraph-graphs/src/graphs/<name>/
├── graph.ts        # Pure factory: createXGraph({ llm, tools })
├── prompts.ts      # System prompt constant(s)
├── tools.ts        # Tool IDs constant (*_TOOL_IDS)
├── server.ts       # LangGraph dev entrypoint
└── cogni-exec.ts   # Cogni executor entrypoint
```

**Steps:**

1. Create `graph.ts` — pure factory with `stateSchema: MessagesAnnotation`, NO explicit return type
2. Create `prompts.ts` — system prompt constant
3. Create `tools.ts` — export `*_TOOL_IDS` array referencing tool names from `@cogni/ai-tools`
4. Create `server.ts` — `export const x = await makeServerGraph({ name, createGraph, toolIds })`
5. Create `cogni-exec.ts` — `export const xGraph = makeCogniGraph({ name, createGraph, toolIds })`
6. Add entry to `catalog.ts` — `toolIds`, `graphFactory`
7. Add to `langgraph.json` — `"name": "./src/graphs/<name>/server.ts:x"`
8. Export from `graphs/index.ts`
9. **P0 workaround:** Add to `AVAILABLE_GRAPHS` in `nodes/<node>/app/src/features/ai/components/ChatComposerExtras.tsx`

> **Note:** Step 9 is a temporary workaround. The chat UI uses a hardcoded graph list instead of fetching from `/api/v1/ai/agents`. See [Graph Execution](../spec/graph-execution.md) P1 checklist for the fix.

**Template:** Copy from `ponderer/`

**Verify:** `pnpm packages:build && pnpm langgraph:dev`

### Entrypoint Invariants

| Invariant                            | Rule                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------- |
| PURE_GRAPH_FACTORY                   | `graph.ts` has no env/ALS/entrypoint wiring                            |
| TYPE_TRANSPARENT_RETURN              | `graph.ts` has NO explicit return type (preserves CompiledStateGraph)  |
| ENTRYPOINT_IS_THIN                   | `server.ts` and `cogni-exec.ts` call `make*Graph` helpers              |
| LANGGRAPH_JSON_POINTS_TO_SERVER_ONLY | Never reference `cogni-exec.ts` in langgraph.json                      |
| NO_CROSSING_THE_STREAMS              | `server.ts` uses `initChatModel`; `cogni-exec.ts` uses ALS — never mix |

### Shared Types

From `packages/langgraph-graphs/src/graphs/types.ts`:

| Type                           | Purpose                                            |
| ------------------------------ | -------------------------------------------------- |
| `InvokableGraph<I, O>`         | Type firewall: `Pick<RunnableInterface, "invoke">` |
| `CreateReactAgentGraphOptions` | Base options: `{ llm, tools }`                     |
| `MessageGraphInput/Output`     | Mutable message arrays (LangGraph-aligned)         |

### Tier 1b: Node-Only Agent (per-node `<NODE>_LANGGRAPH_CATALOG`)

**File Structure (no `server.ts` / `cogni-exec.ts` — node-only graphs run via the host node's merged catalog, not via standalone langgraph-dev entrypoints):**

```
nodes/<node>/graphs/src/graphs/<name>/
├── graph.ts          # Pure factory: createXGraph({ llm, tools })
├── prompts.ts        # System prompt constant(s)
├── tools.ts          # Tool IDs constant; may import from @cogni/ai-tools (core) AND @cogni/<node>-ai-tools (node-scoped)
└── output-schema.ts  # Optional Zod schema for structured outputs (see poly-research)
```

**Steps:**

1. Create graph files under `nodes/<node>/graphs/src/graphs/<name>/` (NOT `packages/langgraph-graphs`). Skip the dual-entrypoint pattern from Tier 1a — node-only graphs are not exposed to standalone `langgraph dev`; they are wired into the host node's executor through the merged catalog.
2. `tools.ts` imports tool IDs from `@cogni/ai-tools` (cross-node `core__` IDs like `WEB_SEARCH_NAME`) and/or `@cogni/<node>-ai-tools` (node-scoped IDs like `MARKET_LIST_NAME`, `POLY_DATA_*_NAME` from `@cogni/poly-ai-tools`).
3. Add catalog entry to `nodes/<node>/graphs/src/index.ts` under `<NODE>_LANGGRAPH_CATALOG`. Don't touch `packages/langgraph-graphs/src/catalog.ts`.
4. The node app's `inproc.provider.ts` already merges `LANGGRAPH_CATALOG + <NODE>_LANGGRAPH_CATALOG` (see `POLY_MERGED_CATALOG` in `nodes/poly/app/src/adapters/server/ai/langgraph/poly-catalog.ts`); no inproc-provider edit needed to expose the new agent.
5. UI surfacing — `AVAILABLE_GRAPHS` in `nodes/<node>/app/src/features/ai/components/ChatComposerExtras.tsx` is hardcoded today; add the new `graphId` (e.g. `langgraph:<name>`) so it appears in the chat picker.

**Reference:** `nodes/poly/graphs/src/graphs/poly-research/` (full example with tools.ts importing from both `@cogni/ai-tools` + `@cogni/poly-ai-tools`, plus an `output-schema.ts` for the structured `PolyResearchReport`).

### Tier 2: Composed Graphs

For multi-node graphs with node-keyed configuration, see [Graph Execution](../spec/graph-execution.md) § Node-Keyed Model & Tool Configuration.

## Verification

```bash
pnpm packages:build && pnpm langgraph:dev
```

Verify your graph appears in the LangGraph Studio UI and responds to test messages.

## Troubleshooting

### Problem: Graph not appearing in LangGraph Studio

**Solution:** Ensure you added the entry to `langgraph.json` pointing to `server.ts` (not `cogni-exec.ts`). Check the LANGGRAPH_JSON_POINTS_TO_SERVER_ONLY invariant.

### Problem: Type error on graph return type

**Solution:** Do NOT add an explicit return type to `graph.ts`. The TYPE_TRANSPARENT_RETURN invariant requires the `CompiledStateGraph` type to flow through naturally.

## Related

- [Tools Authoring Guide](./tools-authoring.md) — Adding new tools for agents
- [LangGraph Patterns Spec](../spec/langgraph-patterns.md) — Architecture patterns
- [Graph Execution](../spec/graph-execution.md) — Execution invariants
