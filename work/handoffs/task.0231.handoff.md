---
id: task.0231.handoff
type: handoff
work_item_id: task.0231
status: active
created: 2026-04-01
updated: 2026-04-02
branch: feat/knowledge-data-plane
last_commit: e21f97f
---

# Handoff: Knowledge Data Plane — Doltgres Prototype

## Context

- task.0231 adds a versioned knowledge store (Doltgres) to the node-template, separating curated domain expertise from hot operational data (Postgres)
- Part of proj.poly-prediction-bot Walk/P1 — unblocks poly-synth reasoning graph reading strategies from a typed port instead of hardcoded strings
- Doltgres is Postgres-compatible with native git-like versioning (commit, log, diff) — same wire protocol, same DDL
- Spike validated full stack: postgres.js driver, role-based auth, all Dolt versioning functions — 13 integration tests passing
- Architecture: shared `packages/knowledge-store/` (port + adapter) + per-node schema/seeds at `nodes/{node}/packages/knowledge/`

## Current State

- **Built + tested:** `KnowledgeStorePort`, `DoltgresKnowledgeStoreAdapter`, `buildDoltgresClient()`, Zod domain types, base schema + DDL, node-template + poly seed data, 13 integration tests passing against live Doltgres
- **Not built:** Docker Compose service, provisioning init script, `.env.local.example` updates, seed runner script, Zod unit tests, root tsconfig references
- **Not verified:** `pnpm check` (typecheck + lint + format), `pnpm packages:build`
- **Blocked by nothing** — all risks de-risked in spike

## Decisions Made

- **postgres.js parameterized queries don't work on Doltgres** — adapter uses `sql.unsafe()` + `escapeValue()` for all queries. See [design doc](../docs/design/knowledge-data-plane-prototype.md) and [AGENTS.md](../../packages/knowledge-store/AGENTS.md)
- **Schema lives in node packages, not db-schema** — Doltgres tables must not pollute Postgres migration pipeline. Each node owns its schema at `nodes/{node}/packages/knowledge/`. Reviewed and approved.
- **No RLS** — per-node databases provide structural isolation. Two roles: `knowledge_reader` (SELECT), `knowledge_writer` (DML + dolt_commit)
- **JSONB `@>` and ILIKE not supported** — fallbacks: `CAST(tags AS TEXT) LIKE` and `LOWER(col) LIKE`. Documented in AGENTS.md.
- **Node directory convention** — `nodes/{node}/packages/{concern}/` approved as target layout. `pnpm-workspace.yaml` updated with `nodes/*/packages/*` pattern.
- **Poly seeds pruned** — poly-specific seeds are out of scope for this task; use node-template starter seeds for all nodes

## Next Actions

- [ ] Add `doltgres` service to `infra/compose/runtime/docker-compose.dev.yml` (image: `dolthub/doltgresql:latest`, port 5435, healthcheck: `nc -z localhost 5432`)
- [ ] Write `infra/compose/runtime/doltgres-init/provision.sh` — create DBs, roles, apply DDL from `KNOWLEDGE_TABLE_DDL`, seed, commit (follow existing `postgres-init/provision.sh` pattern)
- [ ] Add `DOLTGRES_URL`, `DOLTGRES_PASSWORD` to `.env.local.example`
- [ ] Add root `tsconfig.json` references for knowledge-store + node knowledge packages
- [ ] Run `pnpm check` — fix any typecheck/lint/format issues
- [ ] Write 3-5 Zod unit tests (pure, no Docker) in `packages/knowledge-store/tests/schemas.test.ts`
- [ ] Tag integration tests to run under `test:stack:*` only (skip in `pnpm test`)
- [ ] Wire `core__knowledge_search` + `core__knowledge_read` BoundTools in `packages/ai-tools/`

## Risks / Gotchas

- **`escapeValue()` is hand-rolled SQL escaping** — covers single quotes but not backslash/NUL byte edge cases. Acceptable for internal-agent-only access. Harden before exposing to external input (x402 phase).
- **Doltgres healthcheck has no `pg_isready`** — use TCP check (`nc -z`) or Node.js net.connect, not `pg_isready`
- **`fetch_types: false` required** — non-superuser postgres.js connections fail without this. Always use `buildDoltgresClient()`.
- **Integration tests require running Doltgres container** — `docker run -d --name doltgres-test -e DOLTGRES_PASSWORD=doltgres -p 5435:5432 dolthub/doltgresql:latest`
- **Drizzle table def is for types only** — do NOT run `drizzle-kit push` against Doltgres. DDL applied via raw SQL in provisioning script.

## Pointers

| File / Resource                                                                                            | Why it matters                                                        |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [Spec](../../docs/spec/knowledge-data-plane.md)                                                            | Authoritative design — two planes, promotion gate, invariants         |
| [Design doc](../../docs/design/knowledge-data-plane-prototype.md)                                          | Spike results, auth model, agent tooling roadmap, Docker service YAML |
| [packages/knowledge-store/](../../packages/knowledge-store/)                                               | Shared port + adapter package                                         |
| [packages/knowledge-store/AGENTS.md](../../packages/knowledge-store/AGENTS.md)                             | Doltgres compat table, arch diagram, responsibilities                 |
| [nodes/node-template/packages/knowledge/](../../nodes/node-template/packages/knowledge/)                   | Base schema + DDL + starter seed                                      |
| [nodes/poly/packages/knowledge/](../../nodes/poly/packages/knowledge/)                                     | Poly-specific seeds (to be pruned — use node-template seeds)          |
| [infra/compose/runtime/postgres-init/provision.sh](../../infra/compose/runtime/postgres-init/provision.sh) | Pattern to follow for doltgres-init/provision.sh                      |
| [task.0231](../items/task.0231.knowledge-data-plane.md)                                                    | Work item with acceptance criteria and deliverable matrix             |
