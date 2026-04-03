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

All nodes share one Postgres database (`cogni_template_dev`) and one set of
migrations (from `nodes/operator/app/src/adapters/server/db/migrations/`). Standard
setup applies:

```bash
pnpm db:setup           # provision + migrate + seed (first time)
pnpm db:migrate:dev     # run pending migrations (after schema changes)
```

**Auth:** NextAuth sessions are shared across all apps (same DB, same JWT secret).
The `dev:stack:*` scripts automatically set `NEXTAUTH_URL` per node so OAuth
redirects return to the correct port. Each node can sign in independently.

**Future (task.0247):** Per-node databases for data isolation in production.

## Architecture Notes

- Each node app is a **full platform copy** of the operator (auth, chat, streaming,
  billing, treasury) minus the DAO formation wizard
- Node-specific features (e.g. resy's reservations) live in `app/src/features/`
- Shared packages (`@cogni/ai-tools`, `@cogni/market-provider`, etc.) are in `packages/`
- All nodes share one DB and one migration path for now (task.0247 adds isolation)
- Future: task.0248 will extract the shared platform into `packages/node-platform`
  so nodes become thin shells instead of full copies
