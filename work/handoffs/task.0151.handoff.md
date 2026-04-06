---
id: task.0151.handoff
type: handoff
work_item_id: task.0151
status: active
created: 2026-03-11
updated: 2026-03-11
branch: feat/gitops-foundation
last_commit: be07f605
---

# Handoff: Monorepo Re-Architecture (task.0151)

## Context

- Move Next.js app from repo root (`src/`, root configs) into `apps/operator/` as a pnpm workspace member
- Flatten `platform/` (3+ levels deep) into `infra/` + `scripts/`
- Prerequisite for adding `apps/operator/` in GitOps roadmap (proj.cicd-services-gitops P2)
- PR #547 open against `staging`: https://github.com/Cogni-DAO/node-template/pull/547
- Checkpoints 1-2 (file moves, path updates) are done. Checkpoint 3 (validation) is in progress.

## Current State

- **`pnpm check` passes** locally on the branch
- **CI status (PR #547)**: `static`, `unit`, `component` pass. `stack-test` fails (Docker build — thread-stream/pino bundling issue, fixed in commit `2500ad73`). `sonar` fails (path config, fixed in `c665b0d2`). CodeQL alerts dismissed.
- **9 uncommitted files** ready to commit — see list below
- **`pnpm check:full` not yet run** — this is the final gate
- **Blocking issue**: `COGNI_REPO_PATH` serves three contexts that need different values. The previous developer's uncommitted fix uses `COGNI_REPO_PATH=$(pwd)` inline in package.json scripts. This works for host-side dev/build but the Docker leak (`.env.test` → `--env-file` → overrides compose default `/repo/current`) is not yet addressed.

### Uncommitted files (from previous developer session)

| File                                                                         | Change                                                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `package.json`                                                               | `COGNI_REPO_PATH=$(pwd)` prefix on `dev`, `dev:stack:test`, `build`, `start`               |
| `apps/operator/src/adapters/server/sandbox/llm-proxy-manager.ts`             | `TEMPLATE_PATH` → lazy `getTemplatePath()` (was crashing at import time via `serverEnv()`) |
| `apps/operator/tests/stack/ai/one-ledger-writer.stack.test.ts`               | `cwd: join(process.cwd(), "apps/operator")` for grep commands                              |
| `apps/operator/tests/stack/ai/stream-drain-enforcement.stack.test.ts`        | Same cwd fix                                                                               |
| `apps/operator/tests/stack/attribution/collect-epoch-pipeline.stack.test.ts` | Relative import depth fix (`../../../` → `../../../../../`)                                |
| `.env.local.example`                                                         | `COGNI_REPO_PATH=../..` → `.` with comment update                                          |
| `.env.test.example`                                                          | `COGNI_REPO_PATH=../..` → `.` with comment update                                          |
| `.mcp.json`                                                                  | Unrelated config change                                                                    |
| `work/items/task.0151.monorepo-app-to-workspace.md`                          | Status field update                                                                        |

## Decisions Made

- Root `package.json` must list all `@cogni/*` workspace packages as deps — pnpm only symlinks root deps to `/app/node_modules/@cogni/`, and scheduler-worker Dockerfile copies root `node_modules` (commit `c170befb`)
- Thread-stream noop stub for Turbopack client SSR bundling; real fix tracked as `bug.0157` (commit `2500ad73`)
- `.dockerignore` uses `**` prefixed patterns + excludes `.claude/` to prevent 12GB+ build context (commit `1495537e`)
- `pnpm deploy` follow-up noted in proj.cicd-services-gitops P2 roadmap (commit `be07f605`)

## Next Actions

- [ ] Commit the 9 uncommitted files (review diffs first — they are correct)
- [ ] Resolve `COGNI_REPO_PATH` Docker leak: `.env.test` sets `COGNI_REPO_PATH=.` which overrides compose default `/repo/current` via `--env-file`
- [ ] Run `pnpm check:full` end-to-end — must pass Docker build, stack tests, readyz
- [ ] Push and verify CI passes on PR #547
- [ ] Update task.0151 status to `needs_closeout`
- [ ] Run `/closeout` for docs pass + PR finalization

## Risks / Gotchas

- **COGNI_REPO_PATH conflict**: `.env.test` value leaks into Docker via `docker compose --env-file .env.test`, overriding the compose default `${COGNI_REPO_PATH:-/repo/current}`. The `$(pwd)` inline prefix in package.json only helps host-side scripts, not containerized processes.
- **scheduler-worker Dockerfile fragility**: Lines 82-110 copy root `node_modules` and per-package `dist/`. Adding a new `@cogni/*` package requires updating root `package.json` deps AND the Dockerfile COPY list. `pnpm deploy` (proj.cicd-services-gitops P2) eliminates this.
- **SonarCloud "new code" inflation**: The `src/` → `apps/operator/src/` path change causes SonarCloud to treat all moved files as "new code," surfacing ~50 pre-existing issues. These are not regressions — mark as won't fix or adjust the new code baseline.
- **Thread-stream noop stub** (`apps/operator/src/shared/stubs/thread-stream-noop.ts`) is a containment measure. The real fix is `bug.0157`: dynamic import with `ssr: false` for the WalletConnect component subtree.

## Pointers

| File / Resource                                          | Why it matters                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `work/items/task.0151.monorepo-app-to-workspace.md`      | Full task spec with checkpoint plan and R1-R3 review feedback            |
| `work/projects/proj.cicd-services-gitops.md`             | Parent project, P2 has `pnpm deploy` follow-up                           |
| `apps/operator/src/shared/env/server-env.ts:205,270-283` | `COGNI_REPO_PATH` Zod validation + `COGNI_REPO_ROOT` resolution          |
| `services/scheduler-worker/Dockerfile:82-110`            | Fragile multi-COPY that depends on root symlinks                         |
| `infra/compose/runtime/docker-compose.dev.yml:69`        | `COGNI_REPO_PATH=${COGNI_REPO_PATH:-/repo/current}` default              |
| `apps/operator/next.config.ts`                           | `outputFileTracingRoot`, `turbopack.resolveAlias` for thread-stream stub |
| `work/items/bug.0157.walletconnect-pino-ssr-bundling.md` | Real fix for thread-stream (ssr: false)                                  |
| PR #547                                                  | https://github.com/Cogni-DAO/node-template/pull/547                      |
