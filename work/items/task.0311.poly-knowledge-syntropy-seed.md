---
id: task.0311
type: task
title: "Poly Knowledge Seeds v0 — Polymarket Strategy Content + Upsert Bug Fix"
status: done
priority: 1
rank: 2
estimate: 1
summary: "Replace placeholder poly knowledge seeds with 13 real Polymarket strategy entries covering edge-finding, market structure, methodology, risk management, and data sources. Fix upsertKnowledge() adapter bug where EXCLUDED references fail on Doltgres. Add root workspace deps so the seed script can resolve the node-level knowledge packages."
outcome: "knowledge_poly contains 14 committed entries (1 base + 13 poly-specific) queryable via core__knowledge_search. Upsert works reliably against Doltgres. Seed script is idempotent on re-run."
spec_refs:
  - knowledge-data-plane-spec
  - knowledge-syntropy
assignees: derekg1729
project: proj.poly-prediction-bot
created: 2026-04-15
updated: 2026-04-17
labels: [poly, knowledge, doltgres, syntropy, seed]
---

# Poly Knowledge Seeds v0 — Polymarket Strategy Content + Upsert Bug Fix

> Spec: [knowledge-syntropy](../../docs/spec/knowledge-syntropy.md) · [knowledge-data-plane](../../docs/spec/knowledge-data-plane.md)
> Project: [proj.poly-prediction-bot](../projects/proj.poly-prediction-bot.md)
> Follows: task.0231 (done) · PR #887 (poly-brain LangGraph catalog registration, merged)
> Research: [poly-strategy-knowledge-ingestion-mcp](../../docs/research/poly-strategy-knowledge-ingestion-mcp.md)

## Context

Task.0231 shipped the Doltgres knowledge plane: `knowledge_poly` database, `KnowledgeStorePort`, `DoltgresKnowledgeStoreAdapter`, and `core__knowledge_search/read/write` wired into poly-brain. The `@cogni/poly-knowledge` package existed but contained only 3 placeholder seeds about system architecture — no actual Polymarket trading knowledge for the brain to cite.

This task seeds `knowledge_poly` with real strategy content and fixes a bug discovered while verifying the seed path end-to-end.

## Design

### Outcome

Poly-brain can search, read, and cite real Polymarket edge-finding + risk-management knowledge via `core__knowledge_search({ domain: 'prediction-market', query: ... })`. Each entry is confidence-scored, tagged by category, and sourced (real URLs in `sourceRef`).

### Approach

Replace the 3 placeholder entries in `nodes/poly/packages/knowledge/src/seeds/poly.ts` with 13 substantive entries organized by category (edge-finding, market structure, methodology, risk management, data). Fix the adapter's broken upsert. Register the node-level knowledge packages as root workspace deps so the seed script can resolve them.

**Reuses:**

- Existing `@cogni/poly-knowledge` package and `NewKnowledge` type — no new schema needed
- Existing `scripts/db/seed-doltgres.mts` — no script changes required
- Existing `createKnowledgeCapability().write()` flow — seeds flow through the same path agent writes use

**Rejected:**

- **Adding entry_type/status/source_node/updated_at schema columns** — out of scope for v0. Current `NewKnowledge` shape (id, domain, title, content, sourceType, sourceRef, confidencePct, tags) carries enough structure to ship useful seeds. Syntropy columns can land when the storage-expert agent has concrete need for them.
- **Adding citations/domains/sources tables** — same reason: no consumer exists. Can land when a curator agent or promotion gate is built.
- **Registering a formal `domains` table row** — premature. The `domain: 'prediction-market'` column value is sufficient for v0 retrieval.
- **Splitting into per-category sub-domains** (`polymarket-strategy`, `polymarket-edge`, `polymarket-risk`) — tags + `entry_type` patterns in the ID (e.g. `pm:edge:*`, `pm:risk:*`) cover this without fragmenting the domain namespace.

### Changes

**`nodes/poly/packages/knowledge/src/seeds/poly.ts`** (modified) — replaced 3 placeholder entries with 13 substantive seeds:

- 4 **edge-finding** entries: favorite-longshot bias, correlated-market arbitrage, news-velocity mispricing windows, resolution-clarity mispricing
- 3 **market-structure** entries: CLOB mechanics (Polygon + USDC + CTF), liquidity concentration patterns, rewards program for market-makers
- 2 **methodology** entries: base-rate anchoring discipline, Kelly-criterion sizing
- 3 **risk-management / anti-pattern** entries: fee + spread awareness, narrative-conviction trap, illiquid-market oversizing
- 1 **data-source** entry: Polymarket HuggingFace datasets + Gamma/CLOB/Goldsky

ID convention: `pm:{category}:{slug}`. All entries use `domain: 'prediction-market'`. Confidence: `VERIFIED` (80) for human-reviewed + well-established, 70 for major findings with academic backing, 50–60 for external-sourced strategy content. `sourceRef` URLs verified live.

**`packages/knowledge-store/src/adapters/doltgres/index.ts`** (modified) — fixed `upsertKnowledge()` which used `ON CONFLICT ... EXCLUDED.col` references that Doltgres does not support (confirmed via direct psql test). Replaced with try-INSERT / catch-duplicate / fallback-UPDATE pattern. Added guard for deleted-between-insert-and-update race.

**`package.json`** (modified) — added `@cogni/node-template-knowledge` and `@cogni/poly-knowledge` as root workspace deps, following the pattern PR #810 used for `@cogni/knowledge-store`. Required because `scripts/db/seed-doltgres.mts` runs from root and uses dynamic `import()` — without the root decls the imports silently fail and zero seeds apply.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [x] ENTRY_HAS_PROVENANCE: every seed has non-null `sourceType`; external entries have `sourceRef` URLs (spec: knowledge-syntropy)
- [x] SCHEMA_GENERIC_CONTENT_SPECIFIC: poly-specific content lives in seed rows, not schema (spec: knowledge-data-plane)
- [x] PACKAGES_NO_ENV: knowledge-store adapter still takes `sql` via constructor, not `process.env` (spec: packages-architecture)
- [x] AUTO_COMMIT: every seed write creates a Dolt commit via `createKnowledgeCapability().write()` (spec: knowledge-data-plane)
- [x] SIMPLE_SOLUTION: zero new tables, zero new ports, zero new packages. Seeds go through the existing write path.
- [x] UPSERT_DOLTGRES_COMPATIBLE: upsertKnowledge works on this Doltgres version

## Acceptance Criteria

- [x] `pnpm packages:build` succeeds
- [x] `pnpm db:seed:doltgres:poly` (or equivalent) writes 14 entries to `knowledge_poly`
- [x] Re-running the seed is idempotent (skips "already committed" entries)
- [x] `SELECT * FROM dolt_log` shows one commit per seed entry
- [x] Search query `WHERE domain = 'prediction-market' AND LOWER(content) LIKE '%edge%'` returns 10+ relevant results
- [x] `pnpm check:docs` passes
- [x] `pnpm format` clean

## Validation

```
✅ 14 entries seeded into knowledge_poly
✅ Idempotent re-run (unchanged entries skip with "nothing to commit")
✅ Search for "edge" returns 10 relevant results
✅ Search URLs: Wikipedia favorite-longshot bias, Medium strategy posts, Polymarket docs, HuggingFace datasets — all resolve (200)
✅ pnpm packages:build — all 29 packages declarations OK
✅ pnpm check:docs — 576 files, 576 unique IDs
```

## Out of Scope / Follow-ups

1. **Storage-expert agent** — bridges awareness-plane `ObservationEvent` → promoted `knowledge` entries (task.0227 shipped the source; promotion path is unbuilt).
2. **MCP ingestion job** — per `docs/research/poly-strategy-knowledge-ingestion-mcp.md`: Firecrawl + curated seed URL list → new `knowledge` entries at `status='candidate'` when that column lands.
3. **Syntropy schema columns** (`entry_type`, `status`, `updated_at`) — when a concrete consumer needs them. Blocked on the storage-expert or curator role materializing.
4. **Citations / domains / sources tables** — deferred to when the citation DAG has a real writer.
5. **Postgres search index** (embeddings + FTS) — deferred to when corpus grows past ~1K entries.
6. **Per-niche sub-domains** (`polymarket-strategy`, etc.) — deferred; tag-based retrieval works at current corpus size.

## Related

- [task.0231](./task.0231.knowledge-data-plane.md) — shipped the baseline this task seeds
- PR [#887](https://github.com/Cogni-DAO/cogni-template/pull/887) — poly-brain LangGraph catalog registration (merged); unblocks agent-side reads of these seeds
- [knowledge-syntropy spec](../../docs/spec/knowledge-syntropy.md) — north-star for future schema additions
- [poly-strategy-knowledge-ingestion-mcp research](../../docs/research/poly-strategy-knowledge-ingestion-mcp.md) — MCP ingestion options for continuous content updates
