---
id: task.0211
type: task
title: "Parameterize LangGraph graphs for operator roles"
status: needs_closeout
priority: 0
rank: 1
estimate: 3
summary: "Add systemPrompt to graph options + CatalogEntry. Create createOperatorGraph factory behind a seam. Add CEO + Git Reviewer catalog entries with prompts and tool IDs."
outcome: "LANGGRAPH_CATALOG has ceo-operator and git-reviewer entries. createOperatorGraph wraps createReactAgent behind a seam for LangChain v1 migration. Existing graphs unchanged."
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
updated: 2026-03-27
labels: [agents, langgraph, workforce]
---

# Parameterize LangGraph Graphs for Operator Roles

## Design

### Outcome

Two new catalog entries using a shared `createOperatorGraph` factory behind a seam. Each role defined by system prompt + tools. Existing graphs unchanged.

### Approach

**Solution**: Add `systemPrompt` to `CreateReactAgentGraphOptions` + `CatalogEntry`. One `createOperatorGraph` factory wrapping `createReactAgent` (seam for LangChain v1 migration). Two catalog entries.

**Reuses**: `createReactAgent`, existing catalog pattern, existing tool resolution.

**Rejected**:

- "One factory file per role" — duplication
- "Collapse RoleSpec into CatalogEntry" — mixes graph concern with operational concern

### Invariants

- [ ] EXISTING_FACTORIES_UNCHANGED: poet, brain, ponderer, research, pr-review not modified
- [ ] CATALOG_SINGLE_SOURCE_OF_TRUTH: new entries in catalog.ts
- [ ] FACTORY_SEAM: createOperatorGraph wraps createReactAgent — single-file migration path

### Files

- Modify: `packages/langgraph-graphs/src/graphs/types.ts` — add `systemPrompt?: string`
- Modify: `packages/langgraph-graphs/src/catalog.ts` — add `systemPrompt` to CatalogEntry, 2 entries
- Create: `packages/langgraph-graphs/src/graphs/operator/graph.ts` — factory (~10 lines)
- Create: `packages/langgraph-graphs/src/graphs/operator/prompts.ts` — CEO + Git Reviewer prompts
- Create: `packages/langgraph-graphs/src/graphs/operator/tools.ts` — tool ID constants
- Test: catalog entry validation

## Plan

- [x] **Checkpoint 1**: Parameterize graph types + factory
  - Milestone: `systemPrompt` on types, `createOperatorGraph` factory compiles
  - Invariants: EXISTING_FACTORIES_UNCHANGED, FACTORY_SEAM
  - Todos:
    - [x] Add `systemPrompt?: string` to `CreateReactAgentGraphOptions` in `types.ts`
    - [x] Add `systemPrompt` spread in `runner.ts:133`
    - [x] Create `graphs/operator/graph.ts` with `createOperatorGraph`
  - Validation: `pnpm check:fast` passes, existing graphs unchanged

- [x] **Checkpoint 2**: Catalog entries + prompts + tool IDs
  - Milestone: `LANGGRAPH_CATALOG` has ceo-operator and git-reviewer entries
  - Invariants: CATALOG_SINGLE_SOURCE_OF_TRUTH
  - Todos:
    - [x] Add `systemPrompt` to `CatalogEntry` interface in `catalog.ts`
    - [x] Create `graphs/operator/prompts.ts` with CEO + Git Reviewer prompts
    - [x] Create `graphs/operator/tools.ts` with tool ID constants
    - [x] Add 2 catalog entries
    - [x] Add to `LANGGRAPH_GRAPH_IDS`
  - Validation: `pnpm check:fast` passes

- [x] **Checkpoint 3**: Test + finalize
  - Milestone: Tests prove catalog entries work, factory validates
  - Todos:
    - [x] Write test for createOperatorGraph + catalog entries
    - [x] `pnpm check` passes
  - Validation: All tests green, work item status → needs_closeout

## Validation

- [ ] `LANGGRAPH_CATALOG["ceo-operator"]` resolves with systemPrompt + toolIds + graphFactory
- [ ] `LANGGRAPH_CATALOG["git-reviewer"]` resolves with systemPrompt + toolIds + graphFactory
- [ ] `createOperatorGraph({ llm, tools, systemPrompt: "test" })` returns valid graph
- [ ] `createOperatorGraph({ llm, tools })` throws (missing systemPrompt)
- [ ] Existing graph tests pass unchanged
- [ ] `pnpm check:fast` passes
