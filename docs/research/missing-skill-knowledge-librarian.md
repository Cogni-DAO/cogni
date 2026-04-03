---
id: missing-skill-knowledge-librarian
type: research
title: "Missing Skill: /librarian — AI Knowledge Curation & Retrieval Skill"
status: draft
trust: draft
summary: "The most critical missing skill for Cogni's data experts: a /librarian skill that indexes agent outputs into knowledge_entries, runs hybrid search retrieval, computes citation-based confidence, and curates the knowledge store. Without this, knowledge evaporates between sessions."
read_when: Building the knowledge pipeline, deciding what skills to create next, or onboarding a data-focused contributor.
owner: derekg1729
created: 2026-04-02
verified:
tags: [skills, knowledge, retrieval, indexing, curation, data-infrastructure]
---

# Missing Skill: `/librarian` — AI Knowledge Curation & Retrieval

> The #1 skill gap for Cogni's data experts
>
> _"I rarely touch the wiki directly. It's the domain of the LLM."_ — [Karpathy, April 2026](https://x.com/karpathy/status/2039805659525644595)

## Why This Skill

Karpathy's "LLM Knowledge Bases" post describes the exact pattern Cogni needs: raw data → LLM-compiled wiki → Q&A against it → outputs filed back → linting for quality. He reports ~100 articles / ~400K words is navigable without embeddings — the LLM auto-maintains index files and summaries. But his system is single-user, no confidence scores, no citations, no multi-node. Cogni's `/librarian` is the productized, multi-agent, citation-tracked version.

Every other skill in the system **produces** knowledge — `/research` writes findings, `/constraint-evaluator` writes assessments, `/monitoring-expert` writes dashboards. But nothing **curates** that knowledge. The result:

- Research evaporates between sessions
- The same questions get re-researched (spike.0229 identified 38 orphaned research docs)
- Confidence scores are assigned by gut, not computed from evidence
- No agent can answer "what do we know about X?" with citations
- Scorecards are static snapshots, not living assessments

The `/librarian` skill closes this loop. It's the skill that makes all other skills compound.

---

## What It Does

### Three Modes

#### 1. `/librarian index` — Post-Session Harvesting

After a research session or analysis run, the librarian:

1. Scans recent agent outputs (research docs, analysis signals, scorecard updates)
2. Extracts structured knowledge claims (assertions, findings, scores)
3. Generates embeddings (BGE-M3 or configured model)
4. Creates `knowledge_entries` with proper `source_ref` and `source_type`
5. Creates `knowledge_citations` edges when the output cited existing knowledge
6. Calls `recompute_confidence()` on all affected entries
7. Commits to Doltgres if curated knowledge was updated

**Trigger:** Run manually after `/research` or `/constraint-evaluator`, or automatically via post-session hook.

#### 2. `/librarian search <query>` — Hybrid Retrieval

When an agent or human needs to know what the system believes:

1. Runs RRF fusion search (BM25 + vector) scoped to specified domain
2. Filters by status and minimum confidence
3. Walks citation chains for top results
4. Returns results with citation tokens: `knowledge:poly:market-maker-edge#conf=72&refs=3`
5. Includes top reference URLs from `source_ref`

**Output format:**

```markdown
## Knowledge Search: "market maker edge in prediction markets"

### Results (3 entries, domain: prediction-market)

1. **Market makers exploit binary pricing inefficiencies** [conf: 72%, 3 refs]
   knowledge:poly:market-maker-edge#conf=72&refs=3
   Source: research/crypto-domain-purchasing-landscape.md
   Top ref: https://example.com/paper

2. **Base rate anchoring improves calibration by 15-20%** [conf: 85%, 5 refs]
   knowledge:poly:base-rate-anchoring#conf=85&refs=5
   Source: analysis_signal sig.0045
   Top refs: https://metaculus.com/calibration, https://arxiv.org/...

3. ...
```

#### 3. `/librarian curate` — Quality Maintenance + Growth Suggestions

Scheduled or manual quality pass. This is Karpathy's "linting" step — but with teeth.

1. **Staleness check** — entries with no new citations in 90 days get confidence decay
2. **Deduplication** — entries with semantic similarity > 0.95 flagged for merge
3. **Contradiction detection** — entries with `contradicts` edges surfaced for review
4. **Promotion candidates** — entries above threshold flagged for status upgrade
5. **Gap detection** — find domains with thin coverage, suggest investigations (Karpathy: "find interesting connections for new article candidates")
6. **Imputation** — flag entries with missing fields, attempt to fill from web search
7. **Health report** — per-domain stats (total entries, avg confidence, stale count)

**Output format:**

```markdown
## Knowledge Health Report

| Domain            | Entries | Avg Conf | Canonical | Stale | Contradictions |
| ----------------- | ------- | -------- | --------- | ----- | -------------- |
| prediction-market | 47      | 54%      | 8         | 12    | 2              |
| infrastructure    | 23      | 68%      | 5         | 3     | 0              |
| governance        | 11      | 41%      | 1         | 6     | 1              |

### Action Items

- [ ] 12 stale prediction-market entries need review or deprecation
- [ ] 2 contradictions in prediction-market need resolution
- [ ] 6 governance entries have no citations — index supporting evidence

### Suggested Investigations

- "What is the current state of on-chain governance tooling?" (governance domain is thin, 11 entries)
- "How do prediction market base rates compare to superforecaster benchmarks?" (extends 3 existing entries)
- "Are there newer alternatives to ParadeDB for hybrid search?" (infrastructure entry from 2026-04-02)
```

#### 4. `/librarian export` — Markdown Export from Dolt

Read-only export of Dolt knowledge into browsable formats:

1. Query Dolt for all non-deprecated entries, grouped by domain
2. Generate markdown files with frontmatter, backlinks between cited entries
3. Output to `docs/knowledge/` or Obsidian vault (wiki-links format)
4. Include per-domain index with summaries and confidence scores

This is an **export format**, not the storage format. Dolt tables are source of truth. Markdown is a human-readable view. See [knowledge-syntropy spec](../../docs/spec/knowledge-syntropy.md) for the architecture.

---

## Implementation Sketch

### Skill Definition

```yaml
name: librarian
description: >
  AI knowledge retrieval and curation from Dolt. READ-ONLY by default.
  /librarian search <query> — hybrid search with citations
  /librarian curate — quality maintenance + growth suggestions
  /librarian export — markdown export from Dolt tables
  Storage writes are the STORAGE EXPERT's job, not the librarian's.
trigger: >
  When user asks to search or curate knowledge.
  When user asks "what do we know about X?"
  When user wants a knowledge health report.
```

### Dependencies

| Dependency            | Status       | Notes                                 |
| --------------------- | ------------ | ------------------------------------- |
| `knowledge_entries`   | Not built    | task.0231 P1 deliverable              |
| `knowledge_citations` | Not built    | Add to task.0231 scope                |
| `KnowledgeStorePort`  | Not built    | task.0231 P1 deliverable              |
| pgvector extension    | Available    | Already in Postgres, needs enabling   |
| ParadeDB pg_search    | Not added    | New dependency for BM25               |
| Embedding model       | Not chosen   | BGE-M3 recommended (self-hosted, MIT) |
| Doltgres              | task.0231 P0 | Infrastructure being scaffolded       |

### What Blocks It

The skill can be built incrementally:

1. **Phase 1 (no embeddings):** Keyword search on `title` + `content` + `tags`. Works with plain Postgres `tsvector` or even ILIKE. This is the markdown adapter from spike.0229 but against a real table.
2. **Phase 2 (embeddings):** Add pgvector, generate embeddings on write, enable hybrid search.
3. **Phase 3 (full librarian):** Curator mode, citation confidence computation, scheduled curation.

Phase 1 is unblocked today once `knowledge_entries` table exists.

---

## Why This Is the #1 Missing Skill

### Comparison to Existing Skills

| Skill                   | Produces Knowledge | Retrieves Knowledge | Curates Knowledge |
| ----------------------- | ------------------ | ------------------- | ----------------- |
| `/research`             | Yes                | No                  | No                |
| `/constraint-evaluator` | Yes                | No                  | No                |
| `/monitoring-expert`    | Yes (dashboards)   | No                  | No                |
| `/deploy-node`          | No                 | No                  | No                |
| `/dns-ops`              | No                 | No                  | No                |
| **`/librarian`**        | **Yes (indexes)**  | **Yes (search)**    | **Yes (curates)** |

Without `/librarian`, knowledge production is a write-only pipeline. Every skill writes to docs or databases, but no skill reads back what was learned, verifies it, or builds on it. The compounding loop is broken.

### The Compounding Flywheel

```
/research produces findings
  → /librarian index harvests them into knowledge_entries
  → /librarian search makes them retrievable by brain agents
  → brain agents cite existing knowledge in new analysis
  → /librarian curate promotes high-confidence, deprecates stale
  → /research uses existing knowledge as starting point (not blank slate)
  → cycle compounds
```

This is the Karpathy "autoresearch" pattern applied to organizational knowledge: each cycle starts from where the last one left off, with accumulated evidence and growing confidence scores.

---

## Guidance for Data Experts

### For the Developer Building This

1. **Start with Phase 1** — keyword search, no embeddings. Get the table + port + basic retrieval working.
2. **Wire it into brain agents first** — the brain should call `/librarian search` before `web_search`. This is the spike.0229 vision.
3. **Add embeddings second** — BGE-M3, HNSW index, RRF fusion. This is when retrieval quality jumps.
4. **Build the curator last** — the indexer and retriever are more valuable than automated curation initially.

### For the Node Operator Adding Domain Knowledge

1. **Seed with 10–20 entries** covering your domain's fundamentals
2. **Run `/librarian index` after every `/research` session** — this is the habit that compounds
3. **Review the health report weekly** — `/librarian curate` surfaces what needs attention
4. **Don't manually set confidence** — let citations compute it. Your job is to create citation edges, not assign numbers.

### For the Knowledge Protocol

See the full Knowledge Storage Protocol in [ai-knowledge-storage-indexing-retrieval.md](./ai-knowledge-storage-indexing-retrieval.md) section 11.

---

## Relationship to Existing Work

| Work Item  | Relationship                                                      |
| ---------- | ----------------------------------------------------------------- |
| task.0231  | Provides the tables + port this skill needs                       |
| spike.0229 | Defined the KnowledgeCapability port — this skill is its consumer |
| spike.0137 | Three-layer architecture research — informs schema design         |
| poly-brain | First consumer — should search knowledge before analysis          |

---

## Next Steps

1. **Finalize knowledge-syntropy spec** — seed tables, write protocol, citation format. See [docs/spec/knowledge-syntropy.md](../../docs/spec/knowledge-syntropy.md).
2. **Build seed tables in Dolt** — `knowledge`, `citations`, `domains`, `sources` (extends task.0231 scope)
3. **Build storage expert skill** — `.claude/skills/storage-expert/` — writes structured entries to Dolt with provenance and citations
4. **Build librarian skill** — `.claude/skills/librarian/` — search + curate + export (read-only against Dolt)
5. **Wire `/librarian search` into brain** — add `core__knowledge_search` to brain tool list (recall loop)
6. **Build Postgres search index sync** — one-way Dolt → Postgres for embeddings + FTS
7. **Evaluate ParadeDB** — can it run alongside pgvector in our Postgres container?
8. **Choose embedding model** — BGE-M3 self-hosted vs voyage-3-large API, based on cost constraints
