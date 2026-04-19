# poly-doltgres-schema · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** stable
- **Package:** `@cogni/poly-doltgres-schema`

## Purpose

Drizzle ORM table definitions for **poly-local Doltgres** tables (node-scoped, knowledge plane). Mirrors `@cogni/poly-db-schema` (Postgres) in shape, owned by and namespaced to the poly node.

Cross-process importers (scheduler-worker, Temporal worker, `@cogni/poly-graphs`) consume knowledge-plane table definitions from here instead of reaching into `nodes/poly/app/src/shared/db/` (hex-boundary violation) or locating them in the shared core package (would ship poly tables to every node's Doltgres DB).

Today's contents: a single re-export of the base `knowledge` table from `@cogni/node-template-knowledge`. Poly-specific companion tables land here when needed.

## Pointers

- [Knowledge Data Plane Spec](../../../../docs/spec/knowledge-data-plane.md) — Doltgres-side architecture
- [Databases Spec](../../../../docs/spec/databases.md) — migration architecture + per-node schema invariants (Postgres; the Doltgres side mirrors the shape)
- [Packages Architecture](../../../../docs/spec/packages-architecture.md) — workspace package shape
- [@cogni/poly-db-schema](../db-schema/AGENTS.md) — sibling package, Postgres tables; reference for structure
- [@cogni/node-template-knowledge](../../../node-template/packages/knowledge/src/schema.ts) — source of the base `knowledge` table
- [task.0311](../../../../work/items/task.0311.poly-knowledge-syntropy-seed.md) — rationale for this package + migrator design

## Boundaries

```json
{
  "layer": "packages",
  "may_import": ["packages"],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters",
    "shared",
    "services"
  ]
}
```

**External deps:** `drizzle-orm`, `@cogni/node-template-knowledge` (workspace).

## Public Surface

- **Subpath exports (mirrors `@cogni/poly-db-schema` shape):**
  - `@cogni/poly-doltgres-schema` — root barrel re-exports every slice
  - `@cogni/poly-doltgres-schema/knowledge` — `knowledge` table (re-exported from `@cogni/node-template-knowledge`) + future poly-specific companion tables

## Responsibilities

- **Does:** define Drizzle table schemas for poly-local Doltgres tables; re-export inherited tables from `@cogni/node-template-knowledge`.
- **Does not:** contain queries, adapters, business logic, RLS policies, or any I/O.

## Dialect separation (non-negotiable)

This package is globbed ONLY by `nodes/poly/drizzle.doltgres.config.ts` (Doltgres target). `nodes/poly/drizzle.config.ts` (Postgres target) MUST NOT include this path — if it did, the Postgres migrator would try creating the `knowledge` table in Postgres.

## Migrator behavior (runs in poly migrator Docker image)

```bash
# Container entrypoint for the Doltgres migration Job/service:
pnpm db:migrate:poly:doltgres:container
```

That script runs `drizzle-kit migrate` natively against `DATABASE_URL` pointing at `knowledge_poly`. Tests against Doltgres 0.56.0 confirm:

- `CREATE SCHEMA drizzle` succeeds.
- `drizzle.__drizzle_migrations__` tracking table creates + inserts correctly.
- Idempotent re-runs: drizzle-kit reads the tracking table and skips applied migrations.

One Doltgres-specific addition: after drizzle-kit migrate completes, a trailing `SELECT dolt_commit('-Am', 'migration: drizzle-kit batch')` stamps the schema changes into `dolt_log` for audit. DDL in Dolt does not auto-commit to the working set per [dolt#4843](https://github.com/dolthub/dolt/issues/4843).

## Notes

- Validated end-to-end against Doltgres 0.56.0 locally: `drizzle-kit migrate` creates the `drizzle` schema + `__drizzle_migrations` tracking table + `public.knowledge` with 10 columns and 3 indexes; idempotent on re-run.
- Sibling packages: `@cogni/poly-db-schema` (Postgres tables), `@cogni/poly-knowledge` (runtime seeds + legacy re-exports).
- Node-template baseline: `@cogni/node-template-knowledge` (source of the `knowledge` table).
