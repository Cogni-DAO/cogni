---
id: knowledge-syntropy
type: spec
title: "Knowledge Syntropy — Storage, Retrieval, and Compounding Protocol for Dolt-Backed Node Knowledge"
status: draft
spec_state: draft
trust: draft
summary: "Defines how AI agents store, retrieve, cite, and compound knowledge in Dolt tables. Two agent roles — storage expert (writes structured entries with provenance) and librarian (reads with citations and confidence). Dolt is source of truth; Postgres is a derived search index for embeddings. Knowledge compounds through citation DAGs, computed confidence, and promotion lifecycles."
read_when: Building knowledge storage or retrieval agents, designing seed tables for a new node, adding a new knowledge domain, implementing the librarian or storage expert, or planning x402 knowledge access.
implements:
owner: derekg1729
created: 2026-04-02
verified:
tags:
  [knowledge, dolt, retrieval, citations, syntropy, storage, librarian, x402]
---

# Knowledge Syntropy — Storage, Retrieval, and Compounding Protocol

> Syntropy: the tendency toward increasing order and accumulation. The opposite of entropy.
> Knowledge that cites, validates, and builds on itself grows stronger over time.

### Key References

|                       |                                                                                                |                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Infrastructure**    | [knowledge-data-plane](./knowledge-data-plane.md)                                              | Doltgres server, per-node DBs, port shape          |
| **Awareness Plane**   | [monitoring-engine](./monitoring-engine.md)                                                    | What flows INTO knowledge via promotion gate       |
| **Brain / Citations** | [cogni-brain](./cogni-brain.md)                                                                | Citation guard, tool usage patterns                |
| **Repo Citations**    | [packages/ai-tools/src/capabilities/repo.ts](../../packages/ai-tools/src/capabilities/repo.ts) | Citation token format to mirror                    |
| **Node Sovereignty**  | [node-operator-contract](./node-operator-contract.md)                                          | DATA_SOVEREIGNTY, FORK_FREEDOM                     |
| **x402**              | [x402-e2e](./x402-e2e.md)                                                                      | Future: external agents pay for retrieval          |
| **Prior Research**    | [spike.0137](../../work/items/spike.0137.oss-node-research-spike.md)                           | Three-layer knowledge architecture                 |
| **Karpathy Pattern**  | [research](../research/ai-knowledge-storage-indexing-retrieval.md)                             | LLM Knowledge Bases — compile/query/file-back/lint |

## Design

### Architecture: Dolt Is Source of Truth

```
                    CONSTANT INFLOW
                    ┌─────────────────────────────────────┐
                    │ Research agents, data streams,       │
                    │ analysis signals, external crawling  │
                    └──────────────┬──────────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────────────┐
                    │         STORAGE EXPERT               │
                    │  Structures, validates, cites,       │
                    │  decides table placement,            │
                    │  writes to Dolt + commits            │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │           DOLTGRES                    │
                    │  Source of truth for all knowledge    │
                    │  Versioned (commit/log/diff)          │
                    │  Forkable, auditable, sovereign       │
                    │                                      │
                    │  Seed tables:                         │
                    │    knowledge        (claims + facts)  │
                    │    citations        (DAG edges)       │
                    │    domains          (registered)      │
                    │    sources          (external refs)   │
                    └──────────────┬──────────────────────┘
                                   │
                            Sync (one-way)
                                   │
                    ┌──────────────▼──────────────────────┐
                    │      POSTGRES (search index)         │
                    │  Derived, rebuildable from Dolt      │
                    │                                      │
                    │  knowledge_search   (embeddings)     │
                    │  knowledge_fts      (tsvector)       │
                    └──────────────┬──────────────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────────────┐
                    │          LIBRARIAN                    │
                    │  Hybrid search (FTS + vector)         │
                    │  Citation tokens in results           │
                    │  Confidence-weighted ranking          │
                    │  x402-gated for external agents       │
                    └─────────────────────────────────────┘
```

**Key distinction from knowledge-data-plane spec:** That spec puts `knowledge` in Dolt and mentions Postgres only for awareness. This spec adds a **derived search index** in Postgres specifically for retrieval performance (embeddings, full-text). The Dolt tables are authoritative; the Postgres index is a read-optimized projection that can be rebuilt from Dolt at any time.

## Goal

Define the protocol by which Cogni nodes accumulate domain expertise that compounds over time. This spec answers:

1. **What tables ship with every node?** (seed schema)
2. **How does the storage expert decide what to store and how?** (write protocol)
3. **How does the librarian search and cite knowledge?** (read protocol)
4. **How does knowledge compound instead of rot?** (syntropy principles)
5. **How does constant inflow from research agents get structured?** (inflow architecture)

The [knowledge-data-plane spec](./knowledge-data-plane.md) defines the Doltgres infrastructure and per-node database layout. This spec defines what happens **inside** those databases.

## Non-Goals

- Replacing Postgres for hot operational data (awareness plane is separate)
- Defining the Doltgres server infrastructure (see knowledge-data-plane spec)
- Implementing vector search inside Doltgres (pgvector requires Postgres)
- Designing the full x402 payment flow (see x402-e2e spec)
- Specifying agent graph architecture (see cogni-brain spec)

---

## Seed Schema: What Ships With Every Node

Every node fork inherits these four tables. They are the minimum viable knowledge infrastructure. Domain specificity lives in row content, not table structure.

### `knowledge` — Claims and facts

The atomic unit of what the node believes. Each row is a single assertion with provenance.

| Column           | Type        | Constraints               | Description                                                        |
| ---------------- | ----------- | ------------------------- | ------------------------------------------------------------------ |
| `id`             | text        | PK                        | Human-readable: `{domain}:{slug}` (e.g. `pm:fed-rate-base-rate`)   |
| `domain`         | text        | NOT NULL, FK→domains      | Registered domain key                                              |
| `entity_id`      | text        |                           | Stable subject key (market ID, project slug, etc.)                 |
| `title`          | text        | NOT NULL                  | One-line claim summary                                             |
| `content`        | text        | NOT NULL                  | Full knowledge body — the actual assertion                         |
| `entry_type`     | text        | NOT NULL                  | `observation`, `finding`, `conclusion`, `rule`, `scorecard`        |
| `status`         | text        | NOT NULL, default `draft` | `draft` → `candidate` → `established` → `canonical` → `deprecated` |
| `confidence_pct` | integer     |                           | 0–100, computed from citations (null = not applicable)             |
| `source_type`    | text        | NOT NULL                  | `human`, `agent`, `analysis_signal`, `external`, `derived`         |
| `source_ref`     | text        |                           | Pointer to origin (URL, signal ID, commit hash)                    |
| `source_node`    | text        |                           | Which AI node/agent created this                                   |
| `created_at`     | timestamptz | NOT NULL, default now     |                                                                    |
| `updated_at`     | timestamptz | NOT NULL, default now     |                                                                    |

### `citations` — The DAG that makes knowledge compound

Every edge is a directed relationship between two knowledge entries. The citation DAG is what separates compounding knowledge from a flat document store.

| Column          | Type        | Constraints            | Description                                        |
| --------------- | ----------- | ---------------------- | -------------------------------------------------- |
| `id`            | text        | PK                     | `{citing_id}→{cited_id}:{type}`                    |
| `citing_id`     | text        | NOT NULL, FK→knowledge | The entry making the citation                      |
| `cited_id`      | text        | NOT NULL, FK→knowledge | The entry being cited                              |
| `citation_type` | text        | NOT NULL               | `supports`, `contradicts`, `extends`, `supersedes` |
| `context`       | text        |                        | Why this citation exists (one sentence)            |
| `created_at`    | timestamptz | NOT NULL, default now  |                                                    |

**Unique constraint:** `(citing_id, cited_id, citation_type)` — one edge per type per pair.

### `domains` — Registered knowledge domains

Domains are structural, not tags. Every knowledge entry belongs to exactly one domain. New domains are registered explicitly — not created ad-hoc.

| Column        | Type        | Constraints           | Description                                                    |
| ------------- | ----------- | --------------------- | -------------------------------------------------------------- |
| `id`          | text        | PK                    | Short key: `prediction-market`, `infrastructure`, `governance` |
| `name`        | text        | NOT NULL              | Human-readable: "Prediction Markets"                           |
| `description` | text        |                       | What this domain covers                                        |
| `created_at`  | timestamptz | NOT NULL, default now |                                                                |

### `sources` — External reference registry

Tracks external sources that knowledge entries cite. Enables source reliability scoring over time.

| Column          | Type        | Constraints           | Description                                   |
| --------------- | ----------- | --------------------- | --------------------------------------------- |
| `id`            | text        | PK                    | URL-derived or human-readable slug            |
| `url`           | text        |                       | Canonical URL (null for non-web sources)      |
| `name`          | text        | NOT NULL              | Human-readable source name                    |
| `source_type`   | text        | NOT NULL              | `paper`, `api`, `website`, `dataset`, `human` |
| `reliability`   | integer     |                       | 0–100 estimated reliability (null = unknown)  |
| `last_accessed` | timestamptz |                       | When this source was last fetched/verified    |
| `created_at`    | timestamptz | NOT NULL, default now |                                               |

---

## The Storage Expert: Write Protocol

The storage expert is the agent role responsible for structuring and writing knowledge into Dolt. It does not retrieve — that is the librarian's job.

### When Data Arrives

Constant inflow from three channels:

```
1. Research agents     → structured findings (scorecards, tables, assertions)
2. Awareness promotion → outcome-validated signals cross the promotion gate
3. External crawling   → web data, API responses, document ingestion
```

The storage expert processes each inflow item through this protocol:

### Write Protocol Rules

**ENTRY_HAS_PROVENANCE** — Every entry must have `source_type` and `source_ref`. No knowledge without a traceable origin.

**ENTRY_HAS_DOMAIN** — Every entry belongs to exactly one registered domain. If the domain doesn't exist, register it first (new row in `domains` + Dolt commit).

**CITATIONS_ON_DERIVED** — Any entry with `source_type: 'derived'` must create at least one `citations` edge of type `supports` or `extends` pointing to the entries it was derived from.

**CONFIDENCE_INITIALIZED** — New entries start at the confidence level matching their source:

| Source Type       | Initial Confidence | Rationale                                    |
| ----------------- | ------------------ | -------------------------------------------- |
| `agent`           | 30%                | Unvalidated AI output                        |
| `analysis_signal` | 40%                | Promoted from awareness, has some validation |
| `external`        | 50%                | External source, not yet corroborated        |
| `human`           | 70%                | Human-reviewed                               |
| `derived`         | Inherited          | Average of cited entries' confidence         |

**COMMIT_PER_LOGICAL_WRITE** — Each logical write operation (which may touch multiple rows) gets one Dolt commit with a descriptive message. Not one commit per row, not batched across unrelated writes.

```sql
-- Write the entry
INSERT INTO knowledge (id, domain, title, content, ...) VALUES (...);
-- Write the citation
INSERT INTO citations (id, citing_id, cited_id, citation_type, context) VALUES (...);
-- Commit atomically
SELECT dolt_commit('-Am', 'add: fed rate cut base rate from BLS data (conf: 50%)');
```

**DEPRECATE_NOT_DELETE** — Never delete knowledge rows. Superseded entries get `status: 'deprecated'` plus a `citations` edge of type `supersedes` from the new entry. The old entry remains in Dolt history for audit.

**SOURCE_REGISTRATION** — External references should be registered in `sources` table on first use. This enables reliability tracking over time.

### When to Create New Tables

The four seed tables cover most knowledge needs. Domains don't get their own tables — they get their own rows with `domain` scoping. New tables are warranted only when:

1. **The data has a fundamentally different shape** — not just different content. If it fits in `knowledge` with `entry_type` differentiation, it goes there.
2. **The data has relationships that don't map to the citation DAG** — e.g., `strategies` have `strategy_versions` which have `strategy_evaluations`. This is a different entity lifecycle, not a knowledge claim.
3. **Query patterns require dedicated indexes** — e.g., time-series data with range scans doesn't belong in a flat knowledge table.

**Rule of thumb:** If you're tempted to create a new table, first try adding an `entry_type` to `knowledge`. If the entry_type needs more than 3 columns that other entry_types don't have, it's probably a new table.

New tables require a Dolt commit with message format: `schema: add {table_name} table — {one-line reason}`.

---

## The Librarian: Read Protocol

The librarian is the agent role responsible for retrieving knowledge with citations. It does not write — that is the storage expert's job.

### Search Strategy

The librarian searches in order of speed, escalating only when needed:

```
1. Dolt direct query    → WHERE domain = $d AND LOWER(title) LIKE LOWER('%query%')
                           Fast, no extensions needed. Sufficient at < 10K rows.

2. Postgres FTS index   → tsvector @@ plainto_tsquery($query)
                           When Dolt text search is insufficient.

3. Postgres vector      → embedding <=> $query_embedding ORDER BY distance
                           When semantic similarity matters.

4. Hybrid RRF fusion    → combine FTS + vector ranks via reciprocal rank fusion
                           When precision matters. 70/30 BM25/vector default weighting.
```

At node launch with < 1K entries, step 1 is sufficient. Steps 2–4 activate when the Postgres search index is populated.

### Citation Token Format

Mirroring the `repo:` citation token pattern from [cogni-brain](./cogni-brain.md):

```
knowledge:{node}:{entry-id}#conf={confidence}&v={dolt-commit-7}
```

Examples:

```
knowledge:poly:pm:fed-rate-base-rate#conf=72&v=abc1234
knowledge:operator:infra:k3s-memory-baseline#conf=85&v=def5678
```

**Components:**

- `knowledge:` — prefix (distinguishes from `repo:` tokens)
- `{node}` — which node's knowledge store (`poly`, `operator`, etc.)
- `{entry-id}` — the `knowledge.id` value
- `conf=` — current `confidence_pct` at time of retrieval
- `v=` — first 7 chars of the Dolt commit hash when this entry was last modified

### Citation Token Regex

```typescript
const KNOWLEDGE_CITATION_REGEX =
  /\bknowledge:[a-z0-9_-]+:[a-z0-9_:-]+#conf=\d+&v=[0-9a-f]{7}\b/g;
```

### Retrieval Output Contract

When the librarian returns results, each entry includes:

```typescript
interface KnowledgeSearchHit {
  id: string; // knowledge.id
  title: string; // knowledge.title
  content: string; // knowledge.content (or summary for large entries)
  domain: string; // knowledge.domain
  confidence_pct: number | null; // knowledge.confidence_pct
  status: string; // knowledge.status
  citation: string; // knowledge citation token
  source_refs: string[]; // top 1-3 source URLs from source_ref + sources table
  cited_by_count: number; // count of citations where cited_id = this entry
  dolt_commit: string; // 7-char commit hash
}
```

### Retrieval Rules

**SEARCH_BEFORE_INTERNET** — Agents must search node knowledge via the librarian before falling back to web search. This is the recall loop from [cogni-brain](./cogni-brain.md).

**CONFIDENCE_WEIGHTED_RANKING** — Higher-confidence entries rank above lower-confidence entries at equal relevance scores. Deprecated entries are excluded by default.

**CITATIONS_IN_RESPONSE** — Every knowledge claim in an agent's response must include the citation token. The citation guard (per cogni-brain spec) validates these.

**SOURCE_REFS_INCLUDED** — Retrieval results include the top source URLs so agents can provide human-verifiable references alongside knowledge citations.

---

## Syntropy Principles: How Knowledge Compounds

Syntropy is not automatic. It requires active maintenance. These principles define the mechanisms by which knowledge grows stronger over time instead of decaying.

### 1. Confidence Is Computed, Not Assigned

After initialization, confidence is recomputed by the storage expert whenever citations change. The formula is application-level (Doltgres has no PL/pgSQL triggers):

```
confidence = initial_confidence
           + (10 * supporting_citations, capped at +50)
           - (15 * contradicting_citations)
           + (10 if updated in last 7 days, else 0)
           - (10 if no citations added in 90 days)
           clamped to [0, 100]
```

This runs in the adapter, not as a database trigger. The storage expert calls `recomputeConfidence(entryId)` after writing citations.

### 2. Promotion Lifecycle

```
draft (< 30%)       → Single-source observation. Unvalidated.
candidate (30–60%)  → Has citations. At least one corroborating source.
established (60–80%) → Multiple corroborating sources. No unresolved contradictions.
canonical (> 80%)   → Outcome-validated or human-verified. High citation count.
deprecated          → Superseded by newer knowledge. Status set explicitly.
```

Promotion is triggered by the storage expert when confidence crosses a threshold AND one of:

- Outcome validation (awareness signal resolved correctly)
- Human review
- Statistical significance (N>30 corroborating observations)

Promotion is not automatic on confidence alone — it requires evidence.

### 3. Staleness Decay

Knowledge that is not cited, updated, or validated decays:

| Age Without Activity | Confidence Adjustment |
| -------------------- | --------------------- |
| 0–30 days            | No change             |
| 31–90 days           | -5 per 30-day period  |
| 90+ days             | -10 per 30-day period |
| 180+ days            | Flagged for review    |

The storage expert runs staleness checks periodically (cron or manual). Stale entries are not automatically deprecated — they are flagged and their confidence is reduced.

### 4. Contradiction Resolution

When a new entry has a `contradicts` citation to an existing entry:

1. Both entries get flagged for review
2. The contradicted entry's confidence is penalized (-15 per contradiction)
3. Neither is automatically deprecated — contradictions require human or outcome-based resolution
4. Resolved contradictions result in one entry being `deprecated` with a `supersedes` edge

### 5. Filing Back: The Compounding Flywheel

Every agent query that produces a useful finding should be filed back into knowledge. This is the Karpathy insight: "my explorations always add up in the knowledge base."

```
Agent asks question
  → Librarian searches knowledge
  → Agent combines knowledge with web research
  → Agent produces finding/report
  → Storage expert extracts knowledge claims from output
  → Storage expert writes to Dolt with citations to sources used
  → New entries are searchable for future queries
  → Cycle repeats
```

This is the core loop. Without it, queries are ephemeral and knowledge doesn't compound.

---

## Inflow Architecture: Handling Constant Data Streams

### Channel 1: Research Agent Outputs

```
/research produces findings
  → Storage expert parses structured claims from output
  → Each claim becomes a knowledge entry with:
      source_type: 'agent'
      source_ref: 'research:{spike-id}' or commit hash
      confidence_pct: 30% (initial agent confidence)
  → Citations created to any existing knowledge referenced
  → Dolt commit: 'ingest: {N} findings from research {id}'
```

### Channel 2: Awareness Promotion

```
analysis_signal with outcome validation (from monitoring-engine)
  → Promotion gate checks criteria (outcome-validated, repeated, etc.)
  → Storage expert creates knowledge entry with:
      source_type: 'analysis_signal'
      source_ref: 'signal:{signal_id}'
      confidence_pct: 40% (promoted signal baseline)
  → Citation to the analysis_signal record
  → Dolt commit: 'promote: signal {id} → knowledge (outcome-validated)'
```

### Channel 3: External Crawling

```
Web crawler / API poller produces raw data
  → Storage expert registers source in sources table (if new)
  → Storage expert extracts structured claims
  → Each claim becomes knowledge entry with:
      source_type: 'external'
      source_ref: source URL
      confidence_pct: 50% (external source baseline)
  → Dolt commit: 'ingest: {N} claims from {source_name}'
```

### Inflow Rate Expectations

| Node Maturity | Entries/Day | Commits/Day | Domains |
| ------------- | ----------- | ----------- | ------- |
| Week 1        | 10–50       | 5–15        | 1–2     |
| Month 1       | 50–200      | 20–50       | 2–5     |
| Month 6       | 200–1000    | 50–100      | 5–10    |
| Year 1        | 1000–5000   | 100–200     | 10+     |

At these scales, Dolt direct queries remain fast (< 10ms for indexed lookups). The Postgres search index becomes important around 1K+ entries for full-text and semantic search.

---

## Postgres Search Index: Derived and Rebuildable

The Postgres search index is a **read-optimized projection** of Dolt data. It exists solely for retrieval performance. If destroyed, it can be rebuilt from Dolt.

### Sync Direction

```
DOLTGRES (source of truth) ──→ POSTGRES (search index)
         one-way sync
         triggered after Dolt commits
```

### Search Index Table (in Postgres)

**`knowledge_search`** — embedding + full-text index for hybrid retrieval

| Column           | Type         | Description                                      |
| ---------------- | ------------ | ------------------------------------------------ |
| `id`             | text PK      | Same as knowledge.id in Dolt                     |
| `domain`         | text         | Copied from Dolt                                 |
| `title`          | text         | Copied from Dolt                                 |
| `content`        | text         | Copied from Dolt                                 |
| `status`         | text         | Copied from Dolt                                 |
| `confidence_pct` | integer      | Copied from Dolt                                 |
| `embedding`      | vector(1024) | Generated by embedding model (BGE-M3 or similar) |
| `tsv`            | tsvector     | Generated from title + content                   |
| `synced_at`      | timestamptz  | When this row was last synced from Dolt          |

**Indexes:**

```sql
CREATE INDEX idx_ks_embedding ON knowledge_search USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_ks_tsv ON knowledge_search USING gin (tsv);
CREATE INDEX idx_ks_domain_status ON knowledge_search (domain, status);
CREATE INDEX idx_ks_confidence ON knowledge_search (confidence_pct DESC)
  WHERE status != 'deprecated';
```

### Sync Mechanism

Application-level sync after Dolt commits:

1. After storage expert commits to Dolt, sync worker reads changed rows
2. For each changed row: generate embedding, compute tsvector, upsert into Postgres
3. Deprecated rows: update status in Postgres (don't delete — maintain index consistency)

Sync is eventually consistent. Librarian queries may lag behind Dolt writes by seconds. This is acceptable — knowledge queries are not real-time.

### Rebuild

```bash
pnpm knowledge:rebuild-index  # full rebuild of Postgres search index from Dolt
```

Reads all non-deprecated entries from Dolt, generates embeddings, populates `knowledge_search`. Idempotent.

---

## x402: External Knowledge Access

Future: external agents pay per-query to access a node's librarian via [x402](./x402-e2e.md).

```
External Agent
  → x402 payment (USDC on Base, upto amount)
  → Node's librarian endpoint
  → Search + retrieve with citations
  → Response includes knowledge citation tokens
  → Settlement via facilitator
```

The librarian's retrieval contract (same `KnowledgeSearchHit` shape) is the x402 response body. No separate API — the same port that internal agents use is exposed externally with x402 gating.

**What is NOT exposed via x402:**

- Write access (external agents cannot write to a node's Dolt)
- Citation DAG traversal (internal only)
- Confidence recomputation (internal only)
- Raw Dolt access (commit/log/diff)

---

## Invariants

| Rule                                       | Constraint                                                                                                                                                                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOLT_IS_SOURCE_OF_TRUTH                    | All knowledge data lives in Doltgres. Postgres search index is derived and rebuildable.                                                                                                                                                       |
| ENTRY_HAS_PROVENANCE                       | Every knowledge entry must have `source_type` and `source_ref`. No knowledge without traceable origin.                                                                                                                                        |
| ENTRY_HAS_DOMAIN                           | Every entry belongs to exactly one registered domain (FK to `domains` table).                                                                                                                                                                 |
| CITATIONS_ON_DERIVED                       | Entries with `source_type: 'derived'` must have at least one citation edge to their source entries.                                                                                                                                           |
| CONFIDENCE_APPLICATION_LEVEL               | Confidence is computed in the adapter, not via database triggers. Doltgres has no PL/pgSQL.                                                                                                                                                   |
| DEPRECATE_NOT_DELETE                       | Knowledge is never deleted. Superseded entries get `status: 'deprecated'` + `supersedes` citation edge.                                                                                                                                       |
| COMMIT_PER_LOGICAL_WRITE                   | Each logical write gets one Dolt commit with descriptive message.                                                                                                                                                                             |
| SEARCH_BEFORE_INTERNET                     | Agents search node knowledge before falling back to web search.                                                                                                                                                                               |
| CITATIONS_IN_RESPONSE                      | Agent responses referencing knowledge must include citation tokens. Citation guard validates.                                                                                                                                                 |
| SYNC_DIRECTION_DOLT_TO_POSTGRES            | Search index sync is one-way: Dolt → Postgres. Never write to Postgres search index directly.                                                                                                                                                 |
| TABLES_NEED_JUSTIFICATION                  | New Dolt tables require a fundamentally different data shape, not just different content.                                                                                                                                                     |
| NODE_KNOWLEDGE_SOVEREIGN                   | Inherited: node knowledge is private by default. Sharing is explicit.                                                                                                                                                                         |
| KNOWLEDGE_LOOP_CLOSED_VIA_SIGNED_IN_USER   | v0 merge gate: any wallet/cookie-session user can merge a contribution. Bearer-token agents cannot. The session cookie is the trust signal until per-user RBAC lands.                                                                         |
| KNOWLEDGE_BROWSE_VIA_HTTP_REQUIRES_SESSION | The `GET /api/v1/knowledge` browse endpoint is cookie-session only. Bearer / x402 access remains future work (see [x402-e2e](./x402-e2e.md)).                                                                                                 |
| DOMAIN_FK_ENFORCED_AT_WRITE                | Every write to `knowledge` verifies `domain` exists in `domains` before INSERT. Unregistered → `DomainNotRegisteredError` → HTTP 400. Contract: [knowledge-domain-registry](./knowledge-domain-registry.md).                                  |
| DOMAIN_REGISTRY_EXTENDS_VIA_UI             | Base domains are seeded by the schema migrator (reference data); UI extends beyond the base via cookie-session POST. `NODES_BOOT_EMPTY` scopes to content tables only. Contract: [knowledge-domain-registry](./knowledge-domain-registry.md). |

---

## Critical Path After v0

Ordered post-#1307. Each tier = one work item; tier N+1 is filed only when N is in flight or done. **No fan-out.** Every roadmap item that touches contracts/Zod must reference these tiers in its scoping section.

| Tier                                                                                 | Outcome                                                                                                                                                                                                                                                                                                                                               | Status                                                                                                  |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **P0** — operator-side merging                                                       | A signed-in user can list + merge open contributions through `/knowledge` (Inbox mode). Without this, the contribution flow is theatre.                                                                                                                                                                                                               | ✅ Done — PR #1308 (task.5037).                                                                         |
| **P0.5** — domain registry + FK enforcement                                          | `domains` table is enforced at write time. New 3-mode toggle (`Browse · Domains · Inbox`) lets a signed-in user register the 5 starter domains and any new ones via UI; `core__knowledge_write` and HTTP contributions both reject unregistered domains with `DomainNotRegisteredError`. Closes the entropy hole where `ENTRY_HAS_DOMAIN` was a wish. | **In flight (task.5038).** Branch `derekg1729/knowledge-domain-registry`.                               |
| **P1** — EDO-aligned `entry_type` + `citations[]` + `evaluate_at`                    | Hypothesis rows can be written + retrieved + cited; outcomes can validate them via `validates` / `invalidates` citation edges. Closes the "confidence drifts over time" mechanic at the column level.                                                                                                                                                 | Designed. Filed when P0.5 merges.                                                                       |
| **P1.5** — Poly-side route bindings                                                  | Poly mirrors operator's contribution + browse surface (currently 404 on poly).                                                                                                                                                                                                                                                                        | Trivial follow-up; combine with P1 if natural.                                                          |
| **P2** — DAG traversal in search                                                     | `core__knowledge_search` returns 1-hop neighbors + `cited_by_count` per hit. Read-side optimization on existing `citations` data.                                                                                                                                                                                                                     | Filed after P1 produces real edges.                                                                     |
| **P3** — Confidence-recompute walker                                                 | The syntropy formula in §"Confidence Is Computed, Not Assigned" actually runs over the citation DAG; supports/contradicts adjust scores.                                                                                                                                                                                                              | Needs P1+P2 first.                                                                                      |
| **P3** — `evaluate_at` cron auto-files outcomes                                      | Hypotheses become outcomes on schedule; closes EDO end-to-end. Temporal/monitoring-engine wiring.                                                                                                                                                                                                                                                     | Last piece; depends on P3 walker.                                                                       |
| **Rd-PORTABLE** — extract `/knowledge` page into `@cogni/node-template-knowledge-ui` | Operator-side `/knowledge` (task.5037) is the reference implementation; every knowledge-capable node will need its own knowledge hub. Move the page + `_api/*` + `_components/*` into a shared package, mounted from each node's `(app)/knowledge/page.tsx` as a thin re-export. Same pattern as `@cogni/node-template-knowledge` (schema).           | Filed when a second node (poly) needs `/knowledge` — the carve-out cost is amortized across nodes 2..N. |

**Anti-sprawl rule**: If a future agent considers expanding scope beyond their tier, file the next-tier work item and stop. Don't bundle.

---

## Open Questions

- [ ] Embedding model choice: BGE-M3 (self-hosted, 1024d, MIT) vs voyage-3-large (API, $0.06/1M tokens) vs defer embeddings until scale demands it?
- [ ] Sync mechanism: post-commit hook in adapter vs polling vs Temporal workflow?
- [ ] Dolt ILIKE support: confirmed broken in spike — is `LOWER(col) LIKE LOWER(...)` sufficient, or does all text search go through Postgres?
- [ ] x402 query pricing: flat per-query or proportional to result count / token size?
- [ ] Should `sources` table track per-source hit rate (how often knowledge from this source is validated)?
- [ ] Citation DAG depth limit for confidence computation — should contradictions propagate transitively?

## Related

- [knowledge-data-plane](./knowledge-data-plane.md) — Doltgres infrastructure, per-node databases, KnowledgeStorePort
- [cogni-brain](./cogni-brain.md) — citation guard, recall loop, NO_CLAIMS_WITHOUT_CITES
- [monitoring-engine](./monitoring-engine.md) — awareness plane tables, promotion criteria
- [x402-e2e](./x402-e2e.md) — payment protocol for external access
- [node-operator-contract](./node-operator-contract.md) — DATA_SOVEREIGNTY, FORK_FREEDOM
- [data-streams](./data-streams.md) — awareness pipeline, what flows into knowledge
- [Research: AI Knowledge Storage](../research/ai-knowledge-storage-indexing-retrieval.md) — embedding models, chunking, hybrid search patterns
