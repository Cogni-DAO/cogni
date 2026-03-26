---
id: task.0207
type: task
title: "Parameterize LangGraph graphs for operator roles"
status: needs_design
priority: 0
rank: 1
estimate: 3
summary: "Add systemPrompt to CreateReactAgentGraphOptions + CatalogEntry. Create createOperatorGraph factory. Add CEO Operator and Git Reviewer catalog entries with system prompts and tool sets."
outcome: "LANGGRAPH_CATALOG has ceo-operator and git-reviewer entries using the same createOperatorGraph factory with different system prompts and toolIds. Existing graphs unchanged."
spec_refs:
  - agent-roles
assignees:
  - derekg1729
project: proj.agent-workforce
branch: feat/mission-control-clean
pr:
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-03-26
updated: 2026-03-26
labels: [agents, langgraph, workforce]
---

# Parameterize LangGraph Graphs for Operator Roles

## Context

Every graph factory (poet, brain, ponderer, pr-review) is a 3-line wrapper around `createReactAgent` differing only in system prompt and tools. To add operator roles (CEO, Git Reviewer), we don't need new factory files — we need a parameterized factory and catalog entries.

## Design

### Outcome

Two new catalog entries (`ceo-operator`, `git-reviewer`) using a shared `createOperatorGraph` factory. Each role is defined by its system prompt and tool set. Existing graphs unchanged.

### Approach

**Solution**: Add optional `systemPrompt` to `CreateReactAgentGraphOptions` and `CatalogEntry`. Create one `createOperatorGraph` factory that reads prompt from opts. Add catalog entries.

**Reuses**: Existing `createReactAgent` from `@langchain/langgraph/prebuilt`. Existing catalog pattern. Existing tool resolution pipeline.

**Rejected**:

- "One factory file per role" — duplication. All ReAct agents are identical except prompt/tools.
- "Runtime-configurable prompts via `configurable`" — too complex for crawl. Catalog-level config is sufficient.

### Invariants

- [ ] EXISTING_FACTORIES_UNCHANGED: poet, brain, ponderer, research, pr-review not modified
- [ ] CATALOG_SINGLE_SOURCE_OF_TRUTH: new entries live in catalog.ts
- [ ] SYSTEM_PROMPT_REQUIRED: createOperatorGraph throws if systemPrompt missing

### Files

- Modify: `packages/langgraph-graphs/src/graphs/types.ts` — add `systemPrompt?: string` to `CreateReactAgentGraphOptions`
- Modify: `packages/langgraph-graphs/src/catalog.ts` — add `systemPrompt` to `CatalogEntry`, add ceo-operator + git-reviewer entries
- Create: `packages/langgraph-graphs/src/graphs/operator/graph.ts` — `createOperatorGraph` factory (~10 lines)
- Create: `packages/langgraph-graphs/src/graphs/operator/prompts.ts` — CEO_OPERATOR_PROMPT, GIT_REVIEWER_PROMPT
- Create: `packages/langgraph-graphs/src/graphs/operator/tools.ts` — CEO_TOOL_IDS, GIT_REVIEWER_TOOL_IDS
- Create: operator tools in `@cogni/ai-tools`: `work_item_query`, `work_item_transition`
- Test: `packages/langgraph-graphs/tests/operator-catalog.test.ts` — catalog entry validation

## Validation

- [ ] `LANGGRAPH_CATALOG["ceo-operator"]` has systemPrompt, toolIds, graphFactory
- [ ] `LANGGRAPH_CATALOG["git-reviewer"]` has systemPrompt, toolIds, graphFactory
- [ ] `createOperatorGraph({ llm, tools, systemPrompt: "test" })` returns a valid graph
- [ ] `createOperatorGraph({ llm, tools })` throws (missing systemPrompt)
- [ ] Existing graphs (poet, brain, etc.) pass existing tests unchanged
- [ ] `pnpm check:fast` passes
