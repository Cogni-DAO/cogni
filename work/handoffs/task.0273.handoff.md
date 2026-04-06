---
id: handoff-task-0273
type: handoff
work_item_id: task.0273
status: active
created: 2026-04-03
updated: 2026-04-03
branch: feat/node-workspace-unify
last_commit: 228a41abb
---

# Handoff: Unify workspace — move operator to nodes/operator/app

## Context

- Operator is the only node app at `apps/operator/`. All other nodes are at `nodes/{name}/app/`. This creates different Docker paths, CI config, workspace globs, and a special case for the Argo CD deploy pipeline.
- Operator has only 8 unique files vs node-template (DAO setup flow + VCS adapter). Everything else is shared platform code. "Operator" is a role, not a code structure.
- Moving operator into `nodes/operator/app/` enables: one glob for all nodes, one Dockerfile template, one CI matrix, uniform Argo CD targets.
- This is task.0248 Phase 4 (workspace restructure), split into its own task.

## Current State

- **Branch exists:** `feat/node-workspace-unify` worktree at `/Users/derek/dev/cogni-template-node-unify`
- **Work item written:** `work/items/task.0273.unify-node-workspace.md` with full reference audit and detailed plan (8 steps)
- **Design review passed:** 3 concerns noted and incorporated into the plan
- **Implementation attempted but NOT committed.** The `git mv` + config/test/Docker updates were applied and `pnpm check:fast` passed clean. BUT: the working tree was reset to clean state before handoff. **No implementation code is on the branch — only the task + plan commits.**
- **Pre-existing bug found:** `next build` fails with `async_hooks` from `@cogni/node-shared` leaking into client bundle. This is NOT from our changes — it exists on the base branch. Separate bug to file.

## Decisions Made

- Design review: [task.0273 plan](../items/task.0273.unify-node-workspace.md#reference-audit)
- ALL 4 Dockerfiles hardcode `apps/operator` paths (pre-existing bug). Fix all 4, not just operator's.
- `pnpm --filter operator` uses package name, not path. Root package.json `--filter` commands need zero changes.
- Remove `apps/` directory and `apps/*` glob from pnpm-workspace.yaml entirely.
- `scripts/validate-package-declarations.ts` line 71: skip condition `startsWith("./apps/")` must change to `includes("/app/tsconfig")` to handle new path.
- Operator's `tsconfig.app.json` extends `../../tsconfig.base.json` → needs `../../../tsconfig.base.json` (depth change).
- After `git mv`, must `rm -rf nodes/operator/app/node_modules && pnpm install` to fix stale symlinks.

## Next Actions

- [ ] `mkdir -p nodes/operator && git mv apps/operator nodes/operator/app && rmdir apps`
- [ ] Fix operator's `tsconfig.app.json` extends path and `next.config.ts` outputFileTracingRoot
- [ ] `rm -rf nodes/operator/app/node_modules && pnpm install` (symlinks break after move)
- [ ] Replace `apps/operator` → `nodes/operator/app` in ~65 config/build/test/Docker files (see plan in task)
- [ ] Fix `scripts/validate-package-declarations.ts` skip condition (line 71)
- [ ] Create `nodes/operator/.cogni/repo-spec.yaml`
- [ ] Update docs (CLAUDE.md, specs, guides — 19 files)
- [ ] `pnpm check:fast` must pass. `pnpm --filter operator build` has a pre-existing `async_hooks` issue.

## Risks / Gotchas

- **Stale symlinks after git mv**: `node_modules` symlinks point to relative paths that break when the package moves. Must delete and reinstall.
- **ALL 4 Dockerfiles reference `apps/operator`** — not just operator's. Miss one and Docker builds break.
- **`next build` has pre-existing `async_hooks` bug** from `@cogni/node-shared` leaking `AsyncLocalStorage` into client bundle. Not from this task. File separately.
- **Argo CD dev must be notified** — deploy target paths change. Coordinate before merge.
- **81 work item/handoff files reference `apps/operator`** — leave these as historical records, don't update.

## Pointers

| File / Resource                                                      | Why it matters                                                        |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `work/items/task.0273.unify-node-workspace.md`                       | Full plan with 8-step checklist + reference audit                     |
| `pnpm-workspace.yaml`                                                | Remove `apps/*` glob, verify `nodes/*/app` glob covers operator       |
| `tsconfig.base.json`                                                 | All `@/*` path aliases point to `apps/operator/src/*` — must update   |
| `apps/operator/Dockerfile`                                           | 10 `apps/operator` refs. All 4 node Dockerfiles have the same 10 refs |
| `scripts/validate-package-declarations.ts:71`                        | Skip condition for app tsconfigs — must handle new path               |
| `.dependency-cruiser.cjs`                                            | Operator path patterns in arch enforcement rules                      |
| `infra/compose/runtime/docker-compose.yml`                           | App service Dockerfile path                                           |
| `nodes/operator/app/tests/meta/public-route-enforcement.test.ts:130` | Hardcoded `apps/operator` test paths                                  |
