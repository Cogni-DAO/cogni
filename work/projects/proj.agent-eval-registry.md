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

### Two Layers, Same Doltgres Server

```
Shared Doltgres Server (doltgres:5435)
│
├── knowledge_operator        ← operator's knowledge + eval tables (P0)
├── knowledge_poly            ← poly's knowledge + eval tables (P0)
├── knowledge_resy            ← resy's knowledge + eval tables (P0)
│     Each contains: knowledge, graph_registry, eval_definitions,
│                    eval_runs, eval_results
│
└── knowledge_registry        ← cross-node catalog (P1, operator-only)
      Contains: catalog_entries, access_policies, index_cursors
      Indexes metadata from all node DBs. Never stores content.
```

**P0: Per-node eval tables** — extend `@cogni/knowledge-store` with 4 tables. Every node inherits on fork. No new package.

**P1: Cross-node catalog** — separate `knowledge_registry` DB + `packages/knowledge-registry/` package. Lives inside operator's deployment with hard domain boundary. Indexes across all node DBs via commit-cursor model.

### Key Decision: Extend `@cogni/knowledge-store` for P0, New Package for P1

The `KnowledgeStorePort` + `DoltgresKnowledgeStoreAdapter` already exist. Every node has a Doltgres connection. P0 adds 4 eval tables to the existing schema — every node inherits them on fork.

P1 introduces the cross-node catalog as a **separate domain** (`packages/knowledge-registry/`) because it has fundamentally different responsibilities: indexing across databases, access control, brokered reads. Keeping it separate preserves the extraction path to a standalone node at P2.

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

### Sync Pattern: Commit-Cursor, Not Startup-Only

`catalog.ts` remains the single source of truth (CATALOG_SINGLE_SOURCE_OF_TRUTH). The sync to `graph_registry` uses a **commit-cursor model** — not just "run on startup":

```
catalog.ts changes → node redeploy → sync script runs → UPSERT graph_registry
  │
  │  Tracks sync state:
  │  - last_synced_catalog_hash (SHA of serialized LANGGRAPH_CATALOG)
  │  - Skip if hash unchanged (idempotent, no wasted commits)
  │
  ▼
dolt_commit("sync: graph registry from catalog @ {hash}")
```

The same cursor model applies to the cross-node knowledge catalog (P1). Each node's knowledge DB tracks its last-indexed commit; the operator's registry indexes by diffing from that cursor — no wall-clock polling, no drift window.

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

### Walk (P1) — Cross-Node Knowledge Catalog + Query API

**Goal:** Operator hosts a `knowledge_registry` database that indexes metadata across all node knowledge DBs. Agents query the registry for cross-node discovery. Score trends visible.

The registry is a **separate domain inside operator** — own package, tables, workflows, APIs — but deployed within operator. Hard domain boundary preserves future extraction to a standalone node.

#### Cross-Node Catalog Tables (in `knowledge_registry` DB on shared Doltgres)

```sql
-- Metadata index across all node knowledge DBs (content stays at source)
CREATE TABLE catalog_entries (
  id TEXT PRIMARY KEY,                     -- sha256(node_id + knowledge_id)
  node_id TEXT NOT NULL,
  knowledge_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  title TEXT NOT NULL,
  confidence_pct INTEGER,
  source_type TEXT NOT NULL,
  tags JSONB DEFAULT '[]',
  content_hash TEXT NOT NULL,              -- sha256 of content (dedup)
  owner_scope_id TEXT,                     -- DAO scope (nullable)
  visibility TEXT NOT NULL DEFAULT 'node', -- node | network | public
  source_url TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL,
  indexed_at TIMESTAMPTZ DEFAULT NOW(),
  source_commit TEXT NOT NULL,             -- dolt commit on source node
  UNIQUE(node_id, knowledge_id)
);

-- DAO access policies for cross-node reads
CREATE TABLE access_policies (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  access_level TEXT NOT NULL,              -- read | write | admin
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Commit cursor per node (indexer state)
CREATE TABLE index_cursors (
  node_id TEXT PRIMARY KEY,
  node_db_name TEXT NOT NULL,
  last_indexed_commit TEXT NOT NULL,
  last_indexed_at TIMESTAMPTZ NOT NULL,
  entry_count INTEGER DEFAULT 0
);
```

#### Cross-Node Access Invariant

```
CROSS_NODE_VIA_REGISTRY_ONLY:
  Same-node reads  → direct via KnowledgeStorePort (unchanged)
  Cross-node reads → MUST go through RegistryCapability (new)
  No direct cross-database queries from agent tools
```

| Deliverable                                                   | Status      | Est | Work Item            |
| ------------------------------------------------------------- | ----------- | --- | -------------------- |
| `knowledge_registry` DB + 3 catalog tables in provisioning    | Not Started | 2   | (create at P1 start) |
| `packages/knowledge-registry/` — RegistryPort + types         | Not Started | 2   | (create at P1 start) |
| Commit-cursor indexer (Temporal activity, per-node)           | Not Started | 2   | (create at P1 start) |
| `core__knowledge_federated_search` tool — cross-node brokered | Not Started | 2   | (create at P1 start) |
| `core__registry_scores` tool — "what's below threshold?"      | Not Started | 1   | (create at P1 start) |
| Score trend view (dolt log + pass_rate over time)             | Not Started | 1   | (create at P1 start) |
| Grafana dashboard for eval scores                             | Not Started | 1   | (create at P1 start) |

### Run (P2) — DoltHub Sync + DAO Governance + Tier 1 Nodes

**Goal:** DoltHub remote sync. DAO-scoped access policies. Registry node emerges as Tier 1.

| Deliverable                                                | Status      | Est | Work Item            |
| ---------------------------------------------------------- | ----------- | --- | -------------------- |
| DoltHub sync (push per-node + registry DBs)                | Not Started | 2   | (create at P2 start) |
| DAO access policies + visibility controls                  | Not Started | 2   | (create at P2 start) |
| Registry node (Tier 1: Dolt + graphs only, no app)         | Not Started | 3   | (create at P2 start) |
| x402 permissioned access to registry data                  | Not Started | 3   | (create at P2 start) |
| Dolt branch eval: test prompt on branch, merge if improved | Not Started | 2   | (create at P2 start) |

## Constraints

- **CATALOG_SINGLE_SOURCE_OF_TRUTH** — `catalog.ts` remains the definition source. `graph_registry` is a sync target, not a replacement.
- **Knowledge-store is the owner (P0)** — eval tables live in `@cogni/knowledge-store`, not a new package. Same Doltgres connection, same adapter.
- **Registry is a separate domain (P1)** — cross-node catalog lives in `packages/knowledge-registry/` with own port, types, contracts. Hard domain boundary inside operator's deployment — preserves future extraction to standalone node.
- **CROSS_NODE_VIA_REGISTRY_ONLY** — cross-node knowledge access goes exclusively through RegistryCapability. No direct cross-database queries from agent tools.
- **COMMIT_CURSOR_INDEXING** — registry indexes by dolt commit cursor, not wall-clock polling. No drift window, no wasted polls.
- **REGISTRY_INDEXES_NOT_STORES** — catalog contains metadata + content_hash, never content. Source node DBs remain sovereign.
- **NODE_SOVEREIGNTY** — nodes control their own knowledge DBs. Registry reads, never writes to node DBs.
- **No new node in P0/P1** — extend existing infrastructure. Registry node is P2.
- **Dual-write, not replace** — Langfuse stays for eval UI. Doltgres for versioned history + SQL queries.
- **PORT_BEFORE_BACKEND** — eval tables accessed via `EvalRegistryPort`. Cross-node catalog via `RegistryPort`.

## Dependencies

- **proj.ai-evals-pipeline** (task.0286) — eval harness must exist before dual-write can work
- **`@cogni/knowledge-store`** — Doltgres adapter must be deployed (currently in node-template)
- **Doltgres in canary docker-compose** — needs `DOLTGRES_CONNECTION_STRING` in canary env

## As-Built Specs

- [Knowledge Data Plane](../../docs/spec/knowledge-data-plane.md) — two-plane architecture, Doltgres rationale
- [Knowledge Syntropy](../../docs/spec/knowledge-syntropy.md) — storage/retrieval protocol, citation DAGs
- [AI Evals Spec](../../docs/spec/ai-evals.md) — eval invariants and conventions
- Knowledge Registry Spec — TBD (formalize P1 cross-node catalog design)

## Related

- [proj.ai-evals-pipeline](proj.ai-evals-pipeline.md) — eval harness that writes to this registry
- [proj.agent-registry](proj.agent-registry.md) — runtime discovery (Paused, orthogonal)
- [EVALS Charter](../charters/EVALS.md) — eval program principles, per-node matrix
- [story.0248](../items/story.0248.dolt-branching-cicd.md) — Dolt branching (deferred, separate complexity)
- [story.0263](../items/story.0263.doltgres-node-lifecycle.md) — Dolt remotes (deferred, DoltHub sync at P2)
- [DATA_STREAMS Charter](../charters/DATA_STREAMS.md) — data source maturity scorecard

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
