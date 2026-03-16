---
id: proj.knowledge-store
type: project
primary_charter:
title: "Knowledge Store — Structured Domain Expertise for Node-Template"
state: Active
priority: 2
estimate: 4
summary: "One new package (packages/knowledge-store/) providing domain types, ports, query logic, and Zod validation for a structured knowledge store. Drizzle table definitions live in db-schema (single schema authority). Structured-first; semantic index in Walk. Reuses existing ingestion-core as Layer 0."
outcome: "Every cogni-template fork ships with a structured knowledge store that agents query via tools, that accumulates domain expertise through ingestion pipelines, and that improves coherence over time."
assignees: derekg1729
created: 2026-03-16
updated: 2026-03-16
labels: [infrastructure, knowledge, data, node-template]
---

# Knowledge Store — Structured Domain Expertise for Node-Template

> Research: [data-management-specialized-agents](../../docs/research/data-management-specialized-agents.md) | Spike: `spike.0137`

## Goal

Provide a generic, reusable knowledge store that any niche node fork inherits. A specialized AI company accumulates domain expertise in structured form — entities with attributes, typed relationships between them, and temporal observations that reveal trajectory. This project builds that foundation as `packages/knowledge-store/` (domain types, ports, query logic, Zod validation) with Drizzle table definitions in `packages/db-schema/` (single schema authority).

The knowledge store is **structured-first**: agents access it via tools that return structured records, not by having embeddings stuffed into context. Semantic search (pgvector) arrives in Walk as a secondary access pattern — an index into the structured store, not the store itself.

**Three-layer target architecture** (raw → claims → canonical), but Crawl ships only the canonical layer with simple provenance:

- **Layer 0 (raw archive)** — already exists: `ingestion-core` + `ingestion_receipts` + Singer taps via Temporal. No changes needed.
- **Layer 1 (claims/evidence)** — Walk. Append-only extracted assertions with full provenance. Enables corroboration, contradiction detection, re-extraction replay.
- **Layer 2 (canonical knowledge)** — Crawl. Resolved entities, relations, observations with `source_record_id` provenance back to Layer 0.

**Relationship to existing projects:**

- **proj.transparent-credit-payouts** — built `ingestion-core` and the ingestion pipeline this project consumes as Layer 0
- **proj.oss-research-node** — first niche consumer; defines entity types (`oss_project`, `license`, `category`) and uses knowledge-store package for its knowledge base
- **proj.graph-execution** — provides LangGraph execution patterns; knowledge tools integrate via existing `ai-tools` catalog

## Roadmap

### Crawl (P0) — Canonical Tables + Ports + First Tool

**Goal:** A working `packages/knowledge-store/` that services and graphs can write to and query. Entity + relation + observation tables in Postgres. Simple exact-match dedup. One agent tool for structured queries. No embeddings, no claims, no entity resolution subsystem.

| Deliverable                                                                                                                                                                                                                                                                         | Status      | Est | Work Item |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| Package scaffold (`packages/knowledge-store/`): domain types, Zod schemas for `entity_type`/`relation_type`/`signal_type` validation. Drizzle tables (`entity`, `relation`, `observation`) in `packages/db-schema/knowledge.ts` with `source_record_id` FK to `ingestion_receipts`. | Not Started | 2   | task.0167 |
| `KnowledgeWritePort` + Drizzle adapter: write entities (exact-match dedup), observations, relations. Contract tests.                                                                                                                                                                | Not Started | 2   | —         |
| `KnowledgeReadPort` + Drizzle adapter: query entities by type/attributes, traverse relations (recursive CTE), get observation timelines. Contract tests.                                                                                                                            | Not Started | 2   | —         |
| `knowledge_query` tool contract in `ai-tools`: first agent access to knowledge store, wired to `KnowledgeReadPort`                                                                                                                                                                  | Not Started | 1   | —         |

### Walk (P1) — Evidence Layer + Semantic Index + Entity Resolution

**Goal:** Multi-source corroboration via claims layer. Fuzzy entity resolution. pgvector semantic index for "I need something that does X" queries. AI-based extraction from raw records. Confidence scoring.

| Deliverable                                                                                                                          | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------- | --- | -------------------- |
| Claims layer: `claim` table (append-only), `activity_run` table, update entities to derive `confidence` + `source_count` from claims | Not Started | 3   | (create at P1 start) |
| Entity resolution: `entity_alias` table, candidate matching, merge/split operations, fuzzy matching                                  | Not Started | 2   | (create at P1 start) |
| pgvector semantic index: `embedding` table, HNSW index, embed entity summaries via LiteLLM, `knowledge_search` tool                  | Not Started | 2   | (create at P1 start) |
| Hybrid retrieval: FTS (tsvector) + vector similarity + Reciprocal Rank Fusion in read adapter                                        | Not Started | 2   | (create at P1 start) |
| AI extraction graph: LangGraph graph that reads source records and produces claims via LLM                                           | Not Started | 2   | (create at P1 start) |
| Confidence scoring + decay: batch Temporal activity, recompute from claims, staleness decay                                          | Not Started | 2   | (create at P1 start) |
| `knowledge_evidence` tool: "Why do we believe X?" — entity → claims → source records                                                 | Not Started | 1   | (create at P1 start) |

### Run (P2+) — Quality + Scale + Sharing

**Goal:** Production-grade retrieval quality. Cross-node knowledge sharing. Eval framework.

| Deliverable                                                                              | Status      | Est | Work Item            |
| ---------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Reranker integration: Cohere/ColBERT as optional retrieval stage                         | Not Started | 2   | (create at P2 start) |
| Cross-node knowledge sharing: trust model for shared entities between nodes              | Not Started | 3   | (create at P2 start) |
| Knowledge quality eval framework: known-answer test harness, retrieval precision metrics | Not Started | 2   | (create at P2 start) |
| Apache AGE: graph queries if recursive CTEs prove insufficient                           | Not Started | 2   | (create at P2 start) |

## Constraints

- One new package: `packages/knowledge-store/` following capability package shape (port + domain + adapters)
- **DB_SCHEMA_OWNS_TABLES**: Drizzle table definitions live in `packages/db-schema/knowledge.ts`, not in the knowledge-store package. `db-schema` is the single schema authority — packages may propose schema modules, but only `db-schema` publishes runtime DB schema and migrations until a proven monorepo migration framework exists. The knowledge-store package imports table types from `@cogni/db-schema/knowledge` for adapter use.
- **HARD_FK_TO_RECEIPTS**: `source_record_id` uses a hard FK to `ingestion_receipts` — safe because both tables live in the same `db-schema` package with deterministic migration ordering.
- **ATTRIBUTE_REGISTRY_IN_PACKAGE**: Per-entity-type Zod schemas are a runtime registry in `packages/knowledge-store/`, not in `db-schema`. The adapter constructor accepts a schema map; wiring layer injects fork-specific schemas.
- No new database. Postgres tables in the existing DB, behind existing RLS
- `entity_type`, `relation_type`, `signal_type` are strings validated by Zod in app code, not Postgres enums — fork-heavy systems hate enum migrations
- Entity `attributes` are JSONB validated by Zod schemas per `entity_type`, not DB column constraints
- Layer 0 (raw archive) stays in `ingestion-core` — this project does not modify it
- Knowledge tools go in existing `packages/ai-tools/` — not a new package
- Crawl has no embeddings, no claims table, no `entity_alias`, no `activity_run` table
- Temporal covers run lineage in Crawl; `activity_run` table introduced in Walk only when non-ingestion lineage is needed

## Dependencies

- [x] `spike.0137` — research findings (done)
- [ ] `packages/db-schema` — owns knowledge Drizzle tables; verify `ingestion_receipts` PK shape for `source_record_id` FK
- [ ] pgvector Postgres extension — needed for Walk P1 (not Crawl)

## As-Built Specs

- (none yet — specs created when code merges)

## Design Notes

> Full research findings: [data-management-specialized-agents](../../docs/research/data-management-specialized-agents.md)

### Schema ownership: db-schema as single authority

Drizzle table definitions live in `packages/db-schema/knowledge.ts`, not in the knowledge-store package. Rationale: schema/migration ownership gets expensive when it fragments. A single DB authority gives deterministic migration ordering, simpler FK management, and fewer circular package dependencies. `packages/knowledge-store/` owns domain types, ports, adapters, query logic, and Zod validation — but not the physical DB schema. This keeps the door open for per-package schema ownership later, but doesn't standardize that pain yet.

### Why not claims in Crawl?

Claims add schema complexity, write amplification, and a resolution step that Crawl doesn't need yet. In Crawl, entities get a simple `source_record_id` FK pointing to the raw record they came from. Temporal run metadata covers "who extracted this and when." Concrete trigger for claims: when a second data source ingests facts about the same entity and you need to compare assertions.

### Why strings instead of enums for type fields?

Every niche fork defines its own entity types. Postgres enums require migrations to add values — merge conflicts and migration ordering headaches in a fork-heavy ecosystem. String columns validated by Zod at the app layer are more forgiving.

### Relationship to ingestion-core

`ingestion-core` owns Layer 0 domain types (`ActivityEvent`, `PollAdapter`, `WebhookNormalizer`). The `ingestion_receipts` table itself is defined in `db-schema/attribution.ts`. `knowledge-store` is a downstream consumer. The link between layers is `source_record_id` — a hard FK from canonical knowledge rows back to `ingestion_receipts` (both in `db-schema`).

### Attribute schema registry

Per-entity-type Zod schemas live in `packages/knowledge-store/` as a runtime registry. The adapter constructor accepts a `Map<string, ZodSchema>` — the wiring layer (app bootstrap or service startup) injects fork-specific schemas. This keeps the package generic while the db-schema stays schema-only.
