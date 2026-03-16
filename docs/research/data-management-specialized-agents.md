---
id: research-data-management-specialized-agents
type: research
title: "Data Management & Context Engineering for Specialized AI Nodes"
status: active
trust: draft
summary: Research spike on OSS data management primitives (pgvector, hybrid retrieval, RLS, context engineering) for the node-template architecture.
read_when: Planning data/retrieval features, building specialized niche nodes, or extending the node-template
owner: derekg1729
created: 2026-03-16
verified: 2026-03-16
tags: [research, data, rag, pgvector, context-engineering, node-template]
---

# Research: Data Management & Context Engineering for Specialized AI Nodes

> spike: spike.0137 | date: 2026-03-16

## Question

What are the best practices for managing shared + RLS-protected personal data, growing specialized datasets, and configuring agents with proper context engineering and layered retrieval — and what's the simplest OSS stack to adopt into our LangGraph graph-building architecture as a core building block for the "node-template"?

## Context

Cogni-template already has:

- **Hexagonal architecture** with ports/adapters for all infra concerns
- **LangGraph graph packages** (`packages/langgraph-graphs/`) with a catalog, factory pattern, and tool system
- **PostgreSQL + Drizzle** with a designed-but-unimplemented RLS spec (`docs/spec/database-rls.md`)
- **Multi-tenant isolation** via `billing_account_id` FK chains and `SET LOCAL app.current_user_id`
- **Tenant connections** with encrypted credential brokering (tools get `connectionId`, never raw tokens)
- **Graph executor** with unified `GraphExecutorPort`, billing decorators, and event relay
- **No vector/embedding/RAG infrastructure yet** — flagged as P1 in `ai-governance-data.md`

The goal is to define the data primitives that every "niche node" (a fork of cogni-template specialized for a domain) needs to grow its knowledge base and serve specialized agents.

## Findings

### Option A: Postgres-native stack (pgvector + FTS + Apache AGE)

**What**: Keep everything in PostgreSQL. Add `pgvector` for embeddings, use built-in full-text search (tsvector) for keyword retrieval, and optionally add Apache AGE for graph queries. All behind RLS.

**Pros**:

- **Single database** — one backup, one migration path, one connection pool, one set of RLS policies
- **RLS covers embeddings too** — `SELECT` with `<=>` (cosine distance) respects row-level policies automatically
- **pgvectorscale** benchmarks: 471 QPS at 99% recall on 50M vectors (HNSW index)
- **Hybrid search is trivial**: `ts_rank()` + `<=>` in same query, fuse with Reciprocal Rank Fusion (RRF)
- **Apache AGE** adds openCypher graph queries without a new database
- **Drizzle supports pgvector** via `drizzle-orm/pg-core` vector column type
- **Matches our hex architecture**: new `EmbeddingPort` + `RetrievalPort`, implemented by Drizzle adapters

**Cons**:

- pgvector HNSW index rebuild on large inserts (mitigated by `pgvectorscale` StreamingDiskANN)
- Apache AGE is less mature than Neo4j for complex graph traversals
- No built-in reranking (need external model or Cohere API)
- At 10M+ vectors with sub-10ms latency requirements, may need dedicated vector DB

**OSS tools**: `pgvector` (MIT), `pgvectorscale` (PostgreSQL License), `pg_trgm` (built-in), Apache AGE (Apache 2.0)

**Fit with our system**: Direct extension of existing Postgres + Drizzle. New schema tables in `packages/db-schema/`, new ports in `src/ports/`, Drizzle adapters in `src/adapters/server/`. RLS policies from `database-rls.md` spec apply unchanged.

### Option B: Dedicated vector DB (Qdrant) + Postgres

**What**: Postgres for relational data + RLS. Qdrant for vector similarity search with metadata filtering for tenant isolation.

**Pros**:

- Purpose-built vector operations (filtering + search in one pass)
- 45K inserts/sec, sub-5ms p99 at scale
- Built-in payload filtering acts as "RLS equivalent" (filter by `tenant_id`)
- Better for 50M+ vector workloads

**Cons**:

- **Two databases** — two backup strategies, two connection pools, two points of failure
- Tenant isolation is application-enforced (payload filter), not database-enforced (RLS)
- Adds Docker service to `infra/compose/`
- Data consistency between Postgres and Qdrant requires sync logic (eventual consistency risk)
- Overkill below 10M vectors

**OSS tools**: Qdrant (Apache 2.0), `qdrant-js` client

**Fit with our system**: New `VectorStorePort` with Qdrant adapter. Requires sync adapter to keep embeddings consistent with Postgres source data. Adds operational complexity our current infra doesn't need yet.

### Option C: LlamaIndex as retrieval framework + Postgres

**What**: Use LlamaIndex's document processing and retrieval pipeline on top of pgvector, gaining its connector ecosystem and query engine abstractions.

**Pros**:

- 160+ data source connectors (GitHub, Notion, Confluence, etc.)
- Built-in chunking, embedding, and query pipelines
- 40% faster retrieval than raw LangChain retrieval in benchmarks
- Good for document-heavy domains

**Cons**:

- **Python-only** — our stack is TypeScript end-to-end
- Would require a sidecar service or Python subprocess
- Framework coupling for retrieval logic (hard to swap later)
- Overlaps with LangGraph's tool-based retrieval pattern

**Fit with our system**: Poor. Would break our TypeScript-only constraint and add a Python dependency. Better to implement the same patterns natively.

---

## Core Primitives (Framework-Independent)

Regardless of which option, every specialized node needs these five primitives:

### 1. Embedding Pipeline

**Purpose**: Ingest domain documents → chunk → embed → store with metadata.

**Recommendation**:

- **Chunking**: Recursive character splitting at 512 tokens, 10-20% overlap. Prepend contextual headers (document title + section path + one-line summary) to each chunk before embedding. Benchmarks show this simple strategy (69% accuracy) beats "semantic chunking" (54%).
- **Embedding model**: OpenAI `text-embedding-3-small` (1536d) via LiteLLM for cost efficiency, or `text-embedding-3-large` (3072d) for precision. Model-agnostic via LiteLLM proxy means we can swap to open-source (e.g., `nomic-embed-text`) without code changes.
- **Storage**: `embeddings` table in Postgres with pgvector `vector(1536)` column, HNSW index, plus `tenant_id`, `source_type`, `source_id`, `chunk_index`, `content`, `metadata JSONB`.

### 2. Hybrid Retrieval

**Purpose**: Combine keyword search (high recall) + vector similarity (semantic understanding) for robust retrieval.

**Recommendation**:

- **Stage 1 — Broad recall**: Run BM25 (Postgres `ts_rank` on `tsvector` column) and pgvector cosine similarity in parallel. Top-K from each (K=20).
- **Stage 2 — Fusion**: Reciprocal Rank Fusion (RRF) to merge ranked lists. Simple formula: `score = Σ 1/(k + rank_i)` where k=60.
- **Stage 3 — Rerank** (optional P1): Cross-encoder reranker (Cohere Rerank API or open-source ColBERT via LiteLLM). Up to 48% retrieval quality improvement. Not needed for MVP.
- **Stage 4 — Context assembly**: Token-budget-aware selection. Fill context window front-to-back by relevance score, stop at budget.

### 3. Multi-Tenant Data Model

**Purpose**: Shared domain knowledge + per-tenant/per-user private data, enforced at the database layer.

**Recommendation**:

- **Pattern**: Pool model with metadata filter. Single table, `tenant_id` column on every row.
- **Shared data**: `tenant_id = 'global'` (or NULL). Domain knowledge curated by the node operator.
- **Per-tenant data**: `tenant_id = billing_account_id`. User-uploaded or user-generated data.
- **Query pattern**: `WHERE tenant_id IN ($current_tenant, 'global')` — automatic via RLS policy.
- **Implementation**: Extends our existing `database-rls.md` spec. Same `SET LOCAL app.current_user_id` pattern, same dual-role system (`app_user` vs `app_service`).

### 4. Context Engineering Discipline

**Purpose**: Build the right context window for each agent call — not too much, not too little.

**Recommendation** (from Anthropic + Manus AI production lessons):

| Strategy     | When                                | How                                                                                                           |
| ------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Write**    | Agent produces intermediate results | Write to state fields or tool-accessible storage (files, DB). Don't keep in context.                          |
| **Select**   | Agent needs domain knowledge        | Retrieval tool node queries embeddings + FTS. Returns top-K chunks.                                           |
| **Compress** | Long-running multi-turn agents      | Rolling summary of older turns. Keep last N messages verbatim + summary of rest.                              |
| **Isolate**  | Multi-agent workflows               | Each sub-agent gets only its required context via LangGraph state schema. Parent orchestrator sees summaries. |

**Key insight from Manus AI**: KV-cache hit rate is the #1 performance metric. Architectural decisions should preserve cache — e.g., mask unavailable tools via logits rather than removing them from system prompt (which invalidates cache). Task recitation (rewriting current plan into recent context) combats "lost in the middle" attention decay.

### 5. Data Growth Pipeline

**Purpose**: Continuously grow the node's specialized knowledge base.

**Recommendation**:

- **Ingestion graph**: A LangGraph graph (not a cron job) that discovers, fetches, chunks, embeds, and stores new domain content. Runs on schedule or event trigger.
- **Source connectors**: Start with 1-2 sources per niche (e.g., GitHub API + npm registry for an OSS node). Implement as tools the ingestion graph calls.
- **Deduplication**: Content hash (`sha256(content)`) stored alongside chunks. Skip re-embedding identical content.
- **Freshness**: `last_synced_at` per source. Incremental updates (fetch since last sync), not full rebuilds.
- **Quality gate**: After embedding, run a validation step (does the chunk retrieve correctly for a known query?). Log quality metrics to telemetry.

---

## Recommendation

**Option A (Postgres-native)** is the clear winner for our current scale and architecture.

**Rationale**:

1. **We're already on Postgres with Drizzle + RLS** — pgvector is a `CREATE EXTENSION`, not a new database
2. **Below 10M vectors** for any niche node's foreseeable future — pgvector handles this comfortably
3. **Single database = single RLS policy set** — the Pool model with `tenant_id IN (current, 'global')` extends our existing spec trivially
4. **TypeScript end-to-end** — no Python sidecar, no framework coupling
5. **Hybrid search (FTS + vector) in one query** — no cross-database joins or sync logic
6. **Apache AGE available if we need graph queries** — same Postgres instance, additive not disruptive

**Trade-offs accepted**:

- We accept pgvector's HNSW rebuild cost on bulk inserts (mitigate with batched background jobs)
- We skip dedicated reranking in MVP (add Cohere/ColBERT when retrieval quality plateaus)
- We skip Apache AGE initially (add when a niche node needs relationship traversal)
- We'll graduate to Qdrant if/when a node demonstrably needs >10M vectors with sub-10ms latency

**The "node-template" building block**:
Every niche node fork gets these primitives out of the box:

1. `EmbeddingPort` + `pgvector` adapter — embed and store domain content
2. `RetrievalPort` + hybrid search adapter — BM25 + vector + RRF fusion
3. `IngestionGraphFactory` — template graph for domain-specific data pipelines
4. RLS-enforced `embeddings` table with `tenant_id` — shared + personal data from day one
5. `RetrieverToolContract` — LangGraph tool node that any graph can use for retrieval

## Open Questions

- **Embedding model cost**: At what ingestion volume does embedding cost become a concern? Need to model token costs for typical niche domains (e.g., 10K docs, 100 chunks each = 1M chunks to embed).
- **Chunking for code**: The 512-token recursive strategy works for prose. Code may need AST-aware chunking (e.g., function-level boundaries). Needs experimentation per niche.
- **Reranker necessity**: Can we skip reranking entirely if our domain is narrow enough that hybrid search precision is sufficient? Need eval framework to measure.
- **Apache AGE maturity**: Is AGE production-ready for our use cases, or should we wait and use simple Postgres recursive CTEs for relationship queries?
- **Cache-aware context engineering**: Manus AI's KV-cache optimization is model-provider-specific. How does this interact with our LiteLLM proxy and OpenRouter routing?

---

## Proposed Layout

### Project

`proj.data-retrieval-primitives` — Add data management building blocks to node-template

**Goal**: Every cogni-template fork ships with embedding, retrieval, and ingestion primitives that work behind RLS out of the box.

**Phases**:

- **Crawl**: pgvector extension + `embeddings` schema + `EmbeddingPort` + Drizzle adapter. Basic vector similarity search. No hybrid, no ingestion pipeline.
- **Walk**: Hybrid retrieval (FTS + vector + RRF). `RetrievalPort` with tool contract. Ingestion graph template. Context compression utilities for long-running agents.
- **Run**: Reranker integration. Apache AGE for graph queries. Eval framework for retrieval quality. Multi-source ingestion with quality gates.

### Specs

| Spec                           | Status | Key Invariants                                                                                                                                                                        |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/spec/embeddings.md`      | New    | EMBEDDING_VIA_PORT (never direct pgvector calls from features), TENANT_SCOPED (all embeddings have tenant_id), IDEMPOTENT_EMBED (content hash dedup)                                  |
| `docs/spec/retrieval.md`       | New    | HYBRID_BY_DEFAULT (FTS + vector), RRF_FUSION (deterministic merge), TOKEN_BUDGET_AWARE (never exceed caller's budget), RETRIEVAL_IS_A_TOOL (LangGraph tool contract, not inline code) |
| `docs/spec/database-rls.md`    | Update | Add embeddings table policies, global tenant pattern                                                                                                                                  |
| `docs/spec/graph-execution.md` | Update | Add retriever tool node pattern, context engineering guidelines                                                                                                                       |

### Tasks (rough sequence)

1. **task: pgvector setup** — Enable extension, add `embeddings` table to `db-schema`, migration. (Crawl)
2. **task: EmbeddingPort + adapter** — Port interface, Drizzle+pgvector adapter, contract tests. Embedding via LiteLLM proxy. (Crawl)
3. **task: basic vector retrieval** — Simple cosine similarity search behind port. Tool contract for LangGraph graphs. (Crawl)
4. **task: hybrid retrieval** — Add tsvector column, BM25 scoring, RRF fusion in retrieval adapter. (Walk)
5. **task: RetrievalPort + tool contract** — Unified retrieval port, LangGraph `RetrieverTool` in `ai-tools` catalog. (Walk)
6. **task: ingestion graph template** — Factory graph in `langgraph-graphs` for domain content ingestion. Source connector interface. (Walk)
7. **task: context compression** — Rolling summary utility for long-running agents. Integration with graph state. (Walk)
8. **task: retrieval eval framework** — Known-answer test harness for measuring retrieval quality. (Run)
9. **task: reranker integration** — Cohere/ColBERT reranker as optional stage in retrieval pipeline. (Run)
