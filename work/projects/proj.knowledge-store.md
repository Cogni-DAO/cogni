---
id: proj.knowledge-store
type: project
primary_charter:
title: "Knowledge Store — Structured Domain Expertise for Node-Template"
state: Active
priority: 2
estimate: 4
summary: "One new package (packages/knowledge-store/) providing entity, relation, and observation tables with provenance, two ports, and a Drizzle adapter. Structured-first; semantic index in Walk. Reuses existing ingestion-core as Layer 0."
outcome: "Every cogni-template fork ships with a structured knowledge store that agents query via tools, that accumulates domain expertise through ingestion pipelines, and that improves coherence over time."
assignees: derekg1729
created: 2026-03-16
updated: 2026-03-16
labels: [infrastructure, knowledge, data, node-template]
---

# Knowledge Store — Structured Domain Expertise for Node-Template

> Research: [data-management-specialized-agents](../../docs/research/data-management-specialized-agents.md) | Spike: `spike.0137`

## Goal

Provide a generic, reusable knowledge store that any niche node fork inherits. A specialized AI company accumulates domain expertise in structured form — entities with attributes, typed relationships between them, and temporal observations that reveal trajectory. This project builds that foundation as `packages/knowledge-store/`, following the capability package shape (port + domain + adapters in one package).

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

| Deliverable | Status | Est | Work Item |
| --- | --- | --- | --- |
| Package scaffold: types, Drizzle schema (`entity`, `relation`, `observation`), `source_record_id` provenance, Zod validation for string-typed `entity_type`/`relation_type`/`signal_type` | Not Started | 2 | — |
| `KnowledgeWritePort` + Drizzle adapter: write entities (exact-match dedup), observations, relations. Contract tests. | Not Started | 2 | — |
| `KnowledgeReadPort` + Drizzle adapter: query entities by type/attributes, traverse relations (recursive CTE), get observation timelines. Contract tests. | Not Started | 2 | — |
| `knowledge_query` tool contract in `ai-tools`: first agent access to knowledge store, wired to `KnowledgeReadPort` | Not Started | 1 | — |

### Walk (P1) — Evidence Layer + Semantic Index + Entity Resolution

**Goal:** Multi-source corroboration via claims layer. Fuzzy entity resolution. pgvector semantic index for "I need something that does X" queries. AI-based extraction from raw records. Confidence scoring.

| Deliverable | Status | Est | Work Item |
| --- | --- | --- | --- |
| Claims layer: `claim` table (append-only), `activity_run` table, update entities to derive `confidence` + `source_count` from claims | Not Started | 3 | (create at P1 start) |
| Entity resolution: `entity_alias` table, candidate matching, merge/split operations, fuzzy matching | Not Started | 2 | (create at P1 start) |
| pgvector semantic index: `embedding` table, HNSW index, embed entity summaries via LiteLLM, `knowledge_search` tool | Not Started | 2 | (create at P1 start) |
| Hybrid retrieval: FTS (tsvector) + vector similarity + Reciprocal Rank Fusion in read adapter | Not Started | 2 | (create at P1 start) |
| AI extraction graph: LangGraph graph that reads source records and produces claims via LLM | Not Started | 2 | (create at P1 start) |
| Confidence scoring + decay: batch Temporal activity, recompute from claims, staleness decay | Not Started | 2 | (create at P1 start) |
| `knowledge_evidence` tool: "Why do we believe X?" — entity → claims → source records | Not Started | 1 | (create at P1 start) |

### Run (P2+) — Quality + Scale + Sharing

**Goal:** Production-grade retrieval quality. Cross-node knowledge sharing. Eval framework.

| Deliverable | Status | Est | Work Item |
| --- | --- | --- | --- |
| Reranker integration: Cohere/ColBERT as optional retrieval stage | Not Started | 2 | (create at P2 start) |
| Cross-node knowledge sharing: trust model for shared entities between nodes | Not Started | 3 | (create at P2 start) |
| Knowledge quality eval framework: known-answer test harness, retrieval precision metrics | Not Started | 2 | (create at P2 start) |
| Apache AGE: graph queries if recursive CTEs prove insufficient | Not Started | 2 | (create at P2 start) |

## Constraints

- One new package only: `packages/knowledge-store/` following capability package shape (port + domain + adapters)
- No new database. Postgres tables in the existing DB, behind existing RLS
- `entity_type`, `relation_type`, `signal_type` are strings validated by Zod in app code, not Postgres enums — fork-heavy systems hate enum migrations
- Entity `attributes` are JSONB validated by Zod schemas per `entity_type`, not DB column constraints
- Layer 0 (raw archive) stays in `ingestion-core` — this project does not modify it
- Knowledge tools go in existing `packages/ai-tools/` — not a new package
- Crawl has no embeddings, no claims table, no `entity_alias`, no `activity_run` table
- Temporal covers run lineage in Crawl; `activity_run` table introduced in Walk only when non-ingestion lineage is needed

## Dependencies

- [x] `spike.0137` — research findings (done)
- [ ] `ingestion-core` + `ingestion_receipts` table — Layer 0 raw archive (exists, but verify schema compatibility for `source_record_id` FK)
- [ ] `packages/db-schema` or `packages/db-client` — Drizzle table definition pattern for new package to follow
- [ ] pgvector Postgres extension — needed for Walk P1 (not Crawl)

## As-Built Specs

- (none yet — specs created when code merges)

## Design Notes

### Why not claims in Crawl?

Claims (append-only evidence with provenance) are the right target architecture for corroboration, contradiction detection, and re-extraction replay. But they add schema complexity, write amplification, and a resolution step that Crawl doesn't need yet. In Crawl, entities get a simple `source_record_id` FK pointing to the raw record they came from. Temporal run metadata covers "who extracted this and when." The concrete trigger for introducing claims: when a second data source ingests facts about the same entity and you need to compare assertions.

### Why strings instead of enums for type fields?

Every niche fork defines its own entity types, relation types, and signal types. Postgres enums require migrations to add values. In a fork-heavy ecosystem, that creates merge conflicts and migration ordering headaches. String columns validated by Zod at the app layer are more forgiving — forks add types without coordinating schema migrations.

### Relationship to ingestion-core

`ingestion-core` owns Layer 0: `ActivityEvent`, `PollAdapter`, `WebhookNormalizer`, cursor-based sync. `knowledge-store` is a downstream consumer. The link between layers is `source_record_id` — a FK from canonical knowledge rows back to `ingestion_receipts`. This mirrors how `attribution-ledger` also consumes from `ingestion_receipts` independently.

### Package boundary: why not in db-schema?

The knowledge store is a capability package (port + domain + adapters), not just a schema. It contains query logic (recursive CTE traversal, timeline aggregation), dedup rules, and type validation. `db-schema` is a pure schema package with no business logic. Keeping them separate preserves the boundary.
