---
id: task.0324
type: task
title: Per-node DB schema split (minimal — no new tooling)
status: needs_merge
priority: 2
rank: 50
estimate: 2
summary: Move node-specific tables out of the shared schema package into per-node schema dirs. Each node gets its own drizzle config and owns its migration history. No new packages, no new migration tables, no bespoke wrapper, no Atlas. One-day change.
outcome: poly's tables stop leaking into resy's DB. Each node's drizzle-kit generate/migrate acts on its own schema + its own migrations dir. Standard `__drizzle_migrations` table per DB, untouched. Prod poly/resy migration Jobs stop being `exit 0` no-ops.
spec_refs:
  - databases-spec
  - ci-cd-spec
assignees: derekg1729
credit:
project: proj.database-ops
branch: task.0322-per-node-db-schema-split
pr: https://github.com/Cogni-DAO/node-template/pull/916
reviewer:
revision: 3
blocked_by:
deploy_verified: false
created: 2026-04-18
updated: 2026-04-18
labels: [db, monorepo, cicd]
external_refs:
---

# Per-node DB schema split (minimal)

## Decision: minimal drizzle-split, no new tooling

Prior revisions of this plan proposed a `packages/db-migrator` wrapper (r1) then Atlas adoption (r2 ADOPT verdict). Both rejected: they solve a bigger problem than we have. The actual problem is one shared schema package leaking poly tables into resy's DB and claiming migration numbers any node could collide with.

The smallest fix: **stop sharing the schema file**. Each node points drizzle-kit at its own schema glob and its own migrations dir. Standard `__drizzle_migrations` table, standard drizzle-kit migrator, no new packages. The cost is roughly 30 seconds of `cp` when a core-table migration needs to land in every node — which happens rarely at our scale and matches the byte-identical duplicates we already have today.

Atlas adoption is preserved as a future upgrade in **task.0325** — pick it up when contributor count grows or destructive-change linting becomes worth the Go binary.

## Context — current state (audited 2026-04-18)

| Aspect                        | Reality                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| Per-node DBs                  | ✅ `cogni_template_dev`, `cogni_poly`, `cogni_resy` — separate DBs already exist, dev and k8s |
| Shared schema                 | ⚠️ `packages/db-schema` — poly-copy-trade tables live here, land in every node's DB           |
| Per-node migration dirs       | ⚠️ Exist, byte-identical copies of operator's 0000–0026. Operator has 0027 (poly-copy-trade). |
| Per-node drizzle config       | ❌ Single root `drizzle.config.ts` writes to operator's dir only                              |
| `db:migrate:poly` / `:resy`   | ⚠️ Swap `DATABASE_URL`, run root drizzle-kit — same migrations applied to every DB            |
| Prod poly/resy migration Jobs | 🚩 `exit 0` no-ops. `infra/k8s/overlays/production/{poly,resy}/kustomization.yaml:95`         |
| Doc accuracy                  | ✅ Fixed in Step 1 (Phase 0 below)                                                            |

## Design

### Shape

```
packages/db-schema/                 # keep name; contents shrink to core-only tables
  src/
    auth.ts  billing.ts  identity.ts  ai.ts  connections.ts  refs.ts  ...
    index.ts                        # barrel
    # poly-copy-trade.ts REMOVED from here

nodes/poly/app/schema/              # NEW — poly-local tables only
  copy-trade.ts                     # moved from packages/db-schema
  index.ts                          # import + re-export @cogni/db-schema/* PLUS local tables

nodes/operator/app/schema/          # NEW — operator-local (DAO formation, if any)
  index.ts                          # same pattern

nodes/resy/app/schema/              # NEW — empty for now, exists for symmetry
  index.ts                          # re-exports @cogni/db-schema/* only

nodes/<node>/app/src/adapters/server/db/migrations/  # EACH node owns its own history
  # existing 0000-0026 (or 0000-0027 for operator) STAY — this IS the node's history now
  # no wipe, no copy, no renumber

drizzle.operator.config.ts          # NEW — schema: nodes/operator/app/schema, out: operator's migrations
drizzle.poly.config.ts              # NEW — schema: nodes/poly/app/schema, out: poly's migrations
drizzle.resy.config.ts              # NEW — schema: nodes/resy/app/schema, out: resy's migrations
drizzle.config.ts                   # DELETE (or keep as alias to drizzle.operator.config.ts during rollout)
```

### What stays standard

- `__drizzle_migrations` — one table per DB, drizzle-kit default. No custom migration-table name, no per-package namespacing.
- `drizzle-kit migrate` — the default migrator. No wrapper code.
- `drizzle-kit generate` — default generator. Run per-node when that node's schema changes.
- Existing migrator image (`nodes/operator/app/Dockerfile` target `migrator`) — stays. Needs one parameterization (see Step 4).

### Per-node schema composition

Each node's `nodes/<node>/app/schema/index.ts` is the single entry point drizzle-kit reads:

```ts
// nodes/poly/app/schema/index.ts
export * from "@cogni/db-schema"; // core platform tables
export * from "./copy-trade"; // poly-local
```

Drizzle-kit follows the barrel, picks up both sets, diffs against the DB, emits one migration file in that node's `migrations/` dir. No composite-schema tooling needed.

### The one gotcha — existing leaked tables

`packages/db-schema` currently exports `poly-copy-trade.ts`. Moving it out means:

- **Poly DB** — tables already exist from migration 0027; now live in `nodes/poly/app/schema/`. `drizzle-kit generate` on poly's new config sees matching schema, emits no diff. Good.
- **Operator DB + resy DB** — tables `poly_copy_trade_*` exist from migration 0027 but are NOT in those nodes' new schema. `drizzle-kit generate` would emit `DROP TABLE` migrations.
  - **Don't drop.** The tables are harmless orphans. Inspect the generated diff and delete the DROP statements before committing, OR manually edit the generated SQL to make it a no-op.
  - The dropped migration file stays in the migrations dir but contains no-op SQL. Records the "this drift was inspected and accepted" decision.
  - Follow-up cleanup task (low priority) can add explicit DROP migrations for operator + resy if we ever care about the leftover tables.

### Prod migration Jobs — un-no-op

`infra/k8s/overlays/production/{poly,resy}/kustomization.yaml:95` currently sets `exit 0`. Remove, so Argo PreSync runs the shared operator migrator image against `cogni_poly` / `cogni_resy` (preview already does this). First prod run will be idempotent: either applies 0000–0026 fresh (if DBs are empty) or no-ops (if someone hand-migrated).

**Gate this with DB inspection first** (Step 5 below) — we don't know prod DB state today.

### Migrator image stays as-is (one parameterization)

Current: `nodes/operator/app/Dockerfile` target `migrator`. One image, used by every node's overlay. Parameterize by `DATABASE_URL` (already the case) — when we want the migrator to run against poly's schema, we need it to invoke `drizzle-kit migrate --config drizzle.poly.config.ts` instead of the default. Options:

- **A:** Pass `DRIZZLE_CONFIG` env var to the migrator container; `db:migrate:container` script reads it.
- **B:** Overlays patch the Job's `command` to `["pnpm", "db:migrate:poly:container"]` / `:resy` / `:operator`.

Option B is simpler; Option A is cleaner. Pick B for now — one-line overlay patch per node, no env plumbing.

## Invariants

- **NO_CROSS_NODE_TABLE_LEAK** — poly's tables are defined in `nodes/poly/app/schema/` only; same for operator/resy. Adding a table to the wrong place is a review-blocking error.
- **CORE_TABLES_IN_CORE_PACKAGE** — `packages/db-schema` contains only tables every node needs. Rule of thumb: intersection, not union.
- **EACH_NODE_OWNS_ITS_MIGRATION_HISTORY** — `nodes/<node>/app/src/adapters/server/db/migrations/` is that node's authoritative history. Don't copy files across nodes without intent.
- **STANDARD_DRIZZLE_MIGRATIONS_TABLE** — every DB uses drizzle-kit's default `__drizzle_migrations`. No renamed tables, no per-package tables.

## Table Classification (commit before any code move)

| Today's location          | Domain file                                  | Destination                                        |
| ------------------------- | -------------------------------------------- | -------------------------------------------------- |
| `packages/db-schema/src/` | `auth.ts`                                    | stay (core)                                        |
| `packages/db-schema/src/` | `identity.ts`, `profile.ts`                  | stay (core)                                        |
| `packages/db-schema/src/` | `billing.ts`                                 | stay (core)                                        |
| `packages/db-schema/src/` | `ai.ts`, `ai-threads.ts`                     | stay (core)                                        |
| `packages/db-schema/src/` | `connections.ts`                             | stay (core)                                        |
| `packages/db-schema/src/` | `refs.ts`, `scheduling.ts`, `attribution.ts` | stay (core)                                        |
| `packages/db-schema/src/` | **`poly-copy-trade.ts`**                     | **→ `nodes/poly/app/schema/copy-trade.ts`**        |
| `packages/db-schema/src/` | DAO formation tables (if distinct)           | → `nodes/operator/app/schema/` (PR-time discovery) |

Rule: **core = strict intersection of what every node needs**. When in doubt, node-local.

## Allowed Changes

- `packages/db-schema/src/poly-copy-trade.ts` — **delete** (file moves to nodes/poly)
- `packages/db-schema/src/index.ts` — drop the `poly-copy-trade` export
- `nodes/<node>/app/schema/` — NEW dirs, index.ts + any node-local table files
- `nodes/<node>/app/src/adapters/server/db/migrations/` — unchanged (each node now owns whatever is in its own dir)
- `drizzle.<node>.config.ts` — NEW per deployed node (operator, poly, resy)
- `drizzle.config.ts` — keep as operator alias during rollout, delete in a follow-up
- `package.json` scripts — `db:migrate:poly` / `:resy` / `:dev` call drizzle-kit with their own config files
- `nodes/operator/app/Dockerfile` migrator stage — copy all node schema dirs + all node migration dirs + all drizzle configs (so the same image can migrate any node)
- `infra/k8s/base/node-app/migration-job.yaml` + overlays — overlay patches the `command` to run the right node's migrate script
- `infra/k8s/overlays/production/{poly,resy}/kustomization.yaml` — **remove `exit 0`** (gated on Step 5 DB inspection)
- `scripts/ci/compute_migrator_fingerprint.sh` — hash inputs add `nodes/*/app/schema/**`, `nodes/*/app/src/adapters/server/db/migrations/**`, `drizzle.*.config.ts`
- `scripts/ci/detect-affected.sh` — `add_target migrator` triggers on the same path set
- `docs/spec/databases.md` — surgical update of § 2 Migration Strategy (per-node commands + per-node migration ownership)
- `docs/guides/multi-node-dev.md` — already corrected in Phase 0

## Plan

### Phase 0 — Doc truth-up (DONE)

- [x] **Step 0** — `docs/guides/multi-node-dev.md` DB/Auth section corrected to match reality.

### Phase 1 — Schema split (one PR, ~half-day)

- [ ] **Step 1** — Commit the Table Classification. PR touches only this task file.
- [ ] **Step 2** — Move `poly-copy-trade.ts` to `nodes/poly/app/schema/copy-trade.ts`. Create `nodes/{operator,poly,resy}/app/schema/index.ts` each re-exporting `@cogni/db-schema` + any node-local tables. Move operator-only tables (PR-time discovery) to `nodes/operator/app/schema/`.
- [ ] **Step 3** — Create `drizzle.{operator,poly,resy}.config.ts`. Each points at its own schema glob and its own existing migrations dir. Update `package.json` `db:migrate:*` scripts to use the per-node configs.
- [ ] **Step 4** — Run `pnpm db:migrate:poly` on TWO DBs:
  1. A fresh local `cogni_poly_p0_test` DB → should apply 0000–0027 cleanly, poly tables exist.
  2. A `pg_dump`-restored snapshot of **candidate-a's live `cogni_poly`** → must be a no-op (proves hash compatibility on a DB with the real historical migration rows, not just a local dev DB that may have been migrated differently).
     Repeat both for operator and resy. The snapshot validation is the non-negotiable proof — local-already-migrated isn't sufficient.
- [ ] **Step 4a** — Add `README.md` in each node's migrations dir explaining: migrations are node-owned; shared-era duplicates (specifically `0027_silent_nextwave.sql` in operator AND poly) are intentional; `__drizzle_migrations` rows reference these files by hash, so deleting one breaks migrate across node DBs. Tripwire to prevent a future "cleanup" PR from deleting the intentional duplicate.

### Phase 2 — CI + migrator image wiring (one PR, ~half-day)

- [ ] **Step 5** — Extend `scripts/ci/compute_migrator_fingerprint.sh` input paths to `nodes/*/app/schema/**`, `nodes/*/app/src/adapters/server/db/migrations/**`, `drizzle.*.config.ts`. **Silent failure mode otherwise** — a poly-local schema change leaves the migrator cache valid and the new migration never runs.
- [ ] **Step 6** — Extend `scripts/ci/detect-affected.sh` `add_target migrator` trigger to the same paths.
- [ ] **Step 7** — `nodes/operator/app/Dockerfile` migrator stage copies all nodes' schema + migrations + the three drizzle configs. One image, selects via overlay.
- [ ] **Step 8** — `infra/k8s/base/node-app/migration-job.yaml` + each overlay patch `command` to the right per-node migrate script. Preview migrates with the new model; should be zero diff vs today (same 0000-0026 applied).

### Phase 3 — Prod un-no-op (one PR, gated)

- [ ] **Step 9** — Inspect prod DBs BEFORE removing `exit 0`:
  1. SSH to prod VM; `pg_dump --schema-only` for each prod DB (`cogni_template_dev`, `cogni_poly`, `cogni_resy`).
  2. Does `__drizzle_migrations` exist? How many rows? Hashes match our repo's SQL files?
  3. Classify:
     - **(A) Empty DB, no `__drizzle_migrations`** → first migrate run applies 0000–0026 fresh. Fine.
     - **(B) Populated, hashes match** → migrate run is a no-op. Fine.
     - **(C) Populated, hashes diverge** → **STOP.** Reconcile manually before proceeding.
  4. Only after every prod DB is (A) or (B), land the overlay PR removing `exit 0`.
  5. Monitor first prod promote-and-deploy cycle via Loki.

### Phase 4 — Spec surgical update (follow-up PR, non-blocking)

- [ ] **Step 10** — `docs/spec/databases.md` § 2 Migration Strategy: per-node commands, per-node migration ownership, the "core table migration → duplicate into every node's dir" workflow. Link to this task for history.

## Validation

### Schema isolation proved

```bash
pnpm db:migrate:poly
pnpm db:migrate:resy

psql $DATABASE_URL_RESY -c "select * from poly_copy_trade_fills limit 1;"
# expect: ERROR (until we deliberately add the table to resy, it never arrives)

psql $DATABASE_URL_POLY -c "select count(*) from poly_copy_trade_fills;"
# expect: 0 or N (table exists, lives in poly's schema now)
```

### Migration history per node

```bash
psql $DATABASE_URL_POLY   -c "select count(*) from __drizzle_migrations;"   # ~27
psql $DATABASE_URL_RESY   -c "select count(*) from __drizzle_migrations;"   # ~27
psql $DATABASE_URL        -c "select count(*) from __drizzle_migrations;"   # ~27

# Add a core table → core migration lands in operator first
pnpm db:generate:operator
# Copy the new .sql file to nodes/poly/app/src/adapters/server/db/migrations/ and nodes/resy/...
# (or regenerate per-node; same result since schemas include the new core table)
pnpm db:migrate:poly    # applies new migration
pnpm db:migrate:resy    # applies new migration
```

### Collision test

```bash
# Branch A: add a core table → operator generates NNNN_foo.sql, poly/resy regenerate same
# Branch B: add a poly-local table → poly generates NNNN_bar.sql (its own history)
# Merge both: no conflict. Different nodes' migration dirs are independent.
```

### Observability

- Migration runs use existing Pino logging from drizzle-kit.
- First prod migrate Job run (Phase 3) watched in Loki: expect "migrations applied: 0" on hash-match DBs or a clean 0000-0026 apply on empty DBs.

## Non-goals (this task)

- **No `@cogni/db-migrator` package.** Standard drizzle-kit does the job.
- **No bootstrap script.** Existing `__drizzle_migrations` stays valid (same table, same hashes).
- **No second migration table per DB.** One table, the default.
- **No Atlas.** Tracked for future in task.0325.
- **No semver on `packages/db-schema`.** Monorepo — `git pull` is the propagation.
- **No timestamp migration IDs.** Sequential stays; rare collisions resolved by renumbering.
- **No schema DAG linting.** Add dep-cruiser rule later if node schemas start cross-importing.

## Review Checklist

- [ ] **Work Item:** `task.0324` linked in PR body
- [ ] **Table Classification:** committed before code moves (Step 1)
- [ ] **No cross-node table leak:** poly tables only in poly's schema; verified by grep
- [ ] **Standard migrations table:** no custom `migrations.table` in any drizzle config
- [ ] **Prod cutover gated:** Step 9 DB inspection done before overlay removes `exit 0`; prod cutover is a dedicated PR
- [ ] **Migrator CI inputs:** fingerprint + detect-affected cover all node schemas (silent staleness otherwise)
- [ ] **No new packages:** no `packages/db-migrator`, no `@cogni/db-core` rename
- [ ] **Reviewer:** assigned and approved

## Open questions

1. **Operator-local tables.** PR-time discovery: are there currently any operator-only tables (DAO formation?) distinct from core? If so, they move to `nodes/operator/app/schema/`. Addressed in Step 2.
2. **Operator/resy harmless-orphan poly tables.** Accepted for now — `poly_copy_trade_*` remain in those DBs from migration 0027 but are unused. Follow-up cleanup task can drop them when someone cares.
3. **Future: Atlas adoption.** See **task.0325**. Triggers: contributor count > ~3 regularly touching schema, or destructive-change linting at PR time becomes a priority.

## Design review history

- **2026-04-18 r1** — bespoke two-phase drizzle-kit runner with `__drizzle_migrations_core` + `__drizzle_migrations_<node>` tables, a new `packages/db-migrator`, and a legacy-DB bootstrap script. Rejected as over-engineered.
- **2026-04-18 r2** — Atlas adoption (composite_schema + AtlasMigration CRD + Argo Lua health check). Rejected as over-tooled for current scale; preserved as task.0325.
- **2026-04-18 r3 (current)** — minimal schema-split. Standard drizzle-kit per node, no new tooling, ~2d total. External reviewer framing: "stop sharing the schema file. Start sharing nothing."

## PR / Links

- Project: [proj.database-ops.md](../projects/proj.database-ops.md)
- Spec (to be updated): [databases.md](../../docs/spec/databases.md) § 2 Migration Strategy
- Future upgrade: **task.0325** (Atlas + GitOps migrations)
- Related: task.0260 (monorepo CI), task.0315 (poly copy-trade — the test case), task.0317 (per-node graph catalogs)

## Attribution

-
