---
id: chr.knowledge
type: charter
title: "KNOWLEDGE Charter"
state: Active
summary: Compounding, versioned domain knowledge that makes every node provably smarter over time.
created: 2026-04-02
updated: 2026-04-02
---

# KNOWLEDGE Charter

## Goal

Every Cogni node accumulates domain expertise in a versioned, queryable, exportable knowledge store. Knowledge compounds — agents get smarter with every interaction, research run, and outcome validation. Provable competence: you can diff what the node knew last week vs today and measure the delta.

## What Dolt Is

Dolt is git for data. Doltgres is the Postgres-compatible flavor. Same wire protocol, same SQL, same Drizzle ORM — but with native `commit`, `log`, `diff`, `branch`, `merge`. Every write creates a versioned snapshot. You can pin an analysis to a knowledge commit hash and reproduce it exactly.

Each node gets its own Doltgres database (`knowledge_operator`, `knowledge_poly`, etc.). Data sovereignty is structural — separate databases, not policy.

## Current State (v0)

### What's Built

| Component                         | What                                                                      | Where                                                              |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **KnowledgeStorePort**            | Typed CRUD + versioning interface                                         | `packages/knowledge-store/`                                        |
| **DoltgresKnowledgeStoreAdapter** | Doltgres-backed implementation (sql.unsafe + escapeValue)                 | `packages/knowledge-store/adapters/doltgres/`                      |
| **createKnowledgeCapability**     | Shared factory wrapping port → capability with auto-commit                | `packages/knowledge-store/src/capability.ts`                       |
| **3 AI Tools**                    | `core__knowledge_search`, `core__knowledge_read`, `core__knowledge_write` | `packages/ai-tools/src/tools/knowledge-*.ts`                       |
| **Brain graph wiring**            | Knowledge tools first in prompt, recall-first protocol                    | `packages/langgraph-graphs/src/graphs/brain/`                      |
| **Per-node schema**               | Base table (node-template) + domain seeds (poly)                          | `nodes/{node}/packages/knowledge/`                                 |
| **Infrastructure**                | Doltgres in docker-compose, provision + seed scripts                      | `infra/compose/runtime/doltgres-*`, `scripts/db/seed-doltgres.mts` |

### Knowledge Table Schema

```
knowledge (
  id            TEXT PRIMARY KEY      -- deterministic or human-readable
  domain        TEXT NOT NULL          -- namespace: strategy, implementation, meta, ...
  title         TEXT NOT NULL          -- human-readable summary
  content       TEXT NOT NULL          -- the claim or fact
  confidence_pct INTEGER              -- 0-100 (30=draft, 80=verified, 95=hardened)
  source_type   TEXT NOT NULL          -- human, analysis_signal, external, derived
  source_ref    TEXT                   -- URL, DOI, signal ID, analysis run ID
  tags          JSONB                  -- searchable categorization
  entity_id     TEXT                   -- optional stable subject key
  created_at    TIMESTAMPTZ           -- auto-set
)
```

### Agent Recall Protocol

1. **Search knowledge first** — before web search, before making claims
2. **High confidence (>70%)?** — use it, cite the entry ID
3. **Low confidence or stale?** — re-research, update via `knowledge_write`
4. **Not found?** — research externally, save findings at 30% confidence (draft)

### Confidence Lifecycle

```
30% (DRAFT)     → agent writes new finding, unverified
80% (VERIFIED)  → human-reviewed OR agent-confirmed with fresh sources
95% (HARDENED)  → outcome-validated, statistically significant, repeatedly confirmed
```

## Charter Work Requests

_Updated by governance skills_

| Charter | Priority | Severity | Work Item | Status | Notes               |
| ------- | -------- | -------- | --------- | ------ | ------------------- |
| —       | —        | —        | —         | —      | No pending requests |

## Principles

- **Knowledge compounds** — every interaction should leave the node smarter
- **Confidence over volume** — 10 verified claims beat 1000 drafts
- **Recall before research** — always search knowledge before web search
- **Version everything** — every write is a commit, every analysis pins a knowledge hash
- **Export-friendly** — knowledge should be exportable to Obsidian, markdown, or any graph viewer

## Projects

| Project                  | Status | Description                                                             |
| ------------------------ | ------ | ----------------------------------------------------------------------- |
| proj.poly-prediction-bot | Active | First domain consuming knowledge plane (prediction market intelligence) |

## Where We're Going

### Near Term

| Initiative              | Status                    | What                                                                                  |
| ----------------------- | ------------------------- | ------------------------------------------------------------------------------------- |
| Branching CI/CD         | story.0248 (needs_design) | Experiment branches, A/B eval, confidence-gated merge to main                         |
| Node lifecycle          | story.0263 (needs_design) | Clone from DoltHub remotes, pull operator updates, push contributions                 |
| Obsidian export         | Not started               | Export knowledge as Obsidian-compatible markdown vault — links, tags, graph view      |
| Knowledge visualization | Not started               | Web UI for browsing knowledge graph — entries, domains, confidence, provenance chains |

### Long Term

- **Cross-node federation** — validated knowledge flows between nodes via x402 payment protocol
- **Semantic search** — pgvector embeddings alongside Doltgres structured data
- **Evidence chains** — claim A supports/contradicts claim B, derived confidence
- **Automatic promotion** — awareness pipeline outcomes automatically update knowledge confidence

## Constraints

- Doltgres is Beta — storage format may change before 1.0. Pin versions, don't use for irreplaceable data without backups.
- No pgvector in Doltgres — semantic search stays in Postgres until Doltgres supports extensions.
- `sql.unsafe()` for all queries — Doltgres doesn't support the extended query protocol. Internal agents only until hardened.

## Invariants

| Rule                            | What                                                                   |
| ------------------------------- | ---------------------------------------------------------------------- |
| AWARENESS_HOT_KNOWLEDGE_COLD    | Operational data in Postgres. Curated expertise in Doltgres.           |
| KNOWLEDGE_SOVEREIGN_BY_DEFAULT  | Each node's knowledge is private. Sharing is explicit, never default.  |
| PORT_BEFORE_BACKEND             | All access through KnowledgeStorePort. Never raw SQL from consumers.   |
| CONFIDENCE_SCORED               | Every claim has a 0-100 confidence. Default draft = 30%.               |
| AUTO_COMMIT                     | Every write creates a Doltgres commit. No uncommitted knowledge.       |
| SCHEMA_GENERIC_CONTENT_SPECIFIC | One table, domain specificity in row content (domain, tags).           |
| FORK_TAKES_KNOWLEDGE            | Self-hosted node takes its Doltgres database with full commit history. |

## Success Metrics

- **Knowledge growth rate** — entries added per week, by domain
- **Confidence distribution** — % of entries at draft vs verified vs hardened
- **Recall hit rate** — % of agent queries that find relevant existing knowledge
- **Staleness** — % of entries older than 30 days without re-verification
- **Commit velocity** — Doltgres commits per day (measures active knowledge curation)

## Key References

| What                   | Where                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Spec                   | [knowledge-data-plane.md](../../docs/spec/knowledge-data-plane.md)                                                   |
| Design doc             | [knowledge-data-plane-prototype.md](../../docs/design/knowledge-data-plane-prototype.md)                             |
| Shared package         | [packages/knowledge-store/](../../packages/knowledge-store/)                                                         |
| Node schema (template) | [nodes/node-template/packages/knowledge/](../../nodes/node-template/packages/knowledge/)                             |
| Poly seeds             | [nodes/poly/packages/knowledge/](../../nodes/poly/packages/knowledge/)                                               |
| Brain prompt           | [packages/langgraph-graphs/src/graphs/brain/prompts.ts](../../packages/langgraph-graphs/src/graphs/brain/prompts.ts) |
| Seed script            | [scripts/db/seed-doltgres.mts](../../scripts/db/seed-doltgres.mts)                                                   |
| Provision script       | [infra/compose/runtime/doltgres-init/provision.sh](../../infra/compose/runtime/doltgres-init/provision.sh)           |
