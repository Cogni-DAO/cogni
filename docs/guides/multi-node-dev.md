---
id: guide.multi-node-dev
type: guide
title: Multi-Node Development Guide
status: draft
trust: draft
summary: Layout, dev commands, testing, and DB setup for running operator + node apps locally
read_when: Running multi-node dev stack, adding a new node, or debugging node auth
owner: derekg1729
created: 2026-04-01
verified: null
tags: [nodes, dev, infrastructure]
---

# Multi-Node Development Guide

## Layout

```
nodes/operator/         → Operator dashboard (port 3000)
nodes/node-template/    → Base template for new nodes
nodes/poly/             → Poly prediction node (port 3100)
nodes/resy/             → Resy reservations node (port 3300)
```

Each node has two workspace packages: `app/` (Next.js) and `graphs/` (AI graphs).
All nodes share infra services (Postgres, Temporal, LiteLLM, Redis) and the same
database. Auth sessions are shared — sign in once, use any node.

## Running Locally

```bash
# Start infra + operator (always first)
pnpm dev:stack                   # infra + operator on :3000

# Then add nodes in separate terminals
pnpm dev:poly                    # poly on :3100
pnpm dev:resy                    # resy on :3300

# Or start everything at once (one terminal)
pnpm dev:stack:full              # infra + operator + poly + resy
```

Auth is shared — sign in on any port, the cookie works on all (same `localhost`).

```bash
# Docker (containerized) — TODO: task.0247 adds per-node containers
pnpm docker:stack:full           # currently launches operator only
```

## Typechecking

```bash
# Operator (default, runs in pnpm check)
pnpm typecheck

# Individual nodes (from repo root, same pattern)
pnpm typecheck:node-template
pnpm typecheck:poly
pnpm typecheck:resy
```

All typecheck commands run from the repo root using `tsc -p <path>/tsconfig.app.json`.
Each node's tsconfig overrides `@/*` paths to resolve to its own `src/`.

## Testing

```bash
# Operator tests (unit + contract, no server needed)
pnpm test

# Operator stack tests (requires dev:stack:test running)
pnpm test:stack:dev

# Node-specific tests (from repo root, via pnpm filter)
pnpm --filter @cogni/poly-app test
pnpm --filter @cogni/resy-app test
pnpm --filter @cogni/poly-graphs test
pnpm --filter @cogni/resy-graphs test
```

## Pre-commit Gate

```bash
pnpm check          # Operator: typecheck + lint + format + tests + docs + arch
```

Node typechecks are not yet in the `pnpm check` pipeline — run them manually
when you change node-specific code. This will be unified in task.0248.

## Creating a New Node

1. Copy `nodes/node-template/` → `nodes/{name}/`
2. Update `app/package.json`: name → `@cogni/{name}-app`, port
3. Update `graphs/package.json`: name → `@cogni/{name}-graphs`
4. Add root scripts to `package.json`:
   - `"typecheck:{name}": "tsc -p nodes/{name}/app/tsconfig.app.json --noEmit"`
5. Add node-specific features under `app/src/features/`
6. Add node-specific graphs under `graphs/src/graphs/`
7. Run `pnpm install` to link the new workspace packages

## Database & Auth

**Each node has its own Postgres database.** Operator → `cogni_template_dev`,
poly → `cogni_poly`, resy → `cogni_resy`. Dev URLs live in `.env.local` as
`DATABASE_URL`, `DATABASE_URL_POLY`, `DATABASE_URL_RESY`. Production k8s
overlays patch the DB secret per node the same way.

**Schema source (task.0324):** each node owns its own drizzle config + migrations:

- **Core tables** live in `@cogni/db-schema` (`packages/db-schema/`) — cross-node platform surface (auth, billing, identity, etc.).
- **Node-local tables** live in `@cogni/<node>-db-schema` workspace packages under `nodes/<node>/packages/db-schema/`. Today only `@cogni/poly-db-schema` exists (copy-trade prototype). Per-node packages are spun up when a node ships its first node-local table.
- **Per-node drizzle configs** at `nodes/<node>/drizzle.config.ts`. Each config's schema glob unions core + its node-local package source. drizzle-kit reads raw TS — no dist/ needed for migration generation.
- **Migrations dir** at `nodes/<node>/app/src/adapters/server/db/migrations/` — node-owned. The shared-era `0027_silent_nextwave.sql` is byte-duplicated across operator/poly/resy dirs (tripwire READMEs in each explain why — do not delete).

```bash
pnpm db:setup           # provision cogni_template_dev + migrate + seed (operator)
pnpm db:migrate:dev     # operator DB via nodes/operator/drizzle.config.ts
pnpm db:migrate:poly    # cogni_poly via nodes/poly/drizzle.config.ts
pnpm db:migrate:resy    # cogni_resy via nodes/resy/drizzle.config.ts
pnpm db:migrate:nodes   # run all three in sequence
pnpm db:generate:poly   # generate a new migration for poly (schema diff)
```

**Migrator images:** each deployed node ships its own migrator image (`cogni-template:TAG-{operator,poly,resy}-migrate`) built from its own Dockerfile `migrator` stage. Argo PreSync Jobs invoke the image's default CMD (`pnpm db:migrate:<node>:container`) per-node.

**Production migration gap:** the production k8s overlays for poly and resy currently ship a no-op migration Job (`exit 0` — see `infra/k8s/overlays/production/{poly,resy}/kustomization.yaml`). Preview + candidate-a DO migrate. Un-no-opping prod is task.0324 Phase 3 (follow-up, gated on `pg_dump` DB-state inspection).

**Auth:** Because each node has its own DB, NextAuth session rows do **not** transit between nodes. Signing in on poly creates a session row in `cogni_poly`; the same cookie on operator authenticates against `cogni_template_dev` separately. Shared `AUTH_SECRET` means JWT decoding works across ports, but DB-backed session state is per-node. OAuth redirects are scoped to the right port via the `NEXTAUTH_URL_*` env vars set by the `dev:stack:*` scripts.

**Future upgrade (task.0325):** Atlas + GitOps migrations — declarative schema, destructive-change linting, `AtlasMigration` CRD replacing PreSync Jobs. Deferred pending contributor-scale triggers.

## Architecture Notes

- Each node app is a **full platform copy** of the operator (auth, chat, streaming,
  billing, treasury) minus the DAO formation wizard
- Node-specific features (e.g. resy's reservations) live in `app/src/features/`
- Shared packages (`@cogni/ai-tools`, `@cogni/market-provider`, etc.) are in `packages/`
- Each node has its own DB + its own drizzle config + its own migrator image (task.0324). Core tables live in `@cogni/db-schema`; node-local tables live in `@cogni/<node>-db-schema` workspace packages under `nodes/<node>/packages/db-schema/`.
- Future: task.0248 will extract the shared platform into `packages/node-platform`
  so nodes become thin shells instead of full copies
