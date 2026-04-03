---
id: task.0231.handoff
type: handoff
work_item_id: task.0231
status: active
created: 2026-04-02
updated: 2026-04-02
branch: feat/knowledge-data-plane
last_commit: 94c0d5a3a
---

# Handoff: Knowledge Data Plane — What's Next

## Context

- Cogni nodes now have a Doltgres-backed knowledge store — versioned domain expertise separate from hot Postgres operational data
- The brain agent has 3 knowledge tools (`core__knowledge_search/read/write`) with a recall-first prompt (search knowledge before web search)
- Each node gets its own Doltgres database (`knowledge_operator`, `knowledge_poly`, etc.) with structural isolation
- Per-node seed data lives in `nodes/{node}/packages/knowledge/` and is applied via `scripts/db/seed-doltgres.mts`
- PR #692 delivers the full v0: port, adapter, capability, tools, brain wiring, infra, seeds, env alignment
- KNOWLEDGE charter at `work/charters/KNOWLEDGE.md` defines the vision and invariants

## Current State

- **Done:** KnowledgeStorePort + DoltgresKnowledgeStoreAdapter, 3 AI tools in catalog, brain graph wired, per-node schema packages, Docker Compose service, provision + seed scripts, env vars aligned with multi-node pattern (`DOLTGRES_URL_OPERATOR/POLY/RESY`)
- **Working e2e:** `pnpm dev:stack` → `pnpm dev:setup` → brain agent reads/writes knowledge via tools
- **Not done:** No `/knowledge` skill for Claude Code agents. No graph-specific knowledge tools (poly-brain doesn't use knowledge yet). No Obsidian export. No knowledge visualization UI. No branching/CI/CD.
- **Key limitation:** `sql.unsafe()` for all Doltgres queries (extended protocol broken). Internal agents only.

## Decisions Made

- [Knowledge data plane spec](../../docs/spec/knowledge-data-plane.md) — two planes, promotion gate, agent access, confidence defaults
- [KNOWLEDGE charter](../../work/charters/KNOWLEDGE.md) — data segments (Postgres ops / Redis streams / Doltgres knowledge / Git code), confidence lifecycle (30/80/95), principles
- Schema lives in node packages, not shared `db-schema` — each node may add companion tables
- `createKnowledgeCapability(port)` is a shared factory — all nodes use it, auto-commits on every write

## Next Actions

The most important next phase is **making knowledge useful to agents in practice**.

- [ ] **Create `/knowledge` skill** for Claude Code — wraps the 3 tools so terminal agents can search/read/write knowledge. See existing skills in `.claude/skills/` for the pattern.
- [ ] **Wire knowledge into poly-brain graph** — poly-brain should search `strategy` and `implementation` domains before analysis. Update its prompt + tool list in `nodes/poly/graphs/`.
- [ ] **Research graph → knowledge write** — after research, auto-save findings to Doltgres at 30% confidence. Wire `core__knowledge_write` into research graph tools.
- [ ] **Confidence promotion workflow** — when analysis signals are outcome-validated, bump supporting knowledge from 30→80%. Needs monitoring-engine integration.
- [ ] **Data segmentation guide** — dedicated doc covering all 4 data planes. Noted in KNOWLEDGE charter roadmap.
- [ ] **Obsidian export** — export knowledge entries as markdown with YAML frontmatter + wiki-links. Enables offline browsing and graph visualization.

## Risks / Gotchas

- **Doltgres Beta** — storage format may change. Pin image version for production.
- **`escapeValue()` is hand-rolled SQL escaping** — internal agents only. Harden before x402 external exposure.
- **`dolt_commit` on clean working set** may error. The capability wraps this but `provision.sh` does not — wrap in `|| true` if re-provisioning fails.
- **Seed script loads all node seeds** — tries `@cogni/poly-knowledge` for every database. Harmless (silent catch, upsert) but double-writes base seeds for poly.

## Pointers

| File / Resource                                                                                          | Why it matters                                                   |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [KNOWLEDGE charter](../../work/charters/KNOWLEDGE.md)                                                    | Vision, data segments, principles, success metrics               |
| [Spec](../../docs/spec/knowledge-data-plane.md)                                                          | Authoritative design — agent access, confidence, recall protocol |
| [packages/knowledge-store/](../../packages/knowledge-store/)                                             | Shared port + adapter + capability factory                       |
| [packages/ai-tools/src/tools/knowledge-\*.ts](../../packages/ai-tools/src/tools/)                        | 3 BoundTool definitions                                          |
| [packages/ai-tools/src/capabilities/knowledge.ts](../../packages/ai-tools/src/capabilities/knowledge.ts) | KnowledgeCapability interface + CONFIDENCE constants             |
| [packages/langgraph-graphs/src/graphs/brain/](../../packages/langgraph-graphs/src/graphs/brain/)         | Brain prompt + tool list (knowledge-first)                       |
| [nodes/poly/packages/knowledge/](../../nodes/poly/packages/knowledge/)                                   | Poly seeds (strategy, implementation domains)                    |
| [scripts/db/seed-doltgres.mts](../../scripts/db/seed-doltgres.mts)                                       | Per-node seed runner                                             |
| [story.0248](../../work/items/story.0248.dolt-branching-cicd.md)                                         | Branching CI/CD — experiment → eval → merge                      |
| [story.0263](../../work/items/story.0263.doltgres-node-lifecycle.md)                                     | Node lifecycle — clone/pull/push from remotes                    |
