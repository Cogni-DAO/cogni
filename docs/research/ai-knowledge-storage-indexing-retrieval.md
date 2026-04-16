---
id: ai-knowledge-storage-indexing-retrieval
type: research
title: "AI Knowledge Storage, Indexing & Retrieval — Best Practices for Compounding AI Memory"
status: draft
trust: draft
summary: "Research report on how top teams build AI knowledge systems in Postgres — schema patterns for compounding knowledge with confidence scores, citation DAGs, hybrid search (pgvector + BM25), librarian patterns, embedding model selection, and Doltgres positioning. Grounded in Cogni's two-plane architecture."
read_when: Designing knowledge tables, choosing indexing strategy, implementing the librarian pattern, or evaluating knowledge retrieval quality.
owner: derekg1729
created: 2026-04-02
verified:
tags:
  [
    knowledge,
    postgres,
    pgvector,
    embeddings,
    retrieval,
    indexing,
    research,
    doltgres,
    citations,
  ]
---

# AI Knowledge Storage, Indexing & Retrieval

> Research report | 2026-04-02 | Status: active/draft

## Executive Summary

The best AI knowledge systems share three properties: **structured storage with embeddings**, **citation-based confidence accumulation**, and **hybrid search** (lexical + semantic). This report synthesizes current best practices and maps them to Cogni's two-plane architecture (Postgres awareness + Doltgres knowledge).

**Key findings:**

1. **Three-table core** — knowledge entries + citation edges + entity nodes — is the minimum viable schema for compounding AI memory
2. **Confidence should be computed, not assigned** — a function of evidence count, source reliability, recency, and consistency
3. **Hybrid search via RRF fusion** (70% BM25 / 30% vector) outperforms either modality alone
4. **pgvector (HNSW) + ParadeDB pg_search** is the recommended Postgres extension pair
5. **Doltgres is ideal for curated knowledge** (strategies, prompts, evaluations) but cannot host embeddings (no pgvector support)
6. **BGE-M3** (1024d, MIT, self-hosted) or **voyage-3-large** (API, cheapest per-token) are the right embedding models
7. **Recursive 512-token chunking** with contextual prepend is the proven baseline
8. **LLM-maintained index files + summaries beat RAG at small scale** — Karpathy's pattern shows ~100 articles / ~400K words is navigable without embeddings if the LLM auto-maintains an index
9. **Query outputs should file back into the wiki** — every research query that produces a finding should enhance the knowledge base for future queries (the compounding flywheel)

---

## 0. The Karpathy Pattern — LLM Knowledge Bases (April 2026)

> Source: [@karpathy](https://x.com/karpathy/status/2039805659525644595) — "LLM Knowledge Bases"

Karpathy describes a pattern where LLMs build and maintain personal knowledge bases as markdown wikis. This is the most production-validated version of the compounding knowledge loop and maps directly onto Cogni's architecture.

### The Pipeline

```
raw/                          → Source documents (articles, papers, repos, images)
  ↓ LLM "compile"
wiki/                         → Structured .md files with backlinks, categories, concepts
  ↓ LLM Q&A
outputs/                      → Reports, slides (Marp), visualizations (matplotlib)
  ↓ "Filing" back
wiki/                         → Outputs enhance the wiki for future queries
  ↓ LLM "linting"
wiki/                         → Inconsistencies fixed, missing data imputed, new connections found
```

### Key Insights for Cogni

| Karpathy Insight                                                                                                   | Implication for Cogni                                                                                                                        | Design Impact                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **LLM auto-maintains index files + brief summaries** — no fancy RAG needed at ~100 articles / ~400K words          | Phase 1 can skip embeddings entirely. Auto-maintained index files + keyword search is sufficient until scale demands more.                   | Validates spike.0229's markdown-first approach. Don't over-engineer Phase 1.                                            |
| **The LLM owns the wiki, humans rarely edit directly**                                                             | Knowledge entries should be LLM-writable, human-reviewable. The agent is the primary author; humans review and promote.                      | `source_type: 'agent'` is the default. Human edits are the exception, not the norm.                                     |
| **Query outputs file back into the wiki** — "my explorations always add up"                                        | Every `/research` session, every analysis run, every question answered should produce knowledge entries that enhance future queries.         | The `/librarian index` mode is not optional — it's the core loop. Without it, queries are ephemeral.                    |
| **LLM "health checks" / linting** — find inconsistencies, impute missing data, suggest new questions               | The curator isn't just maintenance — it's a knowledge growth engine. It should suggest what to research next, not just clean up.             | `/librarian curate` should output "suggested investigations" alongside staleness/dedup reports.                         |
| **Obsidian as IDE** — markdown + backlinks + visual plugins                                                        | Cogni's `.md` research docs already follow this pattern. Obsidian export (item 6 in handoff) is high-value for human browsing.               | Keep knowledge entries as structured markdown. Don't abandon the file-based view.                                       |
| **Ephemeral wiki per question** — "spawn a team of LLMs to construct an entire ephemeral wiki, lint, loop, report" | This maps to Doltgres branching: branch → build ephemeral knowledge → lint → merge if good. Each deep research question gets its own branch. | Future: `dolt_checkout('-b', 'research/question-123')` → agent builds wiki on branch → merge to main if quality passes. |
| **Search engine as LLM tool** — "vibe coded a search engine, hand it off to LLM via CLI"                           | The `/librarian search` mode IS this tool. It should be both human-usable and agent-callable.                                                | Dual interface: CLI for agents, web UI for humans. Same underlying query.                                               |

### What Karpathy Doesn't Solve (Where Cogni Adds Value)

Karpathy's system is single-user, single-wiki, no confidence scores, no citation tracking, no multi-node sharing. Cogni's additions:

1. **Confidence scores** computed from citation DAGs (not gut feeling)
2. **Multi-node sovereignty** — each node has its own knowledge store, shares selectively
3. **Outcome validation** — knowledge that predicts correctly gets promoted; wrong predictions get deprecated
4. **Versioned via Doltgres** — not just git on markdown files, but structural versioning with diff/branch/merge on the data itself
5. **Structured provenance** — every entry traces back to source_ref, not just "somewhere in raw/"

---

## 1. Schema Patterns for Compounding Knowledge

### The Three-Table Core

The emerging consensus from GraphRAG research, Agentic RAG (arxiv 2501.09136), and production AI systems:

```sql
-- Knowledge entries: the atomic unit of what the system believes
CREATE TABLE knowledge_entries (
    id              TEXT PRIMARY KEY,        -- deterministic or human-readable
    domain          TEXT NOT NULL,           -- 'prediction-market', 'reservations', 'infrastructure'
    entry_type      TEXT NOT NULL,           -- 'observation', 'finding', 'conclusion', 'rule', 'scorecard'
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,
    status          TEXT DEFAULT 'draft',    -- 'draft' → 'candidate' → 'established' → 'canonical' → 'deprecated'
    confidence_pct  INTEGER,                -- 0–100, computed from citations
    source_type     TEXT NOT NULL,           -- 'human', 'analysis_signal', 'external', 'derived'
    source_ref      TEXT,                    -- pointer to origin (signal ID, URL, commit hash)
    source_node     TEXT,                    -- which AI node created this
    source_session  TEXT,                    -- traceability to the conversation/run
    entity_id       TEXT,                    -- optional stable subject key (market ID, project ID)
    tags            JSONB DEFAULT '[]',
    embedding       vector(1024),           -- BGE-M3 dimensionality
    citation_count  INTEGER DEFAULT 0,       -- denormalized for query speed
    contradiction_count INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT now(),
    promoted_at     TIMESTAMPTZ,            -- when status last changed
    expires_at      TIMESTAMPTZ             -- optional TTL for temporal knowledge
);

-- Citation edges: the DAG that makes knowledge compound
CREATE TABLE knowledge_citations (
    id              TEXT PRIMARY KEY,
    citing_id       TEXT NOT NULL REFERENCES knowledge_entries(id),
    cited_id        TEXT NOT NULL REFERENCES knowledge_entries(id),
    citation_type   TEXT NOT NULL,           -- 'supports', 'contradicts', 'extends', 'supersedes'
    context         TEXT,                    -- why this citation exists
    created_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(citing_id, cited_id, citation_type)
);

-- Entity/concept nodes: the knowledge graph layer (optional, Walk phase)
CREATE TABLE knowledge_nodes (
    id              TEXT PRIMARY KEY,
    node_type       TEXT NOT NULL,           -- 'concept', 'entity', 'source', 'domain'
    name            TEXT NOT NULL,
    properties      JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- Entity-knowledge links (optional, Walk phase)
CREATE TABLE knowledge_node_edges (
    id              TEXT PRIMARY KEY,
    src_id          TEXT NOT NULL REFERENCES knowledge_nodes(id),
    dst_id          TEXT NOT NULL REFERENCES knowledge_nodes(id),
    edge_type       TEXT NOT NULL,           -- 'related_to', 'part_of', 'instance_of'
    weight          REAL DEFAULT 1.0,
    created_at      TIMESTAMPTZ DEFAULT now()
);
```

### Where Each Table Lives

| Table                  | Plane    | Why                                                    |
| ---------------------- | -------- | ------------------------------------------------------ |
| `knowledge_entries`    | Postgres | Needs pgvector for embeddings, hybrid search           |
| `knowledge_citations`  | Postgres | Joins against entries, needs recursive CTE performance |
| `knowledge_nodes`      | Postgres | Graph traversal benefits from Postgres indexes         |
| `strategies`           | Doltgres | Versioned, branchable, diffable — perfect for Dolt     |
| `strategy_versions`    | Doltgres | Same                                                   |
| `strategy_evaluations` | Doltgres | Same                                                   |
| `prompt_versions`      | Doltgres | Same                                                   |
| `scorecards`           | Doltgres | Evolving assessments benefit from diff/audit           |

**Key insight:** Embeddings must live in Postgres (pgvector). Curated knowledge metadata can be **mirrored** in Doltgres for versioning, but the embedding-searchable copy lives in Postgres.

---

## 2. Confidence Scoring: Computed, Not Assigned

Confidence should be a **function**, not a feeling. Best practice formula:

```
confidence = base + (support_weight × supports) - (contradiction_weight × contradicts) + recency_bonus - staleness_penalty
```

Concrete implementation:

```sql
CREATE OR REPLACE FUNCTION recompute_confidence(target_id TEXT)
RETURNS INTEGER AS $$
DECLARE
  supports INT;
  contradicts INT;
  age_days INT;
  conf REAL;
BEGIN
  SELECT count(*) INTO supports
    FROM knowledge_citations WHERE cited_id = target_id AND citation_type IN ('supports', 'extends');
  SELECT count(*) INTO contradicts
    FROM knowledge_citations WHERE cited_id = target_id AND citation_type = 'contradicts';
  SELECT EXTRACT(DAY FROM now() - created_at) INTO age_days
    FROM knowledge_entries WHERE id = target_id;

  conf := 10                          -- base: 10%
        + LEAST(supports * 10, 60)    -- each support adds 10%, capped at 60%
        - contradicts * 15            -- each contradiction subtracts 15%
        + CASE WHEN age_days < 7 THEN 10 ELSE 0 END   -- recency bonus
        - CASE WHEN age_days > 90 THEN 10 ELSE 0 END; -- staleness penalty

  RETURN GREATEST(0, LEAST(100, conf::INTEGER));
END;
$$ LANGUAGE plpgsql;
```

### Promotion Lifecycle

```
draft       (confidence < 30%)    — raw observation, single source
candidate   (30–60%)              — has citations, corroborated
established (60–80%)              — multiple sources, no contradictions
canonical   (> 80%)               — high citation count, outcome-validated
deprecated  (any, superseded)     — replaced by newer knowledge
```

Promotion is **not automatic** — an agent or human reviews and promotes. The confidence score is a signal, not a decision.

---

## 3. Hybrid Search: pgvector + BM25 via RRF Fusion

### Extension Stack

| Extension     | Purpose           | Status     |
| ------------- | ----------------- | ---------- |
| **pgvector**  | Vector similarity | Mature     |
| **ParadeDB**  | BM25 full-text    | Production |
| **pg_search** | ParadeDB's index  | Production |

### Index Strategy

```sql
-- Vector: HNSW for < 10M rows (better recall than IVFFlat)
CREATE INDEX idx_entries_embedding ON knowledge_entries
    USING hnsw (embedding vector_cosine_ops);

-- BM25: Full-text search
CREATE INDEX idx_entries_bm25 ON knowledge_entries
    USING bm25 (id, title, content, tags) WITH (key_field = 'id');

-- Metadata
CREATE INDEX idx_entries_domain_status ON knowledge_entries (domain, status);
CREATE INDEX idx_entries_confidence ON knowledge_entries (confidence_pct DESC) WHERE status != 'deprecated';
CREATE INDEX idx_entries_tags ON knowledge_entries USING gin (tags);

-- Citation graph traversal
CREATE INDEX idx_citations_citing ON knowledge_citations (citing_id, citation_type);
CREATE INDEX idx_citations_cited ON knowledge_citations (cited_id, citation_type);
```

### Hybrid Search Query (Reciprocal Rank Fusion)

```sql
WITH
fulltext AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY pdb.score(id) DESC) AS r
  FROM knowledge_entries
  WHERE content ||| $query_text
    AND domain = $domain
    AND status != 'deprecated'
  LIMIT 20
),
semantic AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $query_embedding) AS r
  FROM knowledge_entries
  WHERE domain = $domain
    AND status != 'deprecated'
  LIMIT 20
),
rrf AS (
  SELECT id, 0.7 / (60 + r) AS s FROM fulltext   -- 70% weight on lexical
  UNION ALL
  SELECT id, 0.3 / (60 + r) AS s FROM semantic    -- 30% weight on semantic
)
SELECT e.id, SUM(rrf.s) AS score, e.title, e.content, e.confidence_pct, e.tags
FROM rrf JOIN knowledge_entries e USING (id)
GROUP BY e.id, e.title, e.content, e.confidence_pct, e.tags
ORDER BY score DESC LIMIT 10;
```

The `k=60` constant controls rank decay. The 70/30 weighting favors lexical precision — tune based on retrieval quality. If domain-specific terms dominate, increase BM25 weight. If conceptual similarity matters more, increase vector weight.

---

## 4. Citation Chains & Provenance

### Walking the Citation DAG

```sql
WITH RECURSIVE chain AS (
  SELECT citing_id, cited_id, citation_type, 1 AS depth
  FROM knowledge_citations WHERE cited_id = $target_id
  UNION ALL
  SELECT kc.citing_id, kc.cited_id, kc.citation_type, c.depth + 1
  FROM knowledge_citations kc
  JOIN chain c ON kc.cited_id = c.citing_id
  WHERE c.depth < 10
)
SELECT e.id, e.title, e.confidence_pct, c.citation_type, c.depth
FROM chain c JOIN knowledge_entries e ON e.id = c.citing_id
ORDER BY c.depth, e.confidence_pct DESC;
```

### Citation Output Format (for Brain Agents)

```
knowledge:poly:market-maker-edge#conf=72&refs=3
```

Pattern: `knowledge:{node}:{entry-id}#conf={confidence}&refs={citation_count}`

This mirrors the existing `repo:` citation token format. Brain output should include:

1. The knowledge citation token
2. Confidence percentage
3. Top 1–3 reference URLs from `source_ref`

---

## 5. The Librarian Pattern

Three roles, three tempos:

### Indexer (real-time, post-session)

Runs after each agent session. Extracts knowledge from agent outputs:

- Parse structured findings (scorecards, tables, assertions)
- Generate embeddings via BGE-M3 or API
- Insert into `knowledge_entries`
- Create `knowledge_citations` edges to existing entries when the agent cited them
- Call `recompute_confidence()` on all affected entries

### Retriever (request-time)

Called by brain agents before answering questions:

1. Hybrid search (RRF fusion) for relevant entries
2. Filter by domain + status + minimum confidence
3. Walk citation chains for top results (add context)
4. Return ranked results with citation tokens

### Curator (scheduled, daily/weekly)

Background job that maintains knowledge quality:

- Merge near-duplicate entries (semantic similarity > 0.95)
- Flag contradictions (entries with `contradicts` edges)
- Decay confidence on stale entries (no new citations in 90 days)
- Promote high-confidence entries that meet threshold
- Generate "knowledge health" report per domain

---

## 6. Embedding Model Comparison

| Model                     | MTEB  | Dims  | Max Tokens | Cost/1M tokens | License    | Best For                     |
| ------------------------- | ----- | ----- | ---------- | -------------- | ---------- | ---------------------------- |
| **BGE-M3**                | 63.0  | 1,024 | 8K         | Free           | MIT        | Self-hosted, hybrid search   |
| **Nomic embed-text-v1.5** | ~62   | 768   | 8K         | Free           | Apache 2.0 | Fully open, small footprint  |
| **voyage-3-large**        | ~67   | 2,048 | 32K        | $0.06          | API        | Best cost/accuracy ratio     |
| **Qwen3-Embedding-8B**    | 70.58 | 7,168 | 32K        | Free           | Apache 2.0 | Best open-source (GPU heavy) |
| Gemini embedding-001      | 68.32 | 3,072 | 2K         | $0.15          | API        | Short docs, proprietary      |
| text-embedding-3-large    | 64.6  | 3,072 | 8K         | $0.13          | API        | OpenAI ecosystem             |
| Cohere embed-v4           | 65.2  | 1,024 | 128K       | $0.10          | API/VPC    | No chunking needed           |

**Recommendation:** BGE-M3 for self-hosted (MIT, proven, hybrid dense/sparse support). At 1024 dimensions, storage is ~4KB per entry — manageable at 100K+ entries per node. If self-hosting is too heavy, voyage-3-large is cheapest per token among APIs.

---

## 7. Chunking Strategy

| Strategy                      | Accuracy | Notes                                 |
| ----------------------------- | -------- | ------------------------------------- |
| **Recursive 512-token**       | 69%      | Best general-purpose, proven at scale |
| Paragraph-based               | Highest  | Best nDCG@10 for 3/4 models tested    |
| Contextual (Anthropic method) | +22–27%  | Prepend doc summary to each chunk     |
| Late chunking                 | High     | Requires compatible models (Jina)     |
| Semantic chunking             | Medium   | Fragments too small (avg 43 tokens)   |

**Recommendation:** Start with recursive 512-token splitting. Add contextual chunking (prepend a summary to each chunk) when retrieval quality needs improvement. Avoid semantic chunking — it fragments too aggressively for LLM consumption.

For Cogni's knowledge entries, most entries are already "pre-chunked" — they're structured assertions with titles, not long documents. Chunking matters primarily for ingesting external research docs and raw agent outputs.

---

## 8. Doltgres Positioning

### What Doltgres Adds

| Capability       | Value for Knowledge                                  |
| ---------------- | ---------------------------------------------------- |
| Commit history   | "What did the AI know when it made this decision?"   |
| Diff             | "What changed in our strategy between v1 and v2?"    |
| Branch (future)  | "Test a new prompt on a branch, eval, merge if good" |
| Fork inheritance | "New node inherits all accumulated expertise"        |

### What Doltgres Cannot Do

- **No pgvector** — cannot host embeddings or vector search
- **No JSONB @>** — cannot do containment queries on tags
- **No ILIKE** — case-insensitive search requires workarounds
- **3x read latency** — 7ms vs 2ms typical Postgres reads
- **postgres.js extended protocol broken** — must use `sql.unsafe()`

### Recommended Split

```
POSTGRES (primary knowledge store)
  knowledge_entries      — with embeddings, hybrid search, citations
  knowledge_citations    — DAG for confidence computation
  knowledge_nodes        — entity graph (Walk phase)

DOLTGRES (versioned curated data)
  strategies             — named decision approaches
  strategy_versions      — versioned params, diffable
  strategy_evaluations   — eval results linked to outcomes
  prompt_versions        — system prompts, versioned
  scorecards             — evolving assessments, diffable
  seed_data              — base knowledge that forks inherit
```

The promotion gate from the knowledge-data-plane spec still applies: only reviewed, repeated, or outcome-backed artifacts cross from awareness → knowledge.

---

## 9. Scorecard Schema

Scorecards are a special knowledge type — structured assessments that evolve over time.

```sql
-- In Doltgres (versioned, diffable)
CREATE TABLE scorecards (
    id              TEXT PRIMARY KEY,
    entity_id       TEXT,                    -- what's being scored (market, project, domain)
    domain          TEXT NOT NULL,
    dimension       TEXT NOT NULL,            -- 'security', 'reliability', 'cost', 'accuracy'
    metric_name     TEXT NOT NULL,
    current_value   TEXT,                     -- serialized (no JSONB in Doltgres)
    optimal_value   TEXT,
    gap_analysis    TEXT,
    confidence_pct  INTEGER DEFAULT 50,
    evidence_count  INTEGER DEFAULT 0,
    last_evaluated  TIMESTAMPTZ DEFAULT now(),
    evaluated_by    TEXT,                     -- which agent/human
    supersedes_id   TEXT REFERENCES scorecards(id)
);
```

Each scorecard update gets a `dolt_commit` — so the full history of "how our assessment changed" is built-in.

---

## 10. Fresh Node Guidance: MVP Tables

When a new Cogni node forks the template, the **minimum viable knowledge setup** is:

### Phase 1: Day 1 (shipped with template)

1. **`knowledge_entries`** in Postgres — the universal knowledge store
2. **`knowledge_citations`** in Postgres — citation DAG
3. **Seed data** — 10–20 knowledge entries covering the node's domain basics
4. **`KnowledgeStorePort`** wired to brain agent

### Phase 2: First Week

4. **Embedding pipeline** — BGE-M3 generating embeddings on write
5. **Hybrid search** — RRF fusion queries in the retriever
6. **Librarian indexer** — post-session hook saving agent findings

### Phase 3: First Month

7. **Doltgres** for strategies + scorecards
8. **Curator** background job for quality maintenance
9. **Cross-node knowledge sharing** protocol (future)

---

## 11. Knowledge Storage Protocol (Draft)

Rules for any system writing to the knowledge store:

1. **Every entry must have a `source_ref`** — no knowledge without provenance
2. **Every entry must declare `source_type`** — human, analysis_signal, external, or derived
3. **Derived entries must cite their inputs** — via `knowledge_citations` with type `extends` or `supports`
4. **Confidence starts at 10%** for single-source observations, computed upward from citations
5. **Deprecate, don't delete** — superseded knowledge gets status `deprecated` + a `supersedes` citation
6. **Domain is required** — all knowledge belongs to a domain for scoped retrieval
7. **Tags are supplementary** — domains are structural, tags are discovery aids
8. **Embeddings are generated on write** — not lazy, not batched (for MVP; batch optimization later)
9. **Doltgres commits are per-operation** — one commit per logical write, with a descriptive message

---

## 12. Architecture Summary

```
Per Cogni Node:

  POSTGRES (hot store + embeddings)
    ├── knowledge_entries     (content + embeddings + confidence)
    ├── knowledge_citations   (DAG: supports/contradicts/extends/supersedes)
    ├── knowledge_nodes       (entity graph, Walk phase)
    └── [awareness tables]    (observation_events, signals, outcomes)

  DOLTGRES (versioned curated data)
    ├── strategies            (named decision approaches)
    ├── strategy_versions     (versioned params, diffable)
    ├── strategy_evaluations  (eval results)
    ├── scorecards            (evolving assessments)
    └── seed_data             (base knowledge for forks)

  EMBEDDING: BGE-M3 (1024d, self-hosted) or voyage-3-large (API)
  CHUNKING:  Recursive 512-token with contextual prepend
  SEARCH:    RRF fusion (70% BM25 / 30% vector)
  INDEXER:   Post-session hook → knowledge_entries + citations
  CURATOR:   Scheduled job → confidence recalc, dedup, staleness decay

The Compounding Loop:
  agents write observations
    → indexer generates embeddings + creates citations
    → curator recomputes confidence via citation counting
    → high-confidence knowledge gets promoted
    → promoted knowledge gets priority in retrieval
    → agents build on promoted knowledge
    → cycle repeats
```

---

## References

- **Karpathy, "LLM Knowledge Bases" (April 2026)** — [tweet](https://x.com/karpathy/status/2039805659525644595) — raw → compiled wiki → Q&A → file back → lint loop. The foundational pattern for this report.
- **Karpathy, autoresearch (March 2026)** — autonomous ML experimentation loop, compounding knowledge via git commits
- Agentic RAG Survey (arxiv 2501.09136) — librarian pattern, three-role architecture
- pgvector HNSW benchmarks — recall/latency tradeoffs at scale
- ParadeDB pg_search — BM25 in Postgres, RRF fusion patterns
- pgvectorscale (Timescale) — StreamingDiskANN for >10M vectors
- Vectara chunking benchmark (2025) — recursive 512 best general-purpose
- Anthropic contextual chunking — +22–27% retrieval improvement
- MTEB leaderboard (April 2026) — embedding model comparison
