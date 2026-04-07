---
id: task.0300
type: task
status: needs_design
priority: 1
rank: 3
estimate: 2
title: "Doltgres graph registry — graph_registry table + catalog sync + eval:registry CLI"
summary: Add graph_registry + sync_state tables to @cogni/knowledge-store. Sync from catalog.ts via commit-cursor. CLI combines Doltgres catalog with Langfuse scores for eval coverage matrix.
outcome: "pnpm eval:sync-registry populates graph_registry from catalog.ts. pnpm eval:registry shows per-graph eval coverage + latest Langfuse pass rates."
initiative: proj.agent-eval-registry
assignees: []
labels: [ai, evals, doltgres, registry, knowledge-plane]
branch:
pr:
reviewer:
created: 2026-04-06
updated: 2026-04-06
---

# task.0300 — Doltgres graph registry + eval coverage CLI

## Context

Langfuse owns eval data (datasets, experiments, scores). Doltgres owns the graph catalog (what agents exist). This task adds the Doltgres side: `graph_registry` + `sync_state` tables. No eval tables in Doltgres — Langfuse handles that via OSS.

See [proj.agent-eval-registry](../projects/proj.agent-eval-registry.md) for full architecture.

Depends on:

- task.0286 (eval harness) — Langfuse datasets/scores must exist before `eval:registry` can query them
- Doltgres running in canary (`DOLTGRES_CONNECTION_STRING` in env)

## Design Review Findings

Architecture review (2026-04-06) raised these points for implementation:

### 1. Package placement: knowledge-store is acceptable for P0

With only `graph_registry` + `sync_state` (no eval tables — Langfuse owns those), extending `@cogni/knowledge-store` is proportionate. A separate `packages/eval-registry/` is warranted only if eval tables move to Doltgres later (P1+).

### 2. Verify TEXT[] in Doltgres before using for tool_ids

The Doltgres spike (task.0231) tested JSONB, TEXT, INTEGER, TIMESTAMPTZ. `TEXT[]` is untested. Fallback: `tool_ids JSONB DEFAULT '[]'` with the same `LIKE '%"tool"%'` workaround used for knowledge table tags.

### 3. Sync is bootstrap + CLI (confirmed)

Runs on container start before app accepts traffic. CLI for manual use. Hash-based skip prevents wasted commits. If sync fails: log warning, continue (stale registry is degraded, not fatal).

### 4. Cross-node catalog (P1 — in project, not this task)

The cross-node `knowledge_registry` DB with `catalog_entries`, `access_policies`, `index_cursors` is designed and tracked in `proj.agent-eval-registry` P1 section. Invariant: `CROSS_NODE_VIA_REGISTRY_ONLY` — cross-node reads go through `RegistryCapability`, never direct cross-DB queries.

## Validation

```bash
# Sync graph_registry from catalog.ts
pnpm eval:sync-registry
# Expected: UPSERT N rows, dolt commit if changed, skip if unchanged

# Show eval coverage matrix (Doltgres catalog + Langfuse scores)
pnpm eval:registry
# Expected:
# graph_id            | tier     | langfuse_datasets | last_pass_rate
# langgraph:brain     | core     | 1 (brain-v1)      | 85%
# langgraph:pr-review | core     | 1 (pr-review-v1)  | 90%
# langgraph:poet      | core     | 0                 | —
# ...
```
