---
id: task.0369
type: task
title: Drop --force from packages:build; reclaim 70s per local rebuild
status: needs_review
priority: 2
rank: 5
estimate: 1
summary: Remove the `--force` flag from the root `tsc -b` step in packages:build. Local cold rebuild drops from ~77s to ~32s with zero architectural change. CI unaffected (fresh runners always cold).
outcome: packages:build uses incremental tsc; add a separate `packages:build:clean` escape hatch for the rare case where tsbuildinfo is stale.
spec_refs:
assignees: []
credit:
project: proj.cicd-services-gitops
branch: spike/0369-build-graph-normalization
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-24
updated: 2026-04-24
labels: [build, devtools, turbo]
external_refs:
---

# Drop --force from packages:build; reclaim 70s per local rebuild

## Requirements

- `packages:build` runs `tsc -b` without `--force`, relying on `.tsbuildinfo` incrementality.
- A separate script (e.g. `packages:build:clean`) exists for the rare case where tsbuildinfo needs to be invalidated.
- All existing CI gates stay green (`check`, `check:full`, `test:ci`).
- `pnpm packages:validate` still passes (every package has `./dist/index.d.ts`).
- No change to `tsup` configs, no change to composite-project `tsconfig.json`s, no change to declaration shape (per-file `.d.ts` preserved).

## Critical research findings

### 1. The two-phase build is load-bearing architecture, not a workaround

- **All 33 library packages use `composite: true`** in their tsconfig.json → TypeScript project references.
- Composite projects require **per-file `.d.ts`** to satisfy `tsc -b`'s TS6305 check.
- tsup's `dts: true` emits **bundled** `dist/index.d.ts` — incompatible with composite.
- This was explicitly established in commit `0411af4e1` (fix(build): emit declarations via root tsc -b, not per-package): _"tsup's bundled DTS doesn't satisfy tsc -b's per-file declaration expectations for composite projects. bundler owns JS, tsc owns types."_
- **23 distinct deep-import subpaths** in the codebase confirm consumers rely on per-file declarations (e.g. `@cogni/db-schema/billing`, `@cogni/market-provider/adapters/polymarket`, `@cogni/ids/system`).

**Implication:** Flipping tsup to `dts: true` is not an option. The two-phase (tsup + tsc -b) model must stay.

### 2. `--force` is the dominant cost, not the architecture

Cold build, 33 packages:

| Phase                 | Command                                       | Time    |
| --------------------- | --------------------------------------------- | ------- |
| 1 (tsup)              | `pnpm -r --filter='./packages/**' ... build`  | **19s** |
| 2 (tsc -b --force)    | `tsc -b --force packages/*/tsconfig.json ...` | **84s** |
| 2 (tsc -b, hot cache) | same command, NO --force                      | **14s** |

**Phase 2 without `--force` is 6x faster.** `--force` disables `.tsbuildinfo` incrementality — it's a safety net for stale tsbuildinfo state, which tsc-incremental already handles correctly in 99% of cases.

### 3. CI is unaffected by this change

- CI runs on fresh runners with no `.tsbuildinfo` → incremental degrades to full-build naturally.
- CI time with `tsc -b` (no --force) ≈ CI time with `tsc -b --force` ≈ 84s. No regression.
- This is a **pure local-dev win**.

### 4. Turbo cannot cleanly model phase 2

- `tsc -b` is a **cross-project-reference** operation. Each `tsconfig.json` with `references` recursively builds upstream deps.
- Turbo's per-package `build` task can't represent this without either (a) collapsing everything into one root task with root-level outputs (unusual, but viable for remote cache), or (b) rewriting every package to `tsc -p` its own project independently (breaks project refs).
- **Turbo caching phase 1 (tsup) saves at most 19s. Not worth the blast radius of changing 33 packages' build scripts for a secondary win.**

### 5. What the previous agent got wrong

The turbo hygiene v0 PR (#1031) added a `build` task to turbo.json assuming it could eventually replace `packages:build`. The audit proves it cannot — or rather, it only covers phase 1. The `build` task in turbo.json is still useful for the 4 app workspaces (`operator`, `poly`, `resy`, `node-template`) which use `next build` (self-contained, no project refs), but **it will not absorb `packages:build`**. The root meta-task must stay.

## Allowed Changes

- `package.json` — edit `packages:build` script definition; add `packages:build:clean` sibling.
- Optionally: `scripts/check-fast.sh`, `scripts/check-all.sh` if they reference the flag explicitly (they don't today; they call `pnpm packages:build`).
- `docs/guides/new-worktree-setup.md` — note the new clean-build escape hatch.

## Plan

- [ ] Change root `packages:build` to drop `--force` from the `tsc -b` step.
- [ ] Add `packages:build:clean` that runs `packages:clean && packages:build` (invalidates tsbuildinfo first).
- [ ] Update `new-worktree-setup.md` to mention the escape hatch in case of weird rebase states.
- [ ] Run full validation gauntlet: `pnpm packages:build` (cold), `pnpm packages:build` (hot), `pnpm packages:validate`, `pnpm check`, `pnpm check:full`.
- [ ] Verify CI is green on the PR.

## Validation

**Command:**

```bash
# Cold: expect ~32s (down from ~77s)
rm -rf packages/*/dist nodes/*/packages/*/dist nodes/*/graphs/dist packages/*/*.tsbuildinfo
time pnpm packages:build

# Hot: expect ~32s first run, ~20s subsequent (all tsup + tsc incremental hits)
time pnpm packages:build

# Clean escape hatch
time pnpm packages:build:clean  # should match original --force cost (~77s)

# Correctness
pnpm packages:validate  # "✓ All 33 packages have declarations"
pnpm check              # all green
```

**Expected outcome:**

- Cold build total time drops by ~45s (phase 2 goes from 84s → ~14s on hot tsbuildinfo; the cold first run still pays the full ~84s the very first time).
- `packages:validate` passes.
- No new failures in `pnpm check` or `pnpm check:full`.
- CI green.

## PR / Links

- Handoff: [handoff](../handoffs/task.0369.handoff.md)

## Out of scope (deferred)

- **Remote turbo cache.** Would let CI restore declarations across runs. Independent work.
- **Turbo-caching phase 2 via a root task.** Possible but requires restructuring `.tsbuildinfo` to cacheable paths and is less valuable than remote cache on its own.
- **Per-workspace `typecheck` / `lint` scripts.** The monolithic root `lint` and `typecheck` scripts are operator-only today; normalizing them is a larger effort and should be a separate spike.
- **Killing `packages:build` entirely.** Audit proves it can't go — the two-phase model is required. The task stays; only its cost changes.
