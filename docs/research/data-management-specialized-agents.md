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

`ingestion-core` provides this today:

- `ActivityEvent` — deterministic IDs, provenance hash, source metadata
- `PollAdapter` / `WebhookNormalizer` — source connector ports
- `StreamCursor` — incremental sync state
- `ingestion_receipts` table — domain-agnostic archive

The ingestion spec adds Singer tap ABI + Temporal orchestration. Both Singer taps and TS adapters write to the same `ingestion_receipts` table. Downstream consumers (attribution, treasury, knowledge) select independently. **No changes needed to Layer 0.**

### Layer 1: Claims / Evidence — NEW

An extractor reads raw records and produces typed assertions. For Crawl MVP, extractors are rule-based Temporal activities (e.g., parse GitHub API response → structured fields). AI-based extraction (LLM reads a README and extracts structured facts) comes later.

**`claim`** — one extracted assertion with full provenance:

| Field | Purpose |
|---|---|
| `id` | Deterministic from content |
| `source_record_id` | FK to `ingestion_receipts` — which raw record this came from |
| `activity_run_id` | FK to `activity_run` — which extraction run produced this |
| `claim_type` | `entity_attribute`, `relation`, `observation` |
| `subject_hint` | Best-guess entity reference (pre-resolution) |
| `predicate` | What's being asserted (e.g., `license`, `star_count`, `alternative_to`) |
| `object` | The asserted value (JSONB) |
| `confidence` | 0.0–1.0, set by extractor |
| `extractor_name`, `extractor_version` | Which extractor produced this |

Append-only. Claims are never mutated, only superseded by newer claims from re-extraction.

### Layer 2: Canonical Knowledge — NEW

The resolved, current-best understanding. Mutable, but every mutation traces to an `activity_run`.

**`entity`** — one row per real-world thing:

| Field | Purpose |
|---|---|
| `id` | Stable identifier |
| `entity_type` | Niche-defined enum (each fork defines its domain types) |
| `canonical_name` | Best-known name |
| `attributes` | JSONB, niche-extensible (validated by Zod schemas per entity_type) |
| `confidence` | Derived from supporting claims |
| `source_count` | How many independent sources confirm this entity |
| `first_seen_at`, `last_corroborated_at` | Temporal bounds |
| `resolved_by_run_id` | Which resolution run created/updated this |
| `tenant_id` | `'global'` for shared domain knowledge, `billing_account_id` for private |

**`entity_alias`** — entity resolution subsystem:

| Field | Purpose |
|---|---|
| `entity_id` | FK to canonical entity |
| `alias_type` | `source_id`, `name_variant`, `url` |
| `alias_value` | The alternative identifier |
| `source` | Which source uses this identifier |
| `match_status` | `confirmed`, `candidate`, `rejected` |

This is how "lodash" on npm, "lodash/lodash" on GitHub, and "Lo-Dash" in a blog post link to the same entity. Entity resolution is its own subsystem — not a dedup step in a pipeline.

**`relation`** — typed directed edge between entities:

| Field | Purpose |
|---|---|
| `source_entity_id`, `target_entity_id` | The two entities |
| `relation_type` | Niche-defined enum (`alternative_to`, `depends_on`, `authored_by`) |
| `attributes` | JSONB for edge metadata |
| `confidence` | Independent from entity confidence |
| `supporting_claim_ids[]` | Which claims assert this relationship |
| `tenant_id` | RLS scope |

**`observation`** — temporal signal (time-series fact about an entity):

| Field | Purpose |
|---|---|
| `entity_id` | FK to entity |
| `signal_type` | Niche-defined (`star_count`, `commit_frequency`, `citation_count`) |
| `value` | JSONB (numeric or structured) |
| `observed_at` | When measured |
| `source_claim_id` | Provenance |
| `tenant_id` | RLS scope |

Observations accumulate. An entity's "current" star count is the latest observation; its trajectory is computed from the series.

**`embedding`** — semantic index (pgvector):

| Field | Purpose |
|---|---|
| `entity_id` | FK to entity |
| `embedding` | `vector(1536)`, HNSW-indexed |
| `content_text` | The text that was embedded (entity summary) |
| `content_hash` | sha256 for idempotent re-embedding |

One embedding per entity. This is a **search index into the structured store**, not the knowledge itself. Secondary access pattern for fuzzy intent → entity mapping.

### Cross-cutting: Activity Run

**`activity_run`** — lineage for everything above Layer 0:

| Field | Purpose |
|---|---|
| `id` | Run identifier |
| `activity_type` | `extraction`, `resolution`, `enrichment`, `scoring`, `pruning` |
| `runner_name`, `runner_version` | What code ran |
| `model_version` | If AI was involved, which model |
| `started_at`, `completed_at`, `status` | Lifecycle |
| `parent_run_id` | For nested workflows |

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

| Activity | Runtime | Why |
|---|---|---|
| **Ingestion** (source → raw records) | Temporal activities | Mechanical ETL. Singer taps are subprocesses. Already designed. |
| **Extraction** (raw records → claims) | Temporal activities (Crawl MVP) | Rule-based parsing of structured API responses. No AI needed for Crawl. |
| **Extraction** (raw records → claims) | LangGraph graph (Walk+) | AI-based: LLM reads a README/doc and extracts structured facts. |
| **Entity resolution** (claims → entities) | Temporal activities (Crawl MVP) | Deterministic matching rules (exact name, URL normalization). |
| **Entity resolution** | LangGraph graph (Walk+) | Fuzzy matching, judgment calls on merge/split candidates. |
| **Enrichment** (fill gaps in entities) | LangGraph graph | AI research: "find the license for this project" requires reasoning. |
| **Agent queries** (user asks a question) | LangGraph graph | Always AI — this is the product interface. |
| **Scoring / pruning** | Temporal activities | Batch recomputation of confidence, staleness decay. Mechanical. |

**Key principle**: LangGraph is for workflows where AI judgment is involved. Mechanical ETL, rule-based extraction, and batch scoring are Temporal activities. Don't use an LLM to parse JSON.

---

## Context Engineering (Unchanged)

How agents use the knowledge store. This section carries forward from the first iteration.

| Strategy | When | How |
|---|---|---|
| **Write** | Agent produces intermediate results | Write to state fields or tool-accessible storage. Don't keep in context. |
| **Select** | Agent needs domain knowledge | Knowledge tools query structured store + semantic index. Returns structured records. |
| **Compress** | Long-running multi-turn agents | Rolling summary of older turns. Keep last N messages verbatim + summary of rest. |
| **Isolate** | Multi-agent workflows | Each sub-agent gets only its required context via LangGraph state schema. |

**Key insight from Manus AI**: KV-cache hit rate is the #1 performance metric. Mask unavailable tools via logits (don't remove from system prompt). Task recitation (rewriting current plan into recent context) combats "lost in the middle."

**Key insight from Anthropic**: Context engineering > prompt engineering. The right data in context matters more than clever instructions.

---

## Multi-Tenant Data Model

- **Shared domain knowledge**: `tenant_id = 'global'`. Curated by the node operator. Visible to all tenants.
- **Per-tenant knowledge**: `tenant_id = billing_account_id`. User-uploaded or user-generated data.
- **RLS policy**: `WHERE tenant_id IN ($current_tenant, 'global')` — automatic via Postgres RLS.
- **Raw archive** (`ingestion_receipts`, `claim`): No tenant_id. Domain-agnostic. Available to all downstream pipelines.
- **Canonical knowledge** (`entity`, `relation`, `observation`, `embedding`): Tenant-scoped.

Extends existing `database-rls.md` spec unchanged.

---

## How Syntropy Emerges

| Mechanism | How |
|---|---|
| **Corroboration** | Multiple claims from different sources assert the same fact → entity `confidence` increases, `source_count` increments |
| **Re-extraction** | Run a better extractor on old raw records → new claims supersede old ones → entities re-scored. Raw archive untouched. |
| **Entity resolution** | Discover that two entities are the same → merge via alias system → relations and observations consolidate. Reversible (split). |
| **Trajectory** | Observations accumulate → agents compute growth/decline from the time series, not from a snapshot |
| **Contradiction** | Conflicting claims flagged (same subject + predicate, different object, both high confidence) → resolution activity investigates |
| **Decay** | Entities not corroborated within a type-specific TTL lose confidence. Stale knowledge naturally deprioritizes. |
| **Replay** | Change extraction logic → re-run on all raw records → regenerate claims → re-resolve entities. History preserved. |

---

## Package Design

**One new package**: `packages/knowledge-store/` following the capability package shape.

```
packages/knowledge-store/
├── src/
│   ├── port/              # KnowledgeReadPort, KnowledgeWritePort
│   ├── domain/            # Entity, Claim, Relation, Observation types + Zod schemas
│   │                      # Confidence computation, staleness rules, merge logic
│   ├── adapters/          # Drizzle/pgvector adapter implementing ports
│   └── index.ts           # Public exports
├── tests/
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

**Ports (2–3 max, split only when real adapters diverge)**:

| Port | Responsibility |
|---|---|
| `KnowledgeReadPort` | Query entities, traverse relations, get timelines, semantic search, get evidence trail |
| `KnowledgeWritePort` | Append claims, resolve entities (merge/split/alias), write observations, upsert embeddings |
| `IngestionArchivePort` | _Maybe_ — source runs, raw records, checkpoints. Might stay in `ingestion-core` instead. |

**Schema**: Lives inside `packages/knowledge-store/src/domain/` as Drizzle table definitions. Separate tables per concept (`claim`, `entity`, `entity_alias`, `relation`, `observation`, `embedding`, `activity_run`) — NOT one generic table. Different lifecycles, different invariants, different indexes.

**Knowledge tools**: Added to existing `packages/ai-tools/` catalog. Not a new package.

| Tool | What it does |
|---|---|
| `knowledge_query` | Filter entities by type, attributes, category → structured records |
| `knowledge_traverse` | Follow relations from an entity N hops → entity subgraph |
| `knowledge_timeline` | Get observation series for an entity + signal type → time series |
| `knowledge_search` | Semantic search via embedding similarity → ranked entities |
| `knowledge_evidence` | "Why do we believe X?" → supporting claims + source records |

---

## Recommendation

Ship the three-layer architecture (raw → claims → canonical) with one new `packages/knowledge-store/` package. Layer 0 already exists. Postgres-native, pgvector for semantic index, RLS for multi-tenancy. Mechanical workflows in Temporal, AI workflows in LangGraph.

**Trade-offs accepted**:

- JSONB `attributes` on entities instead of per-niche columns. Validated by Zod schemas, not DB constraints. Simpler to extend, slightly harder to query. Acceptable for Crawl. Add typed columns when query patterns stabilize.
- No reranker in Crawl. Structured queries are primary; semantic search is secondary. Add when retrieval quality plateaus.
- No Apache AGE. Recursive CTEs handle relationship traversal. Add when a niche demonstrates complex graph query needs.
- Entity resolution starts simple (exact match + URL normalization). Fuzzy/AI matching in Walk.

## Open Questions

- **Attribute schema validation**: Zod schemas per `entity_type` — where do niche forks register their schemas? Package config? Convention-based discovery?
- **Embedding model cost**: At what ingestion volume does embedding cost become a concern? Model token costs for typical niches.
- **Observation granularity**: How often to sample time-series signals? Per-source cadence config vs global schedule?
- **Claim supersession**: When a re-extraction produces a new claim, how exactly does the old claim get marked superseded? Explicit `superseded_by` FK, or implicit via `activity_run_id` ordering?
- **Cross-node knowledge sharing**: Can nodes share canonical entities with each other? What's the trust model? (Probably a Run+ concern.)

---

## Proposed Layout

### Project

`proj.knowledge-store` — Three-layer knowledge architecture for node-template

**Goal**: Every cogni-template fork ships with a structured knowledge store that accumulates domain expertise and improves over time.

**Phases**:

- **Crawl**: `packages/knowledge-store/` with schema, ports, Drizzle adapter. Entity + relation + observation tables. Basic entity resolution (exact match). One knowledge query tool in `ai-tools`. No embeddings, no AI extraction.
- **Walk**: pgvector semantic index. Hybrid retrieval (FTS + vector). AI-based extraction (LangGraph graph). Fuzzy entity resolution. Evidence trail tool. Confidence scoring + staleness decay.
- **Run**: Reranker. Cross-node knowledge sharing. Eval framework for knowledge quality. Apache AGE if graph queries needed.

### Specs

| Spec | Status | Key Invariants |
|---|---|---|
| `docs/spec/knowledge-store.md` | New | THREE_LAYER_ARCHITECTURE, CLAIMS_APPEND_ONLY, ENTITY_RESOLUTION_SUBSYSTEM, LINEAGE_REQUIRED (every canonical fact traces to activity_run → claim → source_record) |
| `docs/spec/database-rls.md` | Update | Add knowledge tables, global tenant pattern |
| `docs/spec/data-ingestion-pipelines.md` | Update | Clarify Layer 0 role, link to knowledge-store as downstream consumer |

### Tasks (rough sequence)

1. **task: knowledge-store package scaffold** — Package structure, types, Drizzle schema for entity/relation/observation/claim/entity_alias/activity_run. (Crawl)
2. **task: KnowledgeWritePort + adapter** — Append claims, resolve entities (exact match), write observations. Drizzle adapter. Contract tests. (Crawl)
3. **task: KnowledgeReadPort + adapter** — Query entities, traverse relations, get timelines. Drizzle adapter. (Crawl)
4. **task: knowledge_query tool** — Tool contract in `ai-tools`, wired to KnowledgeReadPort. First agent access to knowledge store. (Crawl)
5. **task: pgvector + semantic index** — Embedding table, HNSW index, embed via LiteLLM, `knowledge_search` tool. (Walk)
6. **task: hybrid retrieval** — FTS (tsvector) + vector + RRF fusion in read adapter. (Walk)
7. **task: AI extraction graph** — LangGraph graph that reads source records and produces claims via LLM. (Walk)
8. **task: confidence scoring + decay** — Batch Temporal activity that recomputes entity confidence from claims, applies staleness decay. (Walk)
9. **task: knowledge_evidence tool** — "Why do we believe X?" — trace from entity → claims → source records. (Walk)
