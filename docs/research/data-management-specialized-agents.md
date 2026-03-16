---
id: research-data-management-specialized-agents
type: research
title: "Knowledge Store Architecture for Specialized AI Nodes"
status: active
trust: draft
summary: "Three-layer knowledge architecture (raw archive → claims/evidence → canonical knowledge) with lineage, entity resolution, and semantic index. Postgres-native, one new package, minimal ports."
read_when: Planning knowledge store features, building specialized niche nodes, or extending the node-template
owner: derekg1729
created: 2026-03-16
verified: 2026-03-16
tags: [research, data, knowledge-store, context-engineering, node-template]
---

# Research: Knowledge Store Architecture for Specialized AI Nodes

> spike: spike.0137 | date: 2026-03-16

## Question

What are the core building blocks for a node-template knowledge store that enables specialized AI companies to accumulate domain expertise, serve it to agents with proper context engineering, and improve coherence over time (syntropy)?

## Context

Cogni-template already has:

- **`packages/ingestion-core/`** — `ActivityEvent` with deterministic IDs, provenance hashing (`payloadHash`), cursor-based incremental sync, poll/webhook adapter ports. This IS the raw archive layer.
- **`docs/spec/data-ingestion-pipelines.md`** — Singer taps (ABI standard, not Meltano runtime) orchestrated by Temporal. Domain-agnostic `ingestion_receipts` archive.
- **PostgreSQL + Drizzle** with a designed-but-unimplemented RLS spec (`docs/spec/database-rls.md`)
- **Multi-tenant isolation** via `billing_account_id` FK chains and `SET LOCAL app.current_user_id`
- **LangGraph graph packages** with catalog, factory pattern, and tool system in `packages/ai-tools/`
- **Capability package pattern** (`packages/<name>/src/{port/, domain/, adapters/}`) per `packages-architecture.md`
- **No claims/evidence layer, no entity resolution, no semantic index yet**

## Findings

### Why Not Just Entities?

The first iteration of this research proposed a flat model: ingest data → store as entities → embed for search. That's how you build a database, not a syntropic knowledge system.

The critical insight from modern data platforms (and how top AI companies manage knowledge): **separate raw records from extracted claims from canonical knowledge**. This is the bronze/silver/gold pattern, and it's what enables:

- **Replayability** — re-run extraction on old data with better models, without losing history
- **Corroboration** — multiple claims from different sources strengthen confidence
- **Contradiction detection** — conflicting claims from different sources get flagged
- **Auditability** — every canonical fact traces to evidence traces to raw source data

### Three-Layer Architecture

```
Layer 0: Raw Archive (immutable)     — already exists: ingestion-core + ingestion_receipts
Layer 1: Claims / Evidence (append)  — extracted assertions with provenance
Layer 2: Canonical Knowledge (live)  — resolved entities, relations, observations, semantic index
```

### Layer 0: Raw Archive — ALREADY EXISTS

`ingestion-core` provides domain types and ports:

- `ActivityEvent` — deterministic IDs, provenance hash, source metadata
- `PollAdapter` / `WebhookNormalizer` — source connector ports
- `StreamCursor` — incremental sync state

The `ingestion_receipts` table is defined in `packages/db-schema/attribution.ts` (the single schema authority). Adapters live in `services/scheduler-worker` and `src/adapters/server`.

The ingestion spec adds Singer tap ABI + Temporal orchestration. Both Singer taps and TS adapters write to the same `ingestion_receipts` table. Downstream consumers (attribution, treasury, knowledge) select independently. **No changes needed to Layer 0.**

### Layer 1: Claims / Evidence — NEW

An extractor reads raw records and produces typed assertions. For Crawl MVP, extractors are rule-based Temporal activities (e.g., parse GitHub API response → structured fields). AI-based extraction (LLM reads a README and extracts structured facts) comes later.

**`claim`** — one extracted assertion with full provenance:

| Field                                 | Purpose                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `id`                                  | Deterministic from content                                              |
| `source_record_id`                    | FK to `ingestion_receipts` — which raw record this came from            |
| `activity_run_id`                     | FK to `activity_run` — which extraction run produced this               |
| `claim_type`                          | `entity_attribute`, `relation`, `observation`                           |
| `subject_hint`                        | Best-guess entity reference (pre-resolution)                            |
| `predicate`                           | What's being asserted (e.g., `license`, `star_count`, `alternative_to`) |
| `object`                              | The asserted value (JSONB)                                              |
| `confidence`                          | 0.0–1.0, set by extractor                                               |
| `extractor_name`, `extractor_version` | Which extractor produced this                                           |

Append-only. Claims are never mutated, only superseded by newer claims from re-extraction.

### Layer 2: Canonical Knowledge — NEW

The resolved, current-best understanding. Mutable, but every mutation traces to an `activity_run`.

**`entity`** — one row per real-world thing:

| Field                                   | Purpose                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `id`                                    | Stable identifier                                                        |
| `entity_type`                           | Niche-defined enum (each fork defines its domain types)                  |
| `canonical_name`                        | Best-known name                                                          |
| `attributes`                            | JSONB, niche-extensible (validated by Zod schemas per entity_type)       |
| `confidence`                            | Derived from supporting claims                                           |
| `source_count`                          | How many independent sources confirm this entity                         |
| `first_seen_at`, `last_corroborated_at` | Temporal bounds                                                          |
| `resolved_by_run_id`                    | Which resolution run created/updated this                                |
| `tenant_id`                             | `'global'` for shared domain knowledge, `billing_account_id` for private |

**`entity_alias`** — entity resolution subsystem:

| Field          | Purpose                              |
| -------------- | ------------------------------------ |
| `entity_id`    | FK to canonical entity               |
| `alias_type`   | `source_id`, `name_variant`, `url`   |
| `alias_value`  | The alternative identifier           |
| `source`       | Which source uses this identifier    |
| `match_status` | `confirmed`, `candidate`, `rejected` |

This is how "lodash" on npm, "lodash/lodash" on GitHub, and "Lo-Dash" in a blog post link to the same entity. Entity resolution is its own subsystem — not a dedup step in a pipeline.

**`relation`** — typed directed edge between entities:

| Field                                  | Purpose                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `source_entity_id`, `target_entity_id` | The two entities                                                   |
| `relation_type`                        | Niche-defined enum (`alternative_to`, `depends_on`, `authored_by`) |
| `attributes`                           | JSONB for edge metadata                                            |
| `confidence`                           | Independent from entity confidence                                 |
| `supporting_claim_ids[]`               | Which claims assert this relationship                              |
| `tenant_id`                            | RLS scope                                                          |

**`observation`** — temporal signal (time-series fact about an entity):

| Field             | Purpose                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `entity_id`       | FK to entity                                                       |
| `signal_type`     | Niche-defined (`star_count`, `commit_frequency`, `citation_count`) |
| `value`           | JSONB (numeric or structured)                                      |
| `observed_at`     | When measured                                                      |
| `source_claim_id` | Provenance                                                         |
| `tenant_id`       | RLS scope                                                          |

Observations accumulate. An entity's "current" star count is the latest observation; its trajectory is computed from the series.

**`embedding`** — semantic index (pgvector):

| Field          | Purpose                                     |
| -------------- | ------------------------------------------- |
| `entity_id`    | FK to entity                                |
| `embedding`    | `vector(1536)`, HNSW-indexed                |
| `content_text` | The text that was embedded (entity summary) |
| `content_hash` | sha256 for idempotent re-embedding          |

One embedding per entity. This is a **search index into the structured store**, not the knowledge itself. Secondary access pattern for fuzzy intent → entity mapping.

### Cross-cutting: Activity Run

**`activity_run`** — lineage for everything above Layer 0:

| Field                                  | Purpose                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| `id`                                   | Run identifier                                                 |
| `activity_type`                        | `extraction`, `resolution`, `enrichment`, `scoring`, `pruning` |
| `runner_name`, `runner_version`        | What code ran                                                  |
| `model_version`                        | If AI was involved, which model                                |
| `started_at`, `completed_at`, `status` | Lifecycle                                                      |
| `parent_run_id`                        | For nested workflows                                           |

Every claim, entity mutation, resolution decision, and confidence re-score traces to an activity_run.

---

## Infrastructure Decision: Postgres-Native

**Postgres + pgvector** is the clear winner. Not re-evaluated — the reasoning from the first iteration holds:

1. Already on Postgres with Drizzle + RLS. pgvector = `CREATE EXTENSION`.
2. Below 10M vectors for foreseeable future. pgvector handles this.
3. Single database = single RLS policy set. `tenant_id IN (current, 'global')`.
4. TypeScript end-to-end. No Python sidecar.
5. Hybrid search (FTS + vector) in one query. No cross-database sync.
6. Graduate to Qdrant if/when a node demonstrably needs >10M vectors with sub-10ms latency.

---

## Execution Model: What Runs Where

| Activity                                  | Runtime                         | Why                                                                     |
| ----------------------------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| **Ingestion** (source → raw records)      | Temporal activities             | Mechanical ETL. Singer taps are subprocesses. Already designed.         |
| **Extraction** (raw records → claims)     | Temporal activities (Crawl MVP) | Rule-based parsing of structured API responses. No AI needed for Crawl. |
| **Extraction** (raw records → claims)     | LangGraph graph (Walk+)         | AI-based: LLM reads a README/doc and extracts structured facts.         |
| **Entity resolution** (claims → entities) | Temporal activities (Crawl MVP) | Deterministic matching rules (exact name, URL normalization).           |
| **Entity resolution**                     | LangGraph graph (Walk+)         | Fuzzy matching, judgment calls on merge/split candidates.               |
| **Enrichment** (fill gaps in entities)    | LangGraph graph                 | AI research: "find the license for this project" requires reasoning.    |
| **Agent queries** (user asks a question)  | LangGraph graph                 | Always AI — this is the product interface.                              |
| **Scoring / pruning**                     | Temporal activities             | Batch recomputation of confidence, staleness decay. Mechanical.         |

**Key principle**: LangGraph is for workflows where AI judgment is involved. Mechanical ETL, rule-based extraction, and batch scoring are Temporal activities. Don't use an LLM to parse JSON.

---

## Context Engineering (Unchanged)

How agents use the knowledge store. This section carries forward from the first iteration.

| Strategy     | When                                | How                                                                                  |
| ------------ | ----------------------------------- | ------------------------------------------------------------------------------------ |
| **Write**    | Agent produces intermediate results | Write to state fields or tool-accessible storage. Don't keep in context.             |
| **Select**   | Agent needs domain knowledge        | Knowledge tools query structured store + semantic index. Returns structured records. |
| **Compress** | Long-running multi-turn agents      | Rolling summary of older turns. Keep last N messages verbatim + summary of rest.     |
| **Isolate**  | Multi-agent workflows               | Each sub-agent gets only its required context via LangGraph state schema.            |

**Key insight from Manus AI**: KV-cache hit rate is the #1 performance metric. Mask unavailable tools via logits (don't remove from system prompt). Task recitation (rewriting current plan into recent context) combats "lost in the middle."

**Key insight from Anthropic**: Context engineering > prompt engineering. The right data in context matters more than clever instructions.

---

## Multi-Tenant Data Model

- **Shared domain knowledge**: `tenant_id = 'global'`. Curated by the node operator. Visible to all tenants.
- **Per-tenant knowledge**: `tenant_id = billing_account_id`. User-uploaded or user-generated data.
- **RLS policy**: `WHERE tenant_id IN ($current_tenant, 'global')` — automatic via Postgres RLS.
- **Raw archive** (`ingestion_receipts`): No tenant_id. Domain-agnostic. Available to all downstream pipelines.
- **Claims** (Walk+): No tenant_id. Evidence layer is domain-agnostic like raw archive.
- **Canonical knowledge** (`entity`, `relation`, `observation`, `embedding`): Tenant-scoped.

Extends existing `database-rls.md` spec unchanged.

---

## How Syntropy Emerges

| Mechanism             | How                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Corroboration**     | Multiple claims from different sources assert the same fact → entity `confidence` increases, `source_count` increments           |
| **Re-extraction**     | Run a better extractor on old raw records → new claims supersede old ones → entities re-scored. Raw archive untouched.           |
| **Entity resolution** | Discover that two entities are the same → merge via alias system → relations and observations consolidate. Reversible (split).   |
| **Trajectory**        | Observations accumulate → agents compute growth/decline from the time series, not from a snapshot                                |
| **Contradiction**     | Conflicting claims flagged (same subject + predicate, different object, both high confidence) → resolution activity investigates |
| **Decay**             | Entities not corroborated within a type-specific TTL lose confidence. Stale knowledge naturally deprioritizes.                   |
| **Replay**            | Change extraction logic → re-run on all raw records → regenerate claims → re-resolve entities. History preserved.                |

---

## Package Design

**One new package**: `packages/knowledge-store/` following the capability package shape. **Drizzle table definitions** live in `packages/db-schema/knowledge.ts` (single schema authority) — the knowledge-store package owns domain types, ports, query logic, and Zod validation but not the physical schema.

```
packages/knowledge-store/
├── src/
│   ├── port/              # KnowledgeReadPort, KnowledgeWritePort
│   ├── domain/            # Entity, Relation, Observation types + Zod schemas
│   │                      # Attribute schema registry, dedup rules, merge logic
│   ├── adapters/          # Drizzle adapter implementing ports (imports @cogni/db-schema/knowledge)
│   └── index.ts           # Public exports
├── tests/
├── package.json
├── tsconfig.json
└── tsup.config.ts

packages/db-schema/
└── src/
    └── knowledge.ts       # Drizzle tables: entity, relation, observation (Crawl)
                           # Walk adds: claim, entity_alias, embedding, activity_run
```

**Ports (2–3 max, split only when real adapters diverge)**:

| Port                   | Responsibility                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `KnowledgeReadPort`    | Query entities, traverse relations, get timelines, semantic search, get evidence trail     |
| `KnowledgeWritePort`   | Append claims, resolve entities (merge/split/alias), write observations, upsert embeddings |
| `IngestionArchivePort` | _Maybe_ — source runs, raw records, checkpoints. Might stay in `ingestion-core` instead.   |

**Schema**: Separate tables per concept (`entity`, `relation`, `observation` in Crawl; `claim`, `entity_alias`, `embedding`, `activity_run` in Walk) — NOT one generic table. Different lifecycles, different invariants, different indexes. All defined in `db-schema/knowledge.ts` with hard FKs to `ingestion_receipts`.

**Knowledge tools**: Added to existing `packages/ai-tools/` catalog. Not a new package.

| Tool                 | What it does                                                       |
| -------------------- | ------------------------------------------------------------------ |
| `knowledge_query`    | Filter entities by type, attributes, category → structured records |
| `knowledge_traverse` | Follow relations from an entity N hops → entity subgraph           |
| `knowledge_timeline` | Get observation series for an entity + signal type → time series   |
| `knowledge_search`   | Semantic search via embedding similarity → ranked entities         |
| `knowledge_evidence` | "Why do we believe X?" → supporting claims + source records        |

---

## Recommendation

Ship canonical knowledge tables with one new `packages/knowledge-store/` package. Layer 0 already exists (`ingestion-core` + `ingestion_receipts`). Postgres-native, RLS for multi-tenancy. The three-layer model (raw → claims → canonical) is the target architecture, but **Crawl ships only Layer 0 (existing) + Layer 2 (canonical tables with simple provenance back to source records)**. Layer 1 (claims/evidence) is introduced in Walk when corroboration, contradiction handling, or re-extraction actually justify it.

**Trade-offs accepted**:

- **No claims layer in Crawl.** Direct provenance from entity/observation → `source_record_id` FK. Claims are an optional intermediate layer — introduce when you need multi-source corroboration or re-extraction replay. Temporal run metadata covers lineage until then.
- **No `activity_run` table in Crawl.** Temporal already tracks run history. Don't invent a second run ledger until non-ingestion lineage (AI extraction, resolution) requires it.
- **No `entity_alias` in Crawl.** Simple exact-match dedup. Entity resolution subsystem (aliases, candidate matching, merge/split) arrives in Walk when fuzzy matching is needed.
- **No embeddings in Crawl.** Structured queries are primary. pgvector semantic index arrives in Walk.
- **`entity_type`, `relation_type`, `signal_type` are strings**, not DB enums. Validated in app code (Zod). Fork-heavy systems hate enum migrations.
- JSONB `attributes` on entities. Validated by Zod schemas per `entity_type`, not DB constraints.
- No Apache AGE. Recursive CTEs handle relationship traversal.

## Open Questions

- **Attribute schema validation**: Zod schemas per `entity_type` — where do niche forks register their schemas? Package config? Convention-based discovery?
- **Observation granularity**: How often to sample time-series signals? Per-source cadence config vs global schedule?
- **When to introduce claims**: What's the concrete trigger? First multi-source ingestion? First re-extraction need? Or first contradiction?
- **Cross-node knowledge sharing**: Can nodes share canonical entities with each other? What's the trust model? (Probably a Run+ concern.)

---

## Proposed Layout

> See [proj.knowledge-store](../../work/projects/proj.knowledge-store.md) for the project roadmap, task breakdown, and phasing derived from these findings.
