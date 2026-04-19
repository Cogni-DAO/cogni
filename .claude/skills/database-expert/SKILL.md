---
name: database-expert
description: Cogni-template DB architecture reference — per-node schema independence, drizzle configs, RLS (`app_user`/`app_service`), migrator images, and the gotchas. Use when adding/modifying DB tables, writing migrations, running `pnpm db:*`, debugging drizzle-kit errors, touching `@cogni/db-schema` or any `@cogni/<node>-db-schema`, or dealing with `DATABASE_URL` / `__drizzle_migrations` / per-node migrator Dockerfiles.
---

# database-expert

Navigation aid for database schema, migrations, and DSN plumbing. Per-node schema independence (task.0324) is recent — most gotchas trace back to that layout not being internalized yet. **Always consult the specs first; this skill's job is to point, not to restate.**

## Ground truth — open these, don't restate them here

- [docs/spec/databases.md](../../../docs/spec/databases.md) — authoritative architecture, invariants (enumerated in §2), commands, migrator image shape. Treat this as canon.
- [docs/spec/database-rls.md](../../../docs/spec/database-rls.md) — two-user RLS (`app_user` + `app_service`), `SET LOCAL app.current_user_id`, dep-cruiser rule on `getServiceDb()` (only importable from `drizzle.service-client.ts`).
- [docs/spec/database-url-alignment.md](../../../docs/spec/database-url-alignment.md) — explicit-DSN invariant, no component-piece fallback at runtime.
- [docs/spec/multi-node-tenancy.md](../../../docs/spec/multi-node-tenancy.md) — DB-per-node boundary (the database IS the tenant, not a column).
- [docs/guides/multi-node-dev.md](../../../docs/guides/multi-node-dev.md) — per-node dev commands + local setup.
- [work/items/task.0324…md](../../../work/items/task.0324.per-node-db-schema-independence.md) — why the current shape exists; task body has design history.
- [work/items/task.0325…md](../../../work/items/task.0325.atlas-gitops-migrations.md) — Atlas spike intel, deferred.
- `nodes/poly/packages/db-schema/AGENTS.md` — reference example for the per-node db-schema package pattern (fork it for new nodes).
- READMEs under `nodes/<node>/app/src/adapters/server/db/migrations/` — tripwires explaining the shared-era `0027_silent_nextwave.sql` duplicate.

## Layout at a glance

```
packages/db-schema/               @cogni/db-schema  (core, cross-node)
nodes/<node>/drizzle.config.ts    per-node config (CWD-relative globs, env-only DATABASE_URL)
nodes/<node>/app/.../migrations/  node-owned migration history
nodes/<node>/packages/db-schema/  @cogni/<node>-db-schema  (only created when node has local tables)
```

Only `@cogni/poly-db-schema` exists today. Resy/operator/node-template spin up a per-node package on their first node-local table — no empty scaffolds.

## Adding a table — decision flow

1. **Will anything outside the owning node import this?** (scheduler-worker, Temporal worker, graphs, another node's app)
   - Yes → `packages/db-schema/src/<slice>.ts` (core). See [packages/db-schema/AGENTS.md](../../../packages/db-schema/AGENTS.md) Change Protocol for the 4 coordinated edits (source file, index barrel, tsup entry, package.json exports).
   - No → node-local. Continue.
2. **Does the node already have `packages/db-schema/`?** (Only poly does.)
   - Yes → add a slice + update its 4 coordination points.
   - No → create `nodes/<node>/packages/db-schema/` by copying `nodes/poly/packages/db-schema/` structure. Add `"@cogni/<node>-db-schema": "workspace:*"` to the node app's dependencies. Update `nodes/<node>/drizzle.config.ts` schema array to include the new package's `src/**/*.ts`.
3. **Generate + apply:** `pnpm db:generate:<node>` → inspect the SQL → `pnpm db:migrate:<node>`.
4. **If CORE table:** copy the migration file + its `_journal.json` entry into every OTHER node's migrations dir. Drizzle-kit does not auto-propagate across nodes; each deployed DB needs its own applied copy so `__drizzle_migrations` hash lookups line up.

## Commands — see spec for the full list

Full command reference in [databases.md §2](../../../docs/spec/databases.md). Daily usage:

```bash
pnpm db:migrate:{dev,poly,resy}      # migrate one node's DB from .env.local
pnpm db:migrate:nodes                # all three
pnpm db:generate:{operator,poly,resy} # generate a migration from a schema diff
pnpm db:setup:nodes                  # first-time: provision + migrate + seed
```

## Gotchas — practical discovery, not in specs

### Drizzle configs cannot use relative TS imports

drizzle-kit compiles the config to a temp directory before running. `import { X } from "./app/src/.../db-url"` fails with `Cannot find module './nodes/<node>/app/...'`. Fix: **no relative imports**, all paths in `schema:` / `out:` are repo-root-relative (`CWD=repo root`), and `DATABASE_URL` comes from `process.env` with a throw-if-missing guard. Look at any `nodes/<node>/drizzle.config.ts` for the canonical pattern.

### `0027_silent_nextwave.sql` is intentionally byte-duplicated

Shared-era migration applied to every deployed DB before the schema split. Each node's `migrations/` has the same SQL file + matching `meta/_journal.json` entry so hashes match the pre-existing `__drizzle_migrations` rows. Tripwire READMEs in those dirs explain; **do not "clean up" the duplicate** without coordinating across every deployed DB.

### `drizzle-kit generate` on operator/resy will emit DROP migrations for orphan poly tables

`poly_copy_trade_*` exists in operator/resy DBs as harmless orphans from the shared-era apply. Their configs no longer include those tables, so generate sees them as drift and wants to `DROP TABLE`. **Inspect any auto-generated migration; discard DROP statements for `poly_copy_trade_*`.** Orphans stay until an explicit future cleanup.

### `DATABASE_URL` must be set per-invocation — and only by the caller

No fallback. If you see `DATABASE_URL is required` thrown, check:

- pnpm scripts: `dotenv -e .env.local` / `-e .env.test` prefix (see `package.json` `db:migrate:*`)
- Component tests: `nodes/<node>/app/tests/component/setup/testcontainers-postgres.global.ts` assigns `process.env.DATABASE_URL` before `execSync('pnpm db:migrate:direct')`
- k8s: the `migrate-node-app` Job's env block has `DATABASE_URL` via `secretKeyRef`

### Cross-process imports go through the per-node package, not the app

scheduler-worker, Temporal worker, or any other service that needs poly tables:

```ts
import { polyCopyTradeFills } from "@cogni/poly-db-schema/copy-trade";
```

**Do not** reach into `nodes/poly/app/src/shared/db/` — that's the app's hex boundary. `@cogni/poly-db-schema` exists as a workspace package precisely so cross-process consumers can import without that violation.

### Prod poly/resy migration Jobs are currently `exit 0` no-ops

`infra/k8s/overlays/production/{poly,resy}/kustomization.yaml:95` deliberately short-circuits. Un-no-opping is task.0324 Phase 3 — gated on `pg_dump` inspection of each prod DB first (current state unverified). **Do not flip these flags** without the snapshot-restore rehearsal.

### Per-node app image ≠ per-node migrator image

They share a Dockerfile (`nodes/<node>/app/Dockerfile`) but use different stages. `cogni-template:TAG-poly` = app runtime (`runner`). `cogni-template:TAG-poly-migrate` = migrator (`migrator`). The k8s overlay uses both — the Job targets `-migrate`, the Deployment targets the app tag.

## When to promote a node-local slice to core

Trigger: a second node genuinely needs the same table (import would cross node boundaries). **One-way move** — flipping back and forth causes migration file churn. Rule of thumb: core = strict intersection. When in doubt, keep node-local.

## Future: Atlas (task.0325, deferred)

Atlas + Drizzle official integration; `atlas migrate diff`, destructive-change linting, `AtlasMigration` CRD replacing PreSync Jobs. Triggers to revisit: ~3+ contributors regularly touching schema, weekly core changes, destructive-change prevention becomes a priority. Full spike intel in the task body — don't re-spike.

## Related skills

- **devops-expert** — CI/CD pipeline, migrator image build wiring, promote-and-deploy flow
- **test-expert** — testcontainers DB setup, `.env.test` flow
- **deploy-node / deploy-operator** — per-env provisioning, prod cutover procedure

## Anti-patterns to flag in review

- Node-specific table added to `@cogni/db-schema`
- `@cogni/poly-db-schema` imported from a non-poly node
- Relative TS import or hard-coded DSN inside a drizzle config
- `buildDatabaseUrl` inside a drizzle config (tooling-only; also breaks inside drizzle-kit's temp compile)
- `drizzle-kit migrate` run directly against prod poly/resy (go through the candidate-a → preview → promote chain)
- Deleting `0027_silent_nextwave.sql` from any node without coordinating across all deployed DBs' `__drizzle_migrations`
- Auto-generated `DROP TABLE "poly_copy_trade_*"` committed on operator/resy (orphans are intentional)
- Component-piece fallback (`POSTGRES_HOST`, etc.) added to any new script — explicit DSN or fail fast
