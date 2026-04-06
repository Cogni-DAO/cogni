# Handoff: Extract @cogni/node-shared (task.0248 Phase 1b)

## Context

You are extracting `apps/operator/src/shared/` into `@cogni/node-shared` — a PURE_LIBRARY capability package. This is Phase 1b of task.0248. Phase 1a (`@cogni/node-core`) is merged (PR #693). Read `work/items/task.0248.node-platform-package-extraction.md` for the full plan and porting playbook.

## Branch

Work on `feat/task-0248-phase2-contracts` in worktree `.claude/worktrees/task-0248-phase2/`. Or create a new branch from `origin/integration/multi-node`.

## What to extract

~64 files from `apps/operator/src/shared/` (identical across all 4 apps). Follow the porting playbook in task.0248 exactly.

## What MUST stay app-local

- `shared/env/` — reads `process.env` via `serverEnv()`. Violates PURE_LIBRARY. 26 consumer imports.
- `shared/hooks/useIsMobile.ts` — React hook. 1 file.
- `shared/db/schema/` — imports drizzle ORM. Likely belongs in `@cogni/db-schema` not here.

## Internal @/ imports to fix (8 total, all self-refs within shared/)

- `shared/ai/model-catalog.server.ts` → `@/shared/env/server`, `@/shared/observability`
- `shared/config/repoSpec.server.ts` → `@/shared/env`, `@/shared/web3/chain`
- `shared/observability/context/factory.ts` → `@/shared/auth`
- `shared/utils/money.ts` → `@/types/payments` → now `@cogni/node-core`
- `shared/web3/wagmi.config.ts` → `@/shared/env/client`

Files that import `@/shared/env` CANNOT move to the package (env stays app-local). Either:

- Leave those files app-local too
- Or refactor them to accept config as a parameter instead of reading env directly

## Consumer import patterns

Consumers use 10+ distinct subpath imports:

- `@/shared/util/cn` (69 imports — highest)
- `@/shared/observability` (68)
- `@/shared/env` (26 — stays app-local)
- `@/shared/config` (16)
- `@/shared/observability/events` (14)
- `@/shared/auth` (11)
- `@/shared/constants/system-tenant` (10)
- `@/shared/web3/chain` (9)
- `@/shared/db/schema` (8)

You need subpath exports or a barrel that covers these. The `cn` utility alone accounts for 69 imports.

## Validation

```bash
pnpm packages:build
pnpm check:fast
```

Then `pnpm check` once before commit.

## Key rules

- **Port, don't rewrite** — copy files verbatim, change only import paths
- **Delete originals** — no re-export shims. Keep `shared/` barrel as hex layer extension point
- **Update ALL 4 apps + tests** — operator, node-template, poly, resy
- **Check arch probes** — if they reference deleted files, remove probe + skip test
