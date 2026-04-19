---
id: task.0311
type: task
title: "Poly Knowledge Plane v0 — Candidate-a Wiring + Upsert Bug Fix (Clean-Slate Nodes)"
status: done
priority: 1
rank: 2
estimate: 2
summary: "Ship Doltgres on candidate-a end-to-end via flight-infra: drizzle-kit-authored schema in a new @cogni/poly-doltgres-schema workspace package, native drizzle-kit migrator running inside the poly migrator Docker image, Compose service + k8s EndpointSlice bridge, per-node DOLTGRES_URL_POLY in k8s secrets. Nodes boot clean — no deploy-time seed rows. Also fixes upsertKnowledge() adapter bug where Doltgres rejects ON CONFLICT ... EXCLUDED."
outcome: "poly-brain reaches knowledge_poly on candidate-a with zero manual VM steps post-merge. Schema source of truth is drizzle-kit; application uses drizzle-kit's native migrator (tested against Doltgres 0.56.0+). The only Doltgres-specific add-on is one trailing SELECT dolt_commit('-Am', ...) to capture DDL into dolt_log. No seed content — the brain accumulates knowledge itself."
spec_refs:
  - knowledge-data-plane-spec
  - knowledge-syntropy
  - multi-node-tenancy
  - databases
assignees: derekg1729
project: proj.poly-prediction-bot
created: 2026-04-15
updated: 2026-04-18
labels: [poly, knowledge, doltgres, candidate-a]
---

# Poly Knowledge Plane v0 — Candidate-a Wiring + Upsert Bug Fix

> Spec: [knowledge-data-plane](../../docs/spec/knowledge-data-plane.md) · [multi-node-tenancy](../../docs/spec/multi-node-tenancy.md) · [databases](../../docs/spec/databases.md)
> Project: [proj.poly-prediction-bot](../projects/proj.poly-prediction-bot.md)
> Follows: task.0231 (knowledge data plane baseline, done) · task.0324 (#916 per-node DB schema independence, merged) · #887 (poly-brain catalog, merged)
> Database skill: `.claude/skills/database-expert/SKILL.md`

## Context

Task.0231 shipped the Doltgres knowledge plane surface area — `knowledge_poly` database, `KnowledgeStorePort`, `DoltgresKnowledgeStoreAdapter`, and `core__knowledge_search/read/write` wired into poly-brain. What was missing: (a) functional upsert, (b) any deployment of Doltgres outside local dev.

An earlier iteration of this task (reverted) attempted to seed the store with 13 Polymarket "strategy" entries sourced from Medium content-marketing posts. A later revision proposed 3 "protocol-fact" entries. Both were discarded: nodes boot clean, the brain accumulates its own knowledge.

## Design

### Outcome

On candidate-a, poly pods reach `knowledge_poly` via `poly-doltgres-external:5435` through the EndpointSlice bridge. They connect using `DOLTGRES_URL_POLY` (matching the per-node env convention in `nodes/poly/app/src/shared/env/server-env.ts`). The table exists but is empty — the brain populates it at runtime via `core__knowledge_write`.

### Per-Node DB Alignment (multi-node-tenancy.md)

Doltgres deploys as **one server on Compose, one database per node** — identical in shape to the Postgres tier established by task.0324.

| Invariant from `multi-node-tenancy.md`                             | How Doltgres satisfies it                                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `DB_PER_NODE` — one DB per node on a shared server                 | `provision.sh` iterates `COGNI_NODE_DBS` and creates `knowledge_operator`, `knowledge_poly`, `knowledge_resy` |
| `DB_IS_BOUNDARY` — the DB is the node boundary, no tenancy columns | No `node_id` column on `knowledge`; DB name IS the node                                                       |
| `NO_CROSS_NODE_QUERIES`                                            | Per-node `DOLTGRES_URL_<node>` in k8s secrets; each pod connects to its own DB only                           |

Each `CREATE DATABASE` in Doltgres creates an independent Dolt repo with its own `dolt_log`. Poly's commits never appear in operator's timeline — intrinsic to Doltgres's "database = Dolt repo" model.

### Schema source of truth: drizzle-kit (Path A — reviewer-validated)

Per [DoltHub's schema-migrations blog](https://www.dolthub.com/blog/2022-07-20-schema-migrations/), single-branch Dolt databases use standard migration tooling. We use drizzle-kit's **native runtime migrator**, same as the Postgres tier.

An earlier draft of this task proposed a psql-based migrator citing Doltgres's incomplete `CREATE SCHEMA` support and missing extended query protocol. **Tests against Doltgres 0.56.0 disproved both concerns.** Per-the-test-results:

- ✅ `CREATE SCHEMA drizzle` succeeds.
- ✅ `drizzle.__drizzle_migrations` tracking table creates + insert/select work.
- ✅ `drizzle-kit migrate --config=nodes/poly/drizzle.doltgres.config.ts` applies the generated migration end-to-end, creates `public.knowledge` with all 10 columns + 3 indexes, and is idempotent on re-run.
- ⚠ Runtime tagged-template extended-protocol queries still hit an `unhandled message "&{}"` — but that's a runtime adapter concern (already handled by `sql.unsafe()` in the existing adapter), not a migration concern.
- ⚠ DDL doesn't auto-commit to `dolt_log` per [dolt#4843](https://github.com/dolthub/dolt/issues/4843) — so we add ONE trailing `SELECT dolt_commit('-Am', 'migration: drizzle-kit batch')` after the migrator completes.

### Packages

- **`@cogni/poly-doltgres-schema`** (NEW) — poly-local Drizzle schema targeting the Doltgres knowledge plane. Mirrors `@cogni/poly-db-schema` in shape; dialect-separate from the Postgres package. Today re-exports `knowledge` from `@cogni/node-template-knowledge`; poly-specific companion tables land here when needed.
- **`nodes/poly/drizzle.doltgres.config.ts`** (NEW) — per-node drizzle-kit config. Schema glob targets ONLY `nodes/poly/packages/doltgres-schema/src/**/*.ts`, preserving dialect separation from `nodes/poly/drizzle.config.ts` (Postgres).
- **`nodes/poly/app/src/adapters/server/db/doltgres-migrations/0000_init_knowledge.sql`** — generated, checked in.

### Migrator flow (mirrors Postgres pattern + one Dolt add-on)

Three compose bootstrap services run in dependency order:

1. **`doltgres-provision`** — creates `knowledge_<node>` DBs + reader/writer roles. No schema (drizzle-kit owns that).
2. **`doltgres-migrate-poly`** — runs the poly migrator Docker image (`${POLY_MIGRATOR_IMAGE}`), invokes `pnpm db:migrate:poly:doltgres:container` which is `drizzle-kit migrate --config=nodes/poly/drizzle.doltgres.config.ts`. Creates `drizzle.__drizzle_migrations` + `public.knowledge`.
3. **`doltgres-commit-poly`** (postgres:15, psql) — one-shot `SELECT dolt_commit('-Am', 'migration: drizzle-kit batch')` to capture DDL into `dolt_log`. Tolerates only `nothing to commit` on idempotent re-runs.

No seed step. Nodes boot clean.

The poly migrator Docker image (`nodes/poly/app/Dockerfile AS migrator`) carries both the Postgres AND Doltgres migration inputs: per-dialect drizzle config, schema package sources, and the generated SQL files.

### Clean-slate seeding policy

No deploy-time seeding. Rationale:

- A knowledge store seeded with AI-authored strategy prose pollutes retrieval (every search returns plausible-sounding noise the brain cites as authoritative).
- "Protocol facts" considered earlier (CLOB mechanics, Kelly reference, HF datasets) are reference data the brain can fetch on-demand via tools — baking them into rows creates a stale-cache problem.
- `POLY_KNOWLEDGE_SEEDS` is an empty array. The machinery in `scripts/db/seed-doltgres.mts` still exists for dev-only manual seeding (`pnpm db:seed:doltgres:poly`); it's not invoked by deploy-infra.

### Connection string shape

```
DOLTGRES_URL_POLY=postgresql://knowledge_writer:<pw>@poly-doltgres-external:5435/knowledge_poly
```

The DB name (`/knowledge_poly`) routes to the right Dolt repo. Password derived deterministically from `POSTGRES_ROOT_PASSWORD` + salt in `deploy-infra.sh` (no new GH Environment secrets).

### Changes

**Adapter**:

- `packages/knowledge-store/src/adapters/doltgres/index.ts` — `upsertKnowledge()` try-INSERT / catch-duplicate / fallback-UPDATE. Doltgres does not support `ON CONFLICT ... EXCLUDED` reliably.
- `nodes/{node-template,poly}/packages/knowledge/src/{index,schema}.ts` — strip unused `KNOWLEDGE_TABLE_DDL` / `KNOWLEDGE_INDEXES_DDL` constants (dead weight; drizzle-kit owns schema now).
- `nodes/poly/packages/knowledge/src/seeds/poly.ts` — `POLY_KNOWLEDGE_SEEDS` becomes `[]` (clean-slate policy documented inline).

**Schema authoring**:

- `nodes/poly/packages/doltgres-schema/` — NEW workspace package (`@cogni/poly-doltgres-schema`). `package.json`, `tsup.config.ts`, `tsconfig.json`, `src/{index,knowledge}.ts`, `AGENTS.md`.
- `nodes/poly/drizzle.doltgres.config.ts` — NEW per-node config.
- `nodes/poly/app/src/adapters/server/db/doltgres-migrations/0000_init_knowledge.sql` — generated, checked in.
- `package.json` — `db:generate:poly:doltgres`, `db:migrate:poly:doltgres`, `db:migrate:poly:doltgres:container` scripts.
- `biome/base.json` — `nodes/*/drizzle.doltgres.config.ts` added to `noProcessEnv` + `noDefaultExport` overrides.
- `nodes/poly/app/Dockerfile` — migrator stage COPY list extended with the Doltgres inputs (drizzle config + schema package + generated migrations + node-template-knowledge workspace for re-export resolution).

**Infra wiring**:

- `infra/compose/runtime/docker-compose.yml` — `doltgres` + `doltgres-provision` + `doltgres-migrate-poly` (uses `${POLY_MIGRATOR_IMAGE}`) + `doltgres-commit-poly` services.
- `infra/compose/runtime/docker-compose.dev.yml` — `doltgres-commit-poly` service.
- `infra/compose/runtime/doltgres-init/provision.sh` — simplified; removes embedded schema DDL (drizzle-kit owns it), keeps `CREATE DATABASE` + roles only.
- `infra/k8s/base/node-app/external-services.yaml` — `doltgres-external` Service + EndpointSlice.
- `infra/k8s/overlays/candidate-a/{operator,poly,resy}/kustomization.yaml` — EndpointSlice IP patch + per-node rename.

**Deploy wiring**:

- `scripts/ci/deploy-infra.sh` — `derive_secret()`, write `DOLTGRES_{PASSWORD,READER,WRITER}` + `POLY_MIGRATOR_IMAGE` to runtime env, bring up doltgres + provision + migrate + commit (no seed) when doltgres is in compose, conditionally add doltgres to `INFRA_SERVICES`, write `DOLTGRES_URL_POLY` to poly k8s secret, generic `DOLTGRES_URL` for operator/resy.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [x] SCHEMA_GENERIC_CONTENT_SPECIFIC: poly-specific content lives in rows, not schema (spec: knowledge-data-plane)
- [x] PACKAGES_NO_ENV: knowledge-store adapter takes `sql` via constructor, not `process.env` (spec: packages-architecture)
- [x] SCHEMA_SOURCE_OF_TRUTH_IS_DRIZZLE: TS schema → drizzle-kit generate → checked-in SQL → drizzle-kit migrate (native) → explicit dolt_commit
- [x] DB*PER_NODE: one Doltgres DB per node (knowledge*<node>), no tenancy columns (spec: multi-node-tenancy)
- [x] UPSERT_DOLTGRES_COMPATIBLE: upsertKnowledge works on Doltgres (no ON CONFLICT ... EXCLUDED)
- [x] CLEAN_SLATE_NODES: no deploy-time seeds; schema is the only starter state
- [x] DIALECT_SEPARATION: `@cogni/poly-doltgres-schema` globbed ONLY by drizzle.doltgres.config.ts

## Acceptance Criteria

- [x] `pnpm packages:build` succeeds
- [x] `pnpm exec drizzle-kit generate --config=nodes/poly/drizzle.doltgres.config.ts` idempotent
- [x] Local end-to-end: `drizzle-kit migrate` against Doltgres 0.56.0 creates drizzle schema + tracking table + public.knowledge with 10 columns + 3 indexes
- [x] `pnpm exec tsx scripts/check-root-layout.ts` — OK
- [x] `pnpm check:docs` — passes
- [x] `docker compose --profile bootstrap config --services` lists all 4 doltgres services (no seed-poly)
- [x] `pnpm check:fast` — 1250+ tests pass
- [ ] CI green on PR
- [ ] End-to-end on candidate-a: flight-infra brings up doltgres + migrates + stamps commit; adapter self-test proves poly pod can INSERT + SELECT one row via `DOLTGRES_URL_POLY`

## Validation

```
✅ Test 1: CREATE SCHEMA + __drizzle_migrations tracking table — PASS on Doltgres 0.56.0
✅ Test 2: drizzle-kit native migrate end-to-end — PASS (idempotent on re-run)
✅ Test 3: Dolt commit audit trail — explicit trailing dolt_commit works; dolt_log contains "migration: drizzle-kit batch"
✅ Adapter upsert: try-INSERT / catch-duplicate / fallback-UPDATE verified (no ON CONFLICT EXCLUDED)
✅ biome overrides + root-layout + check:docs + packages:build all green locally
```

## Out of Scope / Follow-ups

1. **Brain-authored knowledge loop** — `core__knowledge_write` + promotion gate so the brain accumulates observations at 10–30% confidence and graduates as evidence compounds. This is the actual product of the store.
2. **DoltHub delivery path** (spike.0318 → task.0319) — replace local-dev seed machinery with `dolt_clone` from per-node DoltHub remotes.
3. **Promote Doltgres migration to k8s PreSync Job pattern** — today it runs in compose alongside doltgres provisioning. Promote when (a) operator and resy adopt Doltgres, or (b) k8s-side migration plumbing (post-task.0324) gets a Doltgres invocation.
4. **Align `DOLTGRES_URL` → `DOLTGRES_URL_{OPERATOR,RESY}`** for per-node consistency with poly. Today operator/resy read generic `DOLTGRES_URL`; poly reads `DOLTGRES_URL_POLY`. Minor inconsistency, not a blocker.
5. **Backups** — follow Postgres WAL-G pattern once `proj.database-ops` lands.
6. **@cogni/{operator,resy}-doltgres-schema packages** — create when those nodes adopt Doltgres (fork `@cogni/poly-doltgres-schema` structure).

## Related

- [task.0231](./task.0231.knowledge-data-plane.md) — shipped the baseline this task wires for deploy
- [task.0324](./task.0324.per-node-db-schema-independence.md) — set the per-node drizzle + migrator-image pattern this task mirrors
- [spike.0318](./spike.0318.dolthub-knowledge-seeding-design.md) — DoltHub delivery design
- [task.0319](./task.0319.dolthub-seed-delivery.md) — DoltHub implementation
- PR [#887](https://github.com/Cogni-DAO/cogni-template/pull/887) — poly-brain catalog registration (merged)
- [`database-expert` skill](../../.claude/skills/database-expert/SKILL.md) — authoritative DB navigation aid
