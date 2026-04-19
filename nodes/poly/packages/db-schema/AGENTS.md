# poly-db-schema · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** stable
- **Package:** `@cogni/poly-db-schema`

## Purpose

Drizzle ORM table definitions for **poly-local** tables (node-scoped). Mirrors the top-level `@cogni/db-schema` pattern but owned by and namespaced to the poly node.

Cross-process importers (scheduler-worker, Temporal worker, `@cogni/poly-graphs`) consume table definitions from here instead of reaching into `nodes/poly/app/src/shared/db/` (violates hex boundaries) or locating them in the shared core package (would ship poly tables to every node's DB).

## Pointers

- [Databases Spec](../../../../docs/spec/databases.md) — migration architecture + per-node schema invariants
- [Packages Architecture](../../../../docs/spec/packages-architecture.md) — workspace package shape
- [@cogni/db-schema](../../../../packages/db-schema/AGENTS.md) — core (cross-node) table definitions
- [task.0324](../../../../work/items/task.0324.per-node-db-schema-independence.md) — rationale for per-node DB packages

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

**External deps:** `drizzle-orm`.

## Public Surface

- **Subpath exports (mirrors `@cogni/db-schema` shape):**
  - `@cogni/poly-db-schema` — root barrel re-exports every slice
  - `@cogni/poly-db-schema/copy-trade` — `polyCopyTradeFills` (includes `syncedAt` column — nullable `timestamptz`, migration 0028), `polyCopyTradeConfig`, `polyCopyTradeDecisions` (task.0315 copy-trade prototype tables; `syncedAt` added task.0328 CP3)
- **Files considered API:** all `src/*.ts` via package.json exports

## Ports

- **Uses ports:** none
- **Implements ports:** none (schema definitions only)

## Responsibilities

- **Does:** define Drizzle table schemas for poly-local tables, declare CHECK constraints, unique/FK/index clauses
- **Does not:** contain queries, adapters, business logic, RLS policies, or any I/O

## Usage

```bash
pnpm --filter @cogni/poly-db-schema typecheck
pnpm --filter @cogni/poly-db-schema build
```

Consumer imports:

```ts
// Runtime code (any process — app, worker, graph) — use subpath imports
import { polyCopyTradeFills } from "@cogni/poly-db-schema/copy-trade";

// Or the barrel, if you need multiple slices
import { polyCopyTradeFills, polyCopyTradeConfig } from "@cogni/poly-db-schema";
```

drizzle-kit reads raw TS source via the config's schema glob (`nodes/poly/packages/db-schema/src/**/*.ts`), so migration generation does not require a pre-built `dist/`.

## Standards

- Per FORBIDDEN: No `@/`, `src/`, `process.env`, or runtime logic
- Per ALLOWED: Pure Drizzle schema definitions only
- Core FK targets (e.g. `users`) are referenced via `@cogni/db-schema` imports inside the table definitions if needed

## Dependencies

- **Internal:** `@cogni/db-schema` (for core FK targets only — if a poly table FKs to `users`)
- **External:** `drizzle-orm`

## Change Protocol

- Update this file when public subpath exports change
- New poly-local slice: add `src/<slice>.ts`, add to `tsup.config.ts` entry list, add to `package.json` exports field, update `src/index.ts` barrel
- After adding/modifying tables, run `pnpm db:generate:poly` from repo root to emit a migration file in `nodes/poly/app/src/adapters/server/db/migrations/`

## Notes

- **Why a separate workspace package?** Future cross-process consumers (Temporal worker, scheduler-worker) must import these tables without reaching into `nodes/poly/app/`. Locking the schema behind the app's hex boundary would force a refactor the moment a second consumer lands.
- **Not inherited by forks.** `nodes/node-template/` ships no `packages/db-schema/`. Forks spin up their own per-node db-schema package when they ship their first node-local table.
