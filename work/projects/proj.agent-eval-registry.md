---
id: proj.agent-eval-registry
type: project
primary_charter: chr.evals
title: Agent Eval Registry — Langfuse-Primary Evals + Doltgres Graph Catalog
state: Done
priority: 1
estimate: 5
summary: "ABSORBED into proj.ai-evals-pipeline (P1.5 phase). Langfuse owns evals. Doltgres owns graph catalog. See proj.ai-evals-pipeline for the unified roadmap."
outcome: "Consolidated — all deliverables now tracked in proj.ai-evals-pipeline."
assignees: derekg1729
created: 2026-04-06
updated: 2026-04-06
labels: [ai, evals, doltgres, registry, langfuse, knowledge-plane]
---

# Agent Eval Registry — Langfuse-Primary Evals + Doltgres Graph Catalog

## Goal

Every AI graph is registered in Doltgres (what it is, what tools it has, what tier). Every eval run lives in Langfuse (scores, traces, experiments). No dual-write — each system owns its domain. Agents query both programmatically.

## Architecture: Langfuse for Evals, Doltgres for Catalog

```
Langfuse (OSS eval platform — don't reinvent)
  ├── Datasets        = eval test cases
  ├── Experiments     = eval runs per deployment
  ├── Scores          = pass/fail per case
  ├── Traces          = graph execution observability (already wired)
  └── Evaluators      = LLM-as-judge definitions
       ↑
       │ Langfuse SDK — agents read/write eval data
       │ Cogni UI queries Langfuse API → surfaces in project/task/agent views
       │
Doltgres (what Langfuse CAN'T do)
  └── graph_registry  = what agents exist, their tier, tools, status
       ↑
       │ Synced from catalog.ts (commit-cursor)
       │ dolt diff/log for registry evolution
       │ Cross-node discovery via SQL
```

### Why Not Dual-Write

The original design had 4 Doltgres tables (`graph_registry`, `eval_definitions`, `eval_runs`, `eval_results`). Three duplicated Langfuse:

| Doltgres table (removed) | Langfuse equivalent                     |
| ------------------------ | --------------------------------------- |
| ~~eval_definitions~~     | Langfuse evaluators (managed or custom) |
| ~~eval_runs~~            | Langfuse dataset experiments            |
| ~~eval_results~~         | Langfuse scores on dataset items        |
| `graph_registry` (kept)  | **Nothing** — Langfuse has no catalog   |

Building a parallel eval storage system violates OSS_OVER_BESPOKE. Langfuse already provides score history, experiment comparison, dataset management, trace-to-score linking, and evaluator definitions.

### How Agents Interact

Agents never need to open Langfuse's UI. They use the SDK:

```typescript
// Agent checks its own eval scores
const scores = await langfuse.getScores({ name: "brain-tool-accuracy" });
const passRate = scores.filter((s) => s.value === 1).length / scores.length;

// Agent adds an eval case when it observes a failure
await langfuse.createDatasetItem({
  datasetName: "brain-v1",
  input: { message: "..." },
  expectedOutput: { tool: "repo-search" },
});
```

Cogni UI (v-next) queries the same API to surface eval data in project/task/agent views. Nobody looks at Langfuse directly.

## Design

### Doltgres: graph_registry Only

One table in `@cogni/knowledge-store`. Every node inherits on fork.

```sql
CREATE TABLE graph_registry (
  graph_id       TEXT PRIMARY KEY,
  node_id        TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  description    TEXT,
  tier           TEXT NOT NULL,
  tool_ids       TEXT[],
  status         TEXT NOT NULL DEFAULT 'active',
  registered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sync_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Sync Pattern: Commit-Cursor

`catalog.ts` remains the single source of truth. Sync uses a commit-cursor:

```
catalog.ts changes → node redeploy → sync script → UPSERT graph_registry
  │
  │  Tracks: last_synced_catalog_hash in sync_state
  │  Skip if hash unchanged (idempotent)
  │
  ▼
dolt_commit("sync: graph registry from catalog @ {hash}")
```

### Eval Coverage Matrix

Combines graph_registry (Doltgres) with Langfuse scores (API):

```
pnpm eval:registry
  1. SELECT * FROM graph_registry  (what agents exist)
  2. langfuse.getDatasets()         (what eval datasets exist)
  3. langfuse.getDatasetRuns()      (latest pass rates)
  4. Print matrix: graph_id | tier | eval_cases | last_pass_rate
```

### Agent Lifecycle

```
1. Define graph     → catalog.ts entry → sync → graph_registry (Doltgres)
2. Error analysis   → run 30-50 prompts, review, categorize failures
3. Write eval cases → Langfuse datasets (via SDK)
4. Define evaluators → Langfuse evaluators (managed or custom prompts)
5. Run evals        → pnpm eval:canary → Langfuse experiments + scores
6. Score trends     → Langfuse SDK (agents) or Langfuse UI (debugging)
7. Improve prompt   → iterate, re-run, compare Langfuse experiments
8. User feedback    → thumbs down → Langfuse score → new dataset item
```

## Roadmap

### Crawl (P0) — Graph Registry + Langfuse Evals

**Goal:** graph_registry seeded in Doltgres. Eval harness writes to Langfuse. `pnpm eval:registry` combines both.

| Deliverable                                                        | Status      | Est | Work Item |
| ------------------------------------------------------------------ | ----------- | --- | --------- |
| `graph_registry` + `sync_state` tables in `@cogni/knowledge-store` | Not Started | 1   | task.0299 |
| Catalog sync script (catalog.ts → graph_registry, commit-cursor)   | Not Started | 1   | task.0299 |
| `pnpm eval:registry` — combined matrix (Doltgres + Langfuse API)   | Not Started | 1   | task.0299 |

### Walk (P1) — Agent Eval Tools + Cross-Node Discovery + Cogni UI

**Goal:** Agents query their own scores. Cross-node graph discovery. Cogni UI surfaces eval data.

| Deliverable                                                        | Status      | Est | Work Item            |
| ------------------------------------------------------------------ | ----------- | --- | -------------------- |
| `core__eval_scores` tool — agent queries own Langfuse scores       | Not Started | 1   | (create at P1 start) |
| `core__registry_search` tool — "who knows X?" (graph_registry SQL) | Not Started | 1   | (create at P1 start) |
| Cogni UI: eval data in project/agent views (Langfuse API)          | Not Started | 2   | (create at P1 start) |
| Grafana dashboard for eval scores (Langfuse API → Prometheus)      | Not Started | 1   | (create at P1 start) |

### Walk+ (P1.5) — Cross-Node Knowledge Catalog

**Goal:** Operator indexes knowledge metadata across all node Doltgres DBs.

| Deliverable                                              | Status      | Est | Work Item              |
| -------------------------------------------------------- | ----------- | --- | ---------------------- |
| `knowledge_registry` DB + catalog tables (operator-only) | Not Started | 2   | (create at P1.5 start) |
| `packages/knowledge-registry/` — RegistryPort + types    | Not Started | 2   | (create at P1.5 start) |
| Commit-cursor indexer (Temporal activity, per-node)      | Not Started | 2   | (create at P1.5 start) |
| `core__knowledge_federated_search` tool — cross-node     | Not Started | 2   | (create at P1.5 start) |

### Run (P2) — DoltHub Sync + DAO Governance + Tier 1 Nodes

**Goal:** DoltHub remotes. DAO-scoped access. Registry node as Tier 1.

| Deliverable                                        | Status      | Est | Work Item            |
| -------------------------------------------------- | ----------- | --- | -------------------- |
| DoltHub sync (push per-node + registry DBs)        | Not Started | 2   | (create at P2 start) |
| DAO access policies + visibility controls          | Not Started | 2   | (create at P2 start) |
| Registry node (Tier 1: Dolt + graphs only, no app) | Not Started | 3   | (create at P2 start) |
| x402 permissioned access to registry data          | Not Started | 3   | (create at P2 start) |

## Constraints

- **LANGFUSE_OWNS_EVALS** — eval data (datasets, experiments, scores, evaluators) lives in Langfuse. No bespoke eval tables in Doltgres.
- **DOLTGRES_OWNS_CATALOG** — graph registry (what agents exist) lives in Doltgres. Langfuse has no concept of an agent catalog.
- **NO_DUAL_WRITE** — each system owns its domain. Eval harness → Langfuse. Sync script → Doltgres. No overlap.
- **CATALOG_SINGLE_SOURCE_OF_TRUTH** — `catalog.ts` remains the definition source. `graph_registry` is a sync target.
- **AGENTS_USE_SDK** — agents query Langfuse via SDK, not UI. Cogni UI surfaces Langfuse data via API.
- **COMMIT_CURSOR_INDEXING** — registry sync by hash cursor, not wall-clock polling.
- **CROSS_NODE_VIA_REGISTRY_ONLY** — cross-node knowledge access goes through RegistryCapability (P1.5).
- **NODE_SOVEREIGNTY** — nodes control their own Doltgres DBs. Registry reads, never writes to node DBs.

## Dependencies

- **proj.ai-evals-pipeline** (task.0286) — eval harness must exist before eval:registry can combine scores
- **`@cogni/knowledge-store`** — Doltgres adapter must be deployed
- **Doltgres in canary docker-compose** — needs `DOLTGRES_CONNECTION_STRING` in canary env
- **Langfuse Cloud** — API keys for all environments (already exist)

## As-Built Specs

- [Knowledge Data Plane](../../docs/spec/knowledge-data-plane.md) — two-plane architecture, Doltgres rationale
- [AI Evals Spec](../../docs/spec/ai-evals.md) — eval invariants and conventions

## Related

- [proj.ai-evals-pipeline](proj.ai-evals-pipeline.md) — eval harness that writes to Langfuse
- [proj.agent-registry](proj.agent-registry.md) — runtime discovery (Paused, orthogonal)
- [EVALS Charter](../charters/EVALS.md) — eval program principles, per-node matrix
- [story.0248](../items/story.0248.dolt-branching-cicd.md) — Dolt branching (deferred)

## Design Notes

### Node Tier Model (Future)

| Tier   | What it is           | Infrastructure                                               |
| ------ | -------------------- | ------------------------------------------------------------ |
| Tier 1 | Knowledge/agent-only | Dolt tables + LangGraph graphs + Temporal schedules. No app. |
| Tier 2 | Service node         | Lightweight APIs/workers when needed                         |
| Tier 3 | Product node         | Full app deployment (Next.js UI, auth, billing)              |

### Relationship to proj.agent-registry

`proj.agent-registry` (Paused) = **runtime discovery** (TypeScript: `AgentCatalogPort`, `/api/v1/ai/agents`).

This project = **persistent catalog + quality tracking** (SQL: `graph_registry` + Langfuse SDK for scores).

Complementary. Runtime catalog serves the API. Doltgres registry tracks what exists. Langfuse tracks how well it works.
