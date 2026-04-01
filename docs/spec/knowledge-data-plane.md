---
id: knowledge-data-plane-spec
type: spec
title: "Knowledge Data Plane — Doltgres-Backed Expertise for Node-Template"
status: draft
spec_state: draft
trust: draft
summary: "Separates hot operational awareness (Postgres) from cold curated knowledge (Doltgres). The awareness plane owns what the AI sees right now. The knowledge plane owns what the AI has learned — strategies, prompt versions, evaluations, evidence. Doltgres is a Postgres drop-in with git-like versioning (commit, log, diff). Same Drizzle schemas, same pg driver — just add commit/push/sync workflows."
read_when: Designing a knowledge store for a Cogni node, choosing where data lives (awareness vs knowledge), understanding the promotion boundary, or forking the node-template.
implements:
owner: derekg1729
created: 2026-03-31
verified:
tags: [knowledge, dolt, node-template, awareness, data-plane, cogni-template]
---

# Knowledge Data Plane — Doltgres-Backed Expertise for Node-Template

> Awareness is what you see. Knowledge is what you've learned. Don't store them in the same place.

### Key References

|                      |                                                                             |                                               |
| -------------------- | --------------------------------------------------------------------------- | --------------------------------------------- |
| **Awareness Plane**  | [monitoring-engine spec](./monitoring-engine.md)                            | ObservationEvent, triggers, signals, outcomes |
| **Prior Research**   | spike.0137 (branch `docs/spike-0137-knowledge-store`)                       | Three-layer knowledge architecture            |
| **Prior Design**     | proj.knowledge-store (branch `docs/spike-0137-knowledge-store`)             | Postgres-based entity/relation/observation    |
| **Market Provider**  | [market-provider AGENTS.md](../../packages/market-provider/AGENTS.md)       | Polymarket + Kalshi adapters                  |
| **Poly Project**     | [proj.poly-prediction-bot](../../work/projects/proj.poly-prediction-bot.md) | First domain consuming both planes            |
| **Node vs Operator** | [node-operator-contract](./node-operator-contract.md)                       | Fork freedom, data sovereignty                |

## Goal

Enable Cogni nodes to accumulate domain expertise — strategies, prompt versions, evaluations, evidence — in a versioned knowledge store that is architecturally separate from the hot awareness pipeline. Adding a new domain's expertise requires only seed data; the schema is generic. The port abstraction enables a future migration from Postgres to Dolt when branching, fork inheritance, and cross-node sharing are needed.

## Design

### Problem

The monitoring-engine spec defines an awareness plane — observation events, trigger evaluation, AI analysis runs, scored signals, calibration outcomes. All of this is hot operational data: append-only, high-frequency, domain-specific, stored in Postgres.

But there's a second class of data that accumulates slower and has different lifecycle needs:

- **Strategies** — named decision approaches (e.g., "base-rate-anchored calibrated analyst")
- **Prompt versions** — the actual system prompts, versioned, diffable
- **Evaluations** — which strategy+prompt versions performed against what outcomes
- **Evidence references** — curated pointers to external research, papers, data sources
- **Playbooks** — operational runbooks ("if market shows X pattern, consider Y")
- **Knowledge claims** — curated assertions the system believes to be true, with provenance

This data is:

- **Mutable** — strategies evolve, prompts get refined, claims get corrected
- **Versioned** — you need to know what changed, when, and why
- **Forkable** — when a node forks the template, it should inherit the knowledge base
- **Experimental** — you want to branch, test a new prompt on a branch, eval it, merge if it works
- **Shareable** — validated knowledge can flow between nodes (operator → node, node → operator)

Plain Postgres can serve this with append-only version rows, but it gets clumsy — manual `version` columns, `valid_from`/`valid_to` ranges, and audit triggers recreate what a version-controlled database gives you natively. **Doltgres** solves this: it's a Postgres-compatible drop-in with native git-like versioning (commit, log, diff, branch, merge). Same wire protocol, same Drizzle schemas, same `postgres` driver. The only additions are Dolt-specific SQL functions for versioning workflows.

---

## Design: Two Planes, Two Tempos

```
┌────────────────────────────────────────────────────────┐
│                     POSTGRES                            │
│  "Hot + immutable data, users, operations"             │
│                                                        │
│  Existing: auth, billing, ai, scheduling, identity,   │
│            reservations, attribution, ingestion        │
│            (see db-schema/src/*.ts)                    │
│                                                        │
│  Awareness tables (monitoring-engine spec, not yet     │
│  implemented): observation_events, analysis_runs,     │
│  analysis_signals, analysis_outcomes, base_rates      │
│                                                        │
│  Tempo: real-time to minutes                           │
│  Mutability: append-only / operational                 │
└──────────────────────────┬─────────────────────────────┘
                           │
                    Promotion Gate
                    (reviewed, repeated, or outcome-backed)
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                    DOLTGRES                              │
│  "Compounding memory — what the AI has learned"        │
│                                                        │
│  Starter kit: knowledge, strategies, ...               │
│  Grows as the node accumulates expertise               │
│                                                        │
│  Tempo: hours to days                                  │
│  Mutability: versioned (dolt_commit, dolt_log, diff)   │
└────────────────────────────────────────────────────────┘
```

**Postgres** is for hot/immutable data and operational concerns: user accounts, billing, auth, scheduling, append-only ingestion receipts, and (per [monitoring-engine spec](./monitoring-engine.md)) the awareness pipeline tables. These are defined in `packages/db-schema/src/` and the monitoring-engine spec respectively — this spec does not own them.

**Doltgres** is for compounding memory: domain-specific knowledge, strategies, and (eventually) versioned prompts that accumulate and evolve over time. Version-controlled natively. The table set is a starter kit that grows as the node matures — not a fixed schema.

---

## Why Doltgres

Doltgres is a Postgres-compatible database with native git-like versioning. It's a **drop-in replacement** — same wire protocol, same SQL, same Drizzle ORM, same `postgres` driver. The only additions are Dolt-specific SQL functions for versioning.

| Capability            | What Doltgres adds                                          |
| --------------------- | ----------------------------------------------------------- |
| Version history       | `SELECT * FROM dolt_log ORDER BY date DESC`                 |
| Commit changes        | `SELECT dolt_commit('-Am', 'added poly strategy v2')`       |
| Diff two versions     | `SELECT * FROM dolt_diff('HEAD~1', 'HEAD', 'strategies')`   |
| Pin analysis to state | `SELECT hashof('HEAD')` → store as `knowledge_commit`       |
| Audit by default      | Every commit has author + message + timestamp               |
| Future: branching     | `SELECT dolt_checkout('-b', 'experiment/prompt-v4')`        |
| Future: remotes       | `SELECT dolt_push('origin', 'main')` for cross-node sharing |

**What stays the same:** Drizzle table definitions, `postgres` driver, existing Drizzle migration tooling, testcontainer patterns, `@cogni/db-client` factory. The knowledge schema is standard Postgres DDL.

**What's new:** Workflows for committing, logging, and (future) pushing/syncing knowledge data. These are additional SQL calls, not a different database engine.

### MVP Scope

Single branch (`main`), commit-based versioning. Read, write, commit, log, diff. No branching, no remotes, no merge workflows. Get comfortable with Doltgres's commit model first.

### Versioning Workflows

**After writes — commit:**

```sql
-- Standard Drizzle INSERT (unchanged)
INSERT INTO strategies (id, domain, name, ...) VALUES (...);
INSERT INTO strategy_versions (id, strategy_id, version, ...) VALUES (...);
-- Then commit the change
SELECT dolt_commit('-Am', 'add calibrated market analyst strategy v1');
```

**Audit — log:**

```sql
SELECT * FROM dolt_log ORDER BY date DESC LIMIT 10;
```

**Diff — what changed:**

```sql
SELECT * FROM dolt_diff('HEAD~1', 'HEAD', 'prompt_versions');
```

**Pin analysis to knowledge state:**

```sql
SELECT hashof('HEAD') as knowledge_commit;
-- Store in analysis_runs.knowledge_commit for reproducibility
```

### Relationship to Prior Work

The spike.0137 research identified a three-layer architecture (raw → claims → canonical). The proj.knowledge-store design placed all layers in plain Postgres. This spec refines that by:

1. Clarifying the awareness/knowledge boundary (which the prior design blurred)
2. Using Doltgres for the knowledge layer (native versioning instead of manual version columns)
3. Using a simpler schema (strategies/prompts/evaluations — the immediate need)

Layer 0 (raw archive) stays in plain Postgres — it's append-only and benefits from Postgres's ecosystem (TimescaleDB, RLS).

---

## The Split: Polymarket Intelligence vs Node-Template Knowledge

This is the critical architectural boundary. Getting it wrong means either:

- Poly-specific data leaks into the generic template (every fork inherits prediction market tables), or
- Generic capabilities get trapped in domain-specific code (other domains can't reuse strategy versioning)

### What stays in Postgres

Everything that exists today (`packages/db-schema/src/*.ts`) plus the awareness pipeline tables defined in the [monitoring-engine spec](./monitoring-engine.md). This spec does not define or own any Postgres tables — it only defines the Doltgres knowledge tables below.

### What lives in Doltgres (knowledge plane)

Curated expertise that compounds over time. The table set is a **starter kit** — not a fixed schema. New tables are added as the node matures. Domain specificity lives in row content, not table structure.

**MVP — domain knowledge (immediate value):**

| Table       | Purpose                                                               |
| ----------- | --------------------------------------------------------------------- |
| `knowledge` | Domain-specific facts, claims, and curated assertions with provenance |

**Next — strategies (Walk phase):**

| Table                  | Purpose                                      |
| ---------------------- | -------------------------------------------- |
| `strategies`           | Named decision approaches with metadata      |
| `strategy_versions`    | Versioned content: params, thresholds, notes |
| `strategy_evaluations` | Eval results linking versions to outcomes    |

**Later — prompts (Run phase, with Langfuse integration):**

Versioned prompts live in Langfuse for prompt engineering workflows. Doltgres stores the durable archive and cross-node distribution. Exact schema TBD when Run phase starts.

### Domain Extension Pattern

Domains don't add tables to the knowledge plane. They add **rows with domain-specific content**:

```sql
-- Generic schema, domain-specific content
INSERT INTO strategies (id, domain, name, description)
VALUES ('poly-calibrated-analyst', 'prediction-market',
        'Calibrated Market Analyst',
        'Base rate -> news update -> fair probability -> thesis');

INSERT INTO strategy_versions (strategy_id, version, prompt_ref, params)
VALUES ('poly-calibrated-analyst', 1, 'poly-synth-prompt',
        '{"triggerThresholdBps": 500, "confidenceFloor": 40}');

-- Same schema, different domain
INSERT INTO strategies (id, domain, name, description)
VALUES ('infra-anomaly-detector', 'infrastructure',
        'Anomaly Detector',
        'Baseline -> deviation -> root cause -> severity');
```

If a domain truly needs domain-specific columns, it adds a **companion table** (e.g., `poly_market_categories` for prediction market category taxonomy). But the core knowledge schema stays generic.

---

## Knowledge Schema

Postgres-native types, snake_case columns, Drizzle conventions. Doltgres is Postgres-compatible, so these work unchanged. The schema is a **starter kit** — tables are added as the node's needs grow.

### `knowledge` — domain-specific facts and claims (MVP)

The immediately most valuable table. Curated domain knowledge that agents reference during reasoning.

| Column           | Type        | Constraints           | Description                                                     |
| ---------------- | ----------- | --------------------- | --------------------------------------------------------------- |
| `id`             | text        | PK                    | Deterministic or human-readable                                 |
| `domain`         | text        | NOT NULL              | `prediction-market`, `reservations`, `infrastructure`, etc.     |
| `entity_id`      | text        |                       | Stable subject key (optional — not all knowledge has a subject) |
| `title`          | text        | NOT NULL              | Human-readable summary                                          |
| `content`        | text        | NOT NULL              | The knowledge claim or fact                                     |
| `confidence_pct` | integer     |                       | 0–100 (null if not applicable)                                  |
| `source_type`    | text        | NOT NULL              | `human`, `analysis_signal`, `external`, `derived`               |
| `source_ref`     | text        |                       | Pointer to origin (signal ID, URL, paper, etc.)                 |
| `tags`           | jsonb       |                       | Searchable tags                                                 |
| `created_at`     | timestamptz | NOT NULL, default now |                                                                 |

Examples:

- `{ domain: "prediction-market", title: "Fed rate cut base rate", content: "Historical frequency of Fed rate cuts in election years is ~35%", source_type: "external", source_ref: "https://..." }`
- `{ domain: "reservations", title: "Le Bernardin cancellation pattern", content: "Cancellations spike 24h before for Tuesday-Thursday prime slots", source_type: "derived" }`

### Future tables (added when needed)

**Walk phase — strategies:**

- `strategies` — named decision approaches
- `strategy_versions` — versioned params, thresholds, notes
- `strategy_evaluations` — eval results vs outcomes

**Run phase — prompts (with Langfuse):**

- Versioned prompts live in Langfuse for prompt engineering workflows. Doltgres stores the durable archive for cross-node distribution. Schema TBD when Run phase starts.

---

## Port Interface

```typescript
interface KnowledgeStorePort {
  // Read
  getKnowledge(id: string): Promise<Knowledge | null>;
  listKnowledge(domain: string, tags?: string[]): Promise<Knowledge[]>;
  searchKnowledge(domain: string, query: string): Promise<Knowledge[]>;

  // Write
  addKnowledge(entry: NewKnowledge): Promise<Knowledge>;
  updateKnowledge(
    id: string,
    update: Partial<NewKnowledge>
  ): Promise<Knowledge>;

  // Doltgres versioning
  commit(message: string): Promise<string>; // returns commit hash
  log(limit?: number): Promise<DoltCommit[]>;
  currentCommit(): Promise<string>;
}
```

Adapter: `DoltgresKnowledgeStoreAdapter` — Drizzle for reads/writes, raw SQL for `dolt_commit()`/`dolt_log()`/`hashof('HEAD')`. Scoped to the node's database.

---

## Promotion Gate: Awareness → Knowledge

Not every signal becomes knowledge. The promotion gate decides what crosses the boundary:

```
Awareness (Postgres)                    Knowledge (Postgres v0 / Dolt v1)
────────────────────                    ─────────────────────────────────

analysis_signal ──→ [promotion criteria] ──→ knowledge_claims
                                             evidence_refs

analysis_outcomes ─→ [calibration eval] ──→ strategy_evaluations

repeated pattern ──→ [codification] ────→ playbooks

prompt iteration ──→ [validated A/B] ───→ prompt_versions
```

### Promotion Criteria

An awareness artifact becomes knowledge when at least one holds:

| Criterion                     | Example                                                          |
| ----------------------------- | ---------------------------------------------------------------- |
| **Outcome-validated**         | Signal predicted correctly against resolved market               |
| **Statistically significant** | Strategy version outperforms baseline in N>30 evals              |
| **Human-reviewed**            | Operator marks a signal as high-quality insight                  |
| **Repeated pattern**          | Same trigger+analysis pattern fires >3 times with similar result |

### What does NOT get promoted

- Individual observations (raw data stays in awareness)
- Failed analysis runs (operational artifact, not knowledge)
- Low-confidence signals that weren't validated
- One-off alerts that didn't recur

---

## Knowledge Classes

All knowledge belongs to exactly one class. The class determines visibility, ownership, and how it moves between layers.

| Class             | Visibility       | Owner    | Mutability                  | Example                                                      |
| ----------------- | ---------------- | -------- | --------------------------- | ------------------------------------------------------------ |
| **Public/shared** | All nodes        | Operator | Operator writes, nodes read | Base strategies, reference prompts, evidence library         |
| **Node-private**  | Owning node only | Node     | Node writes freely          | Tuned prompts, local evaluations, domain-specific strategies |
| **Experimental**  | Owning node only | Node     | Branch, discard freely      | Prompt A/B tests, threshold experiments                      |

Knowledge moves **upward** by explicit promotion only:

```
experimental ──→ node-private    (node merges validated experiment)
node-private ──→ public/shared   (operator reviews + accepts node contribution)
```

Knowledge moves **downward** by explicit pull only:

```
public/shared ──→ node-private   (node pulls operator update into local store)
```

**No default visibility across nodes.** Monorepo code sharing does not imply knowledge sharing. A node's tuned prompts and evaluations are private unless explicitly promoted.

---

## Per-Node Knowledge Distribution

Each Cogni node has its own agent graphs package (domain logic) and its own knowledge store (domain expertise). The operator maintains base knowledge that new nodes inherit. This section designs how knowledge flows between operator and nodes across the lifecycle.

### Three-Layer Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  OPERATOR BASE KNOWLEDGE                                     │
│  Curated strategies, reference prompts, evidence library     │
│  Published as: @cogni/knowledge-seeds or Doltgres remote    │
│  Class: public/shared                                        │
└──────────────────────────┬───────────────────────────────────┘
                           │ seed / pull (node decides when)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  NODE-LOCAL SOVEREIGN KNOWLEDGE (per-node, isolated)         │
│  Own Doltgres database (knowledge_{node_name})              │
│  Base (seeded from operator) + private tuned knowledge      │
│  Class: node-private (+ merged public/shared)                │
└──────────────────────────┬───────────────────────────────────┘
                           │ KnowledgeStorePort
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  GRAPH LAYER (per-node agent graphs)                         │
│  packages/langgraph-graphs/ reads from KnowledgeStorePort    │
│  Doesn't know or care about distribution mechanism           │
└──────────────────────────────────────────────────────────────┘

                    ┌──────────────────────────────────────┐
                    │  OPTIONAL: PUBLISHED COMMONS          │
                    │  Shared Dolt remote or DoltHub repo  │
                    │  Nodes explicitly promote into this  │
                    │  Class: public/shared                │
                    └──────────────────────────────────────┘
```

**Key separation:** The agent graphs package is **code** (the logic). The knowledge store is **data** (the expertise). The awareness plane is **operational data** (what's happening now). A node's graphs read strategies and prompts from its local knowledge store — they never import them as code constants.

### Shared Doltgres Server, Per-Node Databases

One Doltgres server process. Each node gets its own database. Same pattern as Postgres (one server, `CREATE DATABASE` per node).

```
┌─────────────────────────────────────────────────────────┐
│ Shared Doltgres Server                                   │
│                                                         │
│  knowledge_operator    ← operator base knowledge         │
│                          ships with node-template         │
│                                                         │
│  knowledge_poly        ← poly node's sovereign store     │
│                          seeded from knowledge_operator   │
│                                                         │
│  knowledge_resy        ← resy node's sovereign store     │
│                          seeded from knowledge_operator   │
└─────────────────────────────────────────────────────────┘
```

**Why per-node databases?**

- **DATA_SOVEREIGNTY** — a node's database is its own. Isolation is structural, not policy.
- **KNOWLEDGE_SOVEREIGN_BY_DEFAULT** — no default visibility across nodes.
- **Self-hosted exit** — node takes its Doltgres database as a standalone repo with full commit history.

### Node Provision Flow

1. Node's Postgres database created (awareness plane — existing step)
2. Node's Doltgres knowledge database created: `CREATE DATABASE knowledge_{node_name}`
3. Schema applied (same Drizzle DDL — Doltgres is Postgres-compatible)
4. Base knowledge seeded from `knowledge_operator`
5. Initial commit: `SELECT dolt_commit('-Am', 'seeded from knowledge_operator')`
6. `KnowledgeStorePort` adapter connects to `knowledge_{node_name}`

### Node Customization

- Node adds rows via `KnowledgeStorePort.addStrategyVersion()` etc. — standard Drizzle writes
- Custom strategies have `domain` matching the node's domain
- After writes, node commits: `SELECT dolt_commit('-Am', 'added poly strategy v2')`
- All node-written knowledge is **node-private** by default

### Pinning Analysis to Knowledge State

```sql
SELECT hashof('HEAD') as knowledge_commit;
-- Store in analysis_runs.knowledge_commit for reproducibility
```

Given same observations + same knowledge commit → same analysis outputs.

### Future: Branching, Remotes, Sharing

Not in MVP. Once comfortable with single-branch commit/log/diff:

- **Branching** — `SELECT dolt_checkout('-b', 'experiment/...')` for prompt experiments within a node's own database
- **Remotes** — `SELECT dolt_push(...)` / `dolt_pull(...)` for cross-node knowledge sharing
- **Commons** — optional shared Doltgres remote where nodes explicitly promote validated knowledge

---

## Invariants

| Rule                            | Constraint                                                                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AWARENESS_HOT_KNOWLEDGE_COLD    | Live operational data stays in Postgres. Curated expertise lives in Doltgres.                                                                                               |
| KNOWLEDGE_SOVEREIGN_BY_DEFAULT  | Node knowledge is local and private by default. Cross-node sharing is explicit promotion, never default visibility. Monorepo code sharing does not imply knowledge sharing. |
| DOLTGRES_PER_NODE_DATABASE      | Each node gets its own Doltgres database (`knowledge_{node_name}`). Per-node databases, not shared tables or branch-per-node.                                               |
| PROMOTE_NOT_MIRROR              | Knowledge is promoted from awareness via explicit gate. Only reviewed, repeated, or outcome-backed artifacts cross the boundary.                                            |
| PORT_BEFORE_BACKEND             | All knowledge access goes through `KnowledgeStorePort`. Consumers use standard Drizzle queries.                                                                             |
| SCHEMA_GENERIC_CONTENT_SPECIFIC | Domain specificity lives in row content (`domain`, `params` JSON), not table structure.                                                                                     |
| KNOWLEDGE_VERSION_PINNED        | Analysis runs record `knowledge_commit` (Doltgres commit hash). Same inputs + same knowledge → same outputs.                                                                |
| FORK_TAKES_KNOWLEDGE            | When a node self-hosts, it takes its Doltgres database with full commit history.                                                                                            |

---

## Non-Goals

- Replacing Postgres for hot operational data (awareness plane stays where it is)
- Branching or remotes in MVP (future — get comfortable with commits first)
- Real-time knowledge updates during analysis (read at start, not mid-flight)
- Automatic promotion without any validation gate (human or statistical)
- Embedding/vector search in knowledge plane (stays in Postgres with pgvector if needed)

## Open Questions

- [ ] Doltgres maturity: verify `dolt_commit`, `dolt_log`, `dolt_diff` work through standard `postgres` driver
- [ ] Doltgres server resource footprint alongside Postgres in dev stack
- [ ] Seed mechanism: SQL dump from `knowledge_operator` → `knowledge_{node}`, or Drizzle seeds?
- [ ] Should the promotion gate be a Temporal workflow or a simpler batch?

## Related

- [Monitoring Engine Spec](./monitoring-engine.md) — awareness plane (Postgres)
- [Architecture](./architecture.md) — hexagonal layering
- [Node vs Operator Contract](./node-operator-contract.md) — fork freedom, data sovereignty, upgrade autonomy
- [Node Launch Spec](./node-launch.md) — `provisionNode` workflow, per-node infrastructure
- [Node Formation Spec](./node-formation.md) — DAO creation, repo-spec output
- spike.0137 (branch) — knowledge store research
- proj.knowledge-store (branch) — prior Postgres-based design (refined here)
- [proj.poly-prediction-bot](../../work/projects/proj.poly-prediction-bot.md) — first domain consuming both planes
- task.0233 (cogni-template) — node-template extraction design
