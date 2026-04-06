---
id: proj.agent-eval-registry
type: project
primary_charter: chr.evals
title: Agent Eval Registry — Doltgres-Native Graph Catalog + Score Matrix
state: Active
priority: 1
estimate: 5
summary: Doltgres tables for graph registry + eval definitions + eval runs + eval results. Every node inherits the schema. Eval harness writes to Doltgres alongside Langfuse. Version-tracked agent quality. Nucleus of the registry node.
outcome: Every graph has registered KPIs in Doltgres. Every eval run is a dolt commit. Score trends queryable via SQL. Cross-node capability discovery via the registry tables.
assignees: derekg1729
created: 2026-04-06
updated: 2026-04-06
labels: [ai, evals, doltgres, registry, knowledge-plane]
---

# Agent Eval Registry — Doltgres-Native Graph Catalog + Score Matrix

## Goal

Every AI graph in the system has a versioned quality record in Doltgres. New graph → register it → define KPIs → measure → improve → repeat. Dolt gives us git-for-agent-quality: diff between runs, log score evolution, branch to test new prompts.

This is not a new node. It's 4 tables added to every node's existing Doltgres knowledge store. The "registry node" emerges later as a cross-node aggregator — but the schema is the same.

## Why Doltgres (Not Just Langfuse)

Langfuse is the eval UI — trace analysis, experiment comparison, score visualization. Keep it.

Doltgres adds what Langfuse can't:

| Capability                        | SQL                                                         |
| --------------------------------- | ----------------------------------------------------------- |
| Diff between eval runs            | `SELECT * FROM dolt_diff('HEAD~1', 'HEAD', 'eval_results')` |
| Score evolution over time         | `SELECT * FROM dolt_log ORDER BY date DESC`                 |
| Pin eval to exact code state      | `SELECT hashof('HEAD')` → store as commit ref               |
| Branch a dataset, test new prompt | `SELECT dolt_checkout('-b', 'experiment/prompt-v4')`        |
| Cross-node query                  | `SELECT * FROM graph_registry WHERE pass_rate < 0.7`        |
| Fork inheritance                  | New node forks → inherits graph registry + eval history     |

**Dual-write pattern:** eval harness writes to both Langfuse (UI) and Doltgres (versioned history).

## Design

### Key Decision: Extend `@cogni/knowledge-store`, Don't Build a New Node

The `KnowledgeStorePort` + `DoltgresKnowledgeStoreAdapter` already exist in `packages/knowledge-store/`. Every node already has a Doltgres connection. The simplest path: add 4 tables to the knowledge-store schema. Every node inherits them on fork.

**Rejected alternative:** Create a separate "registry node" (Tier 1). This adds a new deployment, new infra, cross-node networking. Overkill for P0. The registry node pattern emerges naturally at P2 when cross-node querying is needed — at that point it's a read-only aggregator over existing per-node tables.

### Schema: 4 Seed Tables

```sql
-- What agents exist (synced from catalog.ts on startup)
CREATE TABLE graph_registry (
  graph_id       TEXT PRIMARY KEY,     -- "langgraph:brain"
  node_id        TEXT NOT NULL,        -- from repo-spec.yaml
  display_name   TEXT NOT NULL,
  description    TEXT,
  tier           TEXT NOT NULL,        -- core | extended | operator
  tool_ids       TEXT[],               -- tools this graph uses
  status         TEXT NOT NULL DEFAULT 'active',  -- active | deprecated | experimental
  registered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- What we measure per agent (KPIs)
CREATE TABLE eval_definitions (
  eval_id        TEXT PRIMARY KEY,     -- "brain-tool-selection-001"
  graph_id       TEXT NOT NULL REFERENCES graph_registry(graph_id),
  name           TEXT NOT NULL,        -- "tool-selection-accuracy"
  eval_type      TEXT NOT NULL,        -- code | llm_judge | human
  criterion      TEXT NOT NULL,        -- plain english: what's being checked
  pass_condition TEXT NOT NULL,        -- how to determine pass/fail
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- When we measured (per deployment / eval run)
CREATE TABLE eval_runs (
  run_id         TEXT PRIMARY KEY,
  environment    TEXT NOT NULL,        -- canary | preview | production | local
  commit_sha     TEXT,                 -- git commit being evaluated
  model_id       TEXT,                 -- model used for graph execution
  judge_model_id TEXT,                 -- model used for LLM-as-judge
  total_cases    INT NOT NULL,
  passed         INT NOT NULL,
  failed         INT NOT NULL,
  pass_rate      REAL NOT NULL,        -- passed / total_cases
  started_at     TIMESTAMPTZ NOT NULL,
  completed_at   TIMESTAMPTZ
);

-- Individual case outcomes
CREATE TABLE eval_results (
  result_id      TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES eval_runs(run_id),
  eval_id        TEXT NOT NULL REFERENCES eval_definitions(eval_id),
  input_summary  TEXT,                 -- truncated input (not full prompt)
  passed         BOOLEAN NOT NULL,
  latency_ms     INT,
  judge_verdict  TEXT,                 -- PASS | FAIL (from LLM judge)
  judge_reasoning TEXT,                -- null for code evals
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Sync Pattern: catalog.ts → graph_registry

On node startup (or `pnpm eval:sync-registry`):

```typescript
// Read LANGGRAPH_CATALOG from @cogni/langgraph-graphs
// UPSERT into graph_registry table
// dolt_commit("sync graph registry from catalog.ts")
```

This keeps `catalog.ts` as the single source of truth for graph definitions (CATALOG_SINGLE_SOURCE_OF_TRUTH invariant) while making the data queryable via SQL.

### Eval Harness Integration

The eval harness (task.0286) gains one additional output:

```
After running evals:
  1. Push to Langfuse (UI, trace analysis)       ← existing
  2. INSERT into eval_runs + eval_results         ← new
  3. dolt_commit("eval run {run_id}: {pass_rate}% on {environment}")  ← new
```

### Node Eval Matrix (from EVALS charter)

The `graph_registry` + `eval_definitions` tables ARE the node eval matrix. Query:

```sql
-- Per-node eval coverage matrix
SELECT
  gr.graph_id,
  gr.display_name,
  gr.tier,
  COUNT(ed.eval_id) AS eval_count,
  COUNT(CASE WHEN ed.eval_type = 'code' THEN 1 END) AS code_evals,
  COUNT(CASE WHEN ed.eval_type = 'llm_judge' THEN 1 END) AS judge_evals
FROM graph_registry gr
LEFT JOIN eval_definitions ed ON gr.graph_id = ed.graph_id
GROUP BY gr.graph_id, gr.display_name, gr.tier
ORDER BY gr.tier, gr.display_name;
```

### Agent Lifecycle (Create → Measure → Improve)

```
1. Define graph     → catalog.ts entry → sync → INSERT graph_registry
2. Define KPIs      → INSERT eval_definitions (what to measure, pass condition)
3. Error analysis   → run 30-50 prompts, review, categorize failures
4. Write eval cases → JSON datasets + eval_definitions rows
5. Run evals        → pnpm eval:canary → INSERT eval_runs + eval_results → dolt commit
6. Score trends     → dolt log on eval_runs (pass_rate over time)
7. Improve prompt   → iterate, re-run, dolt diff shows delta
8. User feedback    → thumbs down → new eval case → new eval_definition
9. Branch test      → dolt_checkout experiment branch → eval → merge if improved
```

## Roadmap

### Crawl (P0) — Seed Tables + Sync + Dual-Write

**Goal:** 4 tables seeded in every node's Doltgres. Eval harness writes there.

| Deliverable                                        | Status      | Est | Work Item |
| -------------------------------------------------- | ----------- | --- | --------- |
| Add 4 tables to `@cogni/knowledge-store` schema    | Not Started | 2   | task.0299 |
| Registry sync script (catalog.ts → graph_registry) | Not Started | 1   | task.0299 |
| Eval harness dual-write (Langfuse + Doltgres)      | Not Started | 1   | task.0299 |
| Seed eval_definitions for brain + pr-review        | Not Started | 1   | task.0299 |
| `pnpm eval:registry` — print eval coverage matrix  | Not Started | —   | task.0299 |

### Walk (P1) — Query API + Score Trends

**Goal:** Agents can query the registry. Score trends visible.

| Deliverable                                              | Status      | Est | Work Item            |
| -------------------------------------------------------- | ----------- | --- | -------------------- |
| `core__registry_search` tool — "who knows X?"            | Not Started | 2   | (create at P1 start) |
| `core__registry_scores` tool — "what's below threshold?" | Not Started | 1   | (create at P1 start) |
| Score trend view (dolt log + pass_rate over time)        | Not Started | 1   | (create at P1 start) |
| Grafana dashboard for eval scores                        | Not Started | 1   | (create at P1 start) |

### Run (P2) — Cross-Node Registry + Tier 1 Nodes

**Goal:** Registry node aggregates across all nodes. Tier 1 node concept proven.

| Deliverable                                                | Status      | Est | Work Item            |
| ---------------------------------------------------------- | ----------- | --- | -------------------- |
| Registry node (Tier 1: Dolt + graphs only, no app)         | Not Started | 3   | (create at P2 start) |
| Cross-node graph_registry sync (dolt_push/pull)            | Not Started | 2   | (create at P2 start) |
| "Who knows X?" across all nodes                            | Not Started | 2   | (create at P2 start) |
| x402 permissioned access to registry data                  | Not Started | 3   | (create at P2 start) |
| Dolt branch eval: test prompt on branch, merge if improved | Not Started | 2   | (create at P2 start) |

## Constraints

- **CATALOG_SINGLE_SOURCE_OF_TRUTH** — `catalog.ts` remains the definition source. `graph_registry` is a sync target, not a replacement.
- **Knowledge-store is the owner** — registry tables live in `@cogni/knowledge-store`, not a new package. Same Doltgres connection, same adapter.
- **No new node in P0** — extend existing infrastructure. Registry node is P2.
- **Dual-write, not replace** — Langfuse stays for UI. Doltgres for versioned history + SQL queries.
- **PORT_BEFORE_BACKEND** — new tables accessed via extended `KnowledgeStorePort` or a new `EvalRegistryPort`.

## Dependencies

- **proj.ai-evals-pipeline** (task.0286) — eval harness must exist before dual-write can work
- **`@cogni/knowledge-store`** — Doltgres adapter must be deployed (currently in node-template)
- **Doltgres in canary docker-compose** — needs `DOLTGRES_CONNECTION_STRING` in canary env

## As-Built Specs

- [Knowledge Data Plane](../docs/spec/knowledge-data-plane.md) — two-plane architecture, Doltgres rationale
- [AI Evals Spec](../docs/spec/ai-evals.md) — eval invariants and conventions

## Related

- [proj.ai-evals-pipeline](proj.ai-evals-pipeline.md) — eval harness that writes to this registry
- [proj.agent-registry](proj.agent-registry.md) — discovery/execution split (Paused, orthogonal)
- [EVALS Charter](../charters/EVALS.md) — eval program principles, per-node matrix
- [story.0248](../items/story.0248.dolt-branching-cicd.md) — Dolt branching CI/CD experiment

## Design Notes

### Node Tier Model (Future — not this project's scope)

The user's vision for node tiers:

| Tier   | What it is           | Infrastructure                                               |
| ------ | -------------------- | ------------------------------------------------------------ |
| Tier 1 | Knowledge/agent-only | Dolt tables + LangGraph graphs + Temporal schedules. No app. |
| Tier 2 | Service node         | Lightweight APIs/workers when needed                         |
| Tier 3 | Product node         | Full app deployment (Next.js UI, auth, billing)              |

Current nodes (operator, poly, resy) are all Tier 3. The registry node would be the first Tier 1 node. This project doesn't build Tier 1 infrastructure — it builds the schema that Tier 1 nodes will consume.

### Relationship to proj.agent-registry

`proj.agent-registry` (Paused) focuses on **runtime discovery** — how the app finds and lists agents at request time. It lives in TypeScript: `AgentCatalogPort`, `AgentDescriptor`, `/api/v1/ai/agents`.

This project focuses on **persistent quality tracking** — how we store and version agent KPIs over time. It lives in SQL: `graph_registry`, `eval_definitions`, `eval_runs`, `eval_results`.

They're complementary. The runtime catalog serves the API. The Doltgres registry tracks quality.
