---
id: task.0369.handoff
type: handoff
work_item_id: task.0369
status: active
created: 2026-04-24
updated: 2026-04-24
branch: spike/0369-build-graph-normalization
last_commit: 95fbf3b54
---

# Handoff: task.0369 — Drop --force from packages:build; reclaim 70s per local rebuild

## Context

- `pnpm packages:build` runs a two-phase monorepo build: phase 1 (tsup per-package JS) + phase 2 (`tsc -b --force` at root for declarations).
- Phase 2's `--force` flag disables TypeScript's incremental `.tsbuildinfo` cache. Measured: it costs **~70s per local rebuild** that would otherwise be near-instant.
- Prior work (PR #1031, turbo hygiene v0) added a turbo `build` task but could not absorb phase 2. Audit proves it never will — the two-phase model is load-bearing (composite project references + 23 deep-import subpaths across `@cogni/*`).
- User framing: _"CI changes were frozen, with an exception made for turbo."_ Reviewer framing: _"first make turbo config less stupid, only then propose a second PR showing one concrete CI job speedup without changing correctness."_ This task is that second concrete speedup — but scoped to **local dev**, not CI (CI is cold-start either way, so unaffected).

## Current State

- Worktree bootstrapped at `/Users/derek/dev/cogni-template-worktrees/spike-0369-build-graph-normalization` off `origin/main@95fbf3b54`. `pnpm install` + `pnpm packages:build` already run.
- Task file written: `work/items/task.0369.packages-build-drop-force-flag.md` — contains the critical audit findings + per-phase timings + validation plan.
- No code changes yet. Branch has zero diff from `origin/main`.
- Prior attempts considered and discarded: (a) flip `tsup` to `dts: true` — blocked by composite + deep imports; (b) kill `packages:build` for a turbo-native `build` task — blocked by cross-package `tsc -b` semantics.

## Decisions Made

- **Keep two-phase build.** Established in commit [`0411af4e1`](../../commit/0411af4e1): "tsup's bundled DTS doesn't satisfy tsc -b's per-file declaration expectations for composite projects. bundler owns JS, tsc owns types."
- **Scope cut to removing `--force`.** Measured win documented in task file §2 (cold 84s → hot 14s for phase 2).
- **Add `packages:build:clean` as escape hatch.** Wraps `packages:clean && packages:build` for the rare stale-tsbuildinfo state (e.g. weird rebase).
- **Out of scope (documented in task):** remote turbo cache, per-workspace `typecheck`/`lint` normalization, turbo-caching phase 2.

## Next Actions

- [ ] Read `work/items/task.0369.packages-build-drop-force-flag.md` (critical findings §1–§5).
- [ ] Edit root `package.json`: change `packages:build` so its `tsc -b` step drops `--force`; add `packages:build:clean` sibling.
- [ ] Update `docs/guides/new-worktree-setup.md` with one-line pointer to the escape hatch.
- [ ] Run the validation block in the task file: cold `packages:build`, hot re-run, `packages:validate`, `pnpm check`, `pnpm check:full`.
- [ ] Commit with message referencing task.0369 and the measured wins.
- [ ] Open PR targeting `main`. Paste the per-phase timing table into the PR body as proof.
- [ ] Watch CI run on the PR. Must be green before merge.
- [ ] On green + merge, archive this handoff and close task.0369.

## Risks / Gotchas

- **tsbuildinfo drift after rebase/merge-conflict.** Without `--force` local dev can see stale declarations if tsbuildinfo gets out of sync. Mitigation: the `packages:build:clean` escape hatch. Surface it prominently in `new-worktree-setup.md` so the next agent reaches for it before googling.
- **Don't touch tsup configs.** All 33 library packages use `dts: false, clean: false` on purpose. Any `dts: true` edit breaks composite + the 23 deep-import call sites listed in the task file.
- **Don't touch composite-project tsconfigs.** `composite: true` across all 33 packages is load-bearing. Project references depend on it.
- **`pnpm packages:build` is called by CI directly** (from `ci.yaml` jobs). Any change to its definition is a de-facto CI change. Prove the new variant matches the old via `packages:validate` before pushing, and watch the first CI run carefully.
- **Previous worktree had a scheduled agent writing to `work/charters/CONSTRAINTS.md` during sessions.** If you see that file in `git status` unexpectedly, discard it — not your work to commit.

## Pointers

| File / Resource                                                                     | Why it matters                                                                         |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `work/items/task.0369.packages-build-drop-force-flag.md`                            | Primary briefing. Critical findings + per-phase timings + validation block.            |
| `package.json` → `packages:build` script                                            | The one line to edit. Currently: `... && tsc -b --force packages/*/tsconfig.json ...`. |
| Commit `0411af4e1` (fix(build): emit declarations via root tsc -b, not per-package) | Authoritative rationale for the two-phase split. Read before touching tsup configs.    |
| `scripts/validate-package-declarations.ts`                                          | Guardrail invoked by `packages:validate`. Must stay green after the change.            |
| `docs/guides/new-worktree-setup.md`                                                 | Update with the escape hatch pointer.                                                  |
| PR #1031 (turbo hygiene v0, merged)                                                 | Adds `.turbo`, `globalDependencies`, and the `build` task. Background context only.    |
| `scripts/check-fast.sh`, `scripts/check-all.sh`                                     | Call `pnpm packages:build` as a pre-step; do NOT reference `--force` directly.         |
| `.claude/skills/devops-expert/SKILL.md`                                             | CI/CD contract. Reaffirms "CI frozen except turbo" framing.                            |
