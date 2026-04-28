---
id: task.0415
type: task
title: "Speed up `pnpm check:fast` — collapse to one turbo DAG, drop test serialization, cache docs/db checks"
status: done
revision: 1
pr: https://github.com/Cogni-DAO/node-template/pull/1110
priority: 0
rank: 1
estimate: 3
summary: "`pnpm check:fast` is the husky pre-push gate. Today it sequences 8 phases through bash, runs `workspace:test --concurrency=1` (172s), pre-builds all .d.ts (24s) before typecheck, and excludes `db:check` + root lint/format from the turbo graph so they always run unparallelized. Total ~4 min on clean main, with hard CPU spikes that make multiple agents on one machine (or one cloud runner) thrash. Phase 1 ships the high-leverage low-risk wins: collapse parallel-safe phases into a single `turbo run` invocation, model root `lint`/`format:check` + `db:check` as turbo root tasks with proper `inputs:` so they cache and parallelize, drop `--concurrency=1` on tests. Vitest `--changed` and `check:docs` caching deliberately deferred (correctness/regen-loop hazards covered in design review). Phase 2 (remote cache + tsc project references / isolatedDeclarations) is a follow-up."
outcome: |
  After Phase 1:
    - `pnpm check:fast` on incremental local rerun (warm Turbo cache): <30s.
    - `pnpm check:fast` on a typical 1-package PR (warm cache): <20s.
    - `pnpm check:fast` cold-cache (fresh worktree, agent VM, cloud runner): improves vs today by parallelism + dropping `--concurrency=1`, but the *full* cold-start fix lands in Phase 2 with remote cache.
    - One `turbo run lint typecheck test db:check format:check --affected` invocation drives all parallel-safe work.
    - `db:check` and `format:check`/`lint` (root) are turbo root-package tasks with `inputs:` pinned to drizzle configs/migrations and root config files; cached when those don't change.
    - `workspace:test --concurrency=1` removed; restored to default (CPU-1). Pre-flight: confirm WHY it was added (likely testcontainer port collision or DB role contention) and either fix root cause inside the offending package or keep its in-package serialization, but never globally.
    - `packages:build` (24s prebuild) still runs but only when global build inputs changed; Phase 2 will eliminate it.
    - `check:docs` continues to run as today (unchanged) — caching deferred until `work:index` regen is split out (separate task).
    - Husky pre-push hook still calls `pnpm check:fast` and still catches drift.
spec_refs: []
assignees: []
credit:
project:
branch: task/0415-check-fast-turbo-dag
created: 2026-04-28
updated: 2026-04-29
labels: [dev-loop, monorepo, turbo, p0]
---

# task.0415 — Speed up `pnpm check:fast`

## Problem

`pnpm check:fast` is the husky pre-push gate (every push from every dev/agent runs it). Observed wall-time on clean `main`:

```
✓ packages:build       24s   (tsc emit of .d.ts so workspace typecheck can resolve types)
✓ workspace:typecheck  17s   (turbo run typecheck --affected)
✓ lint                  6s   (root biome+eslint)
✓ workspace:lint        3s   (turbo run lint --affected)
✓ format               18s   (prettier --check on the world)
✓ check:docs            3s   (always runs; not in turbo graph)
✓ db:check              8s   (4 drizzle-kit check invocations; not in turbo graph)
✓ workspace:test      172s   (turbo run test --affected --concurrency=1)
                     ─────
                      ~4 min
```

Two compounding problems:

1. **Wall-clock pain.** ~4 min per push. Pre-push gate that long discourages small commits and trains agents to bypass with `--no-verify`.
2. **Resource thrash.** `workspace:test` spikes every CPU; running multiple agents on one laptop, or in a cloud runner with limited CPU, causes thrash, OOM-kills, and flaky tests.

Five root causes:

- **R1. Bash sequencer, not a DAG.** `scripts/check-fast.sh` runs 8 named phases in series via `run_check`. Phases that have no inter-dependency (lint vs typecheck vs test vs format) wait on each other for no reason. Turbo already builds the per-package DAG; we re-serialize it at the script level.
- **R2. `--concurrency=1` on tests.** Disables Turbo's parallelism across packages. Likely a band-aid for testcontainer port collisions or DB contention; punishes everyone on every push.
- **R3. `packages:build` prebuild tax (24s).** Exists because workspace consumers import `.d.ts` from sibling package `dist/`. TS project references or `isolatedDeclarations` would eliminate this. Phase 2.
- **R4. `check:docs` + `db:check` not in turbo graph.** No `inputs:` declared, no caching. They run on every invocation even when nothing they care about changed.
- **R5. No remote cache.** Every fresh worktree, every CI runner, every agent VM starts from cold cache. Phase 2.

## Phase 1 scope (this PR)

Ship the wins that don't touch the package import surface, don't introduce vitest-level filtering, and don't try to cache the work-index generator:

### 1. Collapse the bash sequencer into one turbo invocation

Replace this:

```bash
run_check "workspace:typecheck" "bash scripts/run-turbo-checks.sh typecheck"
run_check "lint"                "pnpm lint"
run_check "workspace:lint"      "bash scripts/run-turbo-checks.sh lint"
run_check "format"              "pnpm format:check"
run_check "check:docs"          "pnpm -s check:docs"
run_check "db:check"            "pnpm -s db:check"
run_check "workspace:test"      "bash scripts/run-turbo-checks.sh test --concurrency=1"
```

With:

```bash
# packages:build still runs first (Phase 2 removes it) — outside the turbo run.
run_check "packages:build" "node scripts/run-scoped-package-build.mjs"

# One turbo invocation, full parallelism, affected-aware, with everything in the DAG
# *except* check:docs (deferred — see "Deferred from Phase 1" below).
run_check "workspace" "bash scripts/run-turbo-checks.sh lint typecheck test format:check db:check"

# check:docs continues to run as a separate root step — unchanged from today.
run_check "check:docs" "pnpm -s check:docs"
```

This collapses 7 `run_check` calls into 3. Root `lint` and `format:check` become root-workspace turbo tasks (see step 3) so they participate in the DAG. `check:docs` stays outside until the `work:index` regen issue is split out (separate task).

### 2. Drop `--concurrency=1` on tests

Pre-flight required: grep history for why `--concurrency=1` was added. Two outcomes:

- **Cause known and fixable inside the offending package** (e.g., testcontainer dynamic ports, isolated DB schema per worker) → fix it there, drop the global flag.
- **Cause unknown or systemic** → keep `--concurrency=1` in _that one package's_ vitest config, drop the global flag.

Never globally serialize the whole workspace because one package has a flake.

### 3. Move `db:check` and root `lint`/`format:check` into the turbo graph

Root `package.json` becomes a participating workspace package with these turbo tasks. Add to `turbo.json`:

```jsonc
"db:check": {
  "inputs": [
    "nodes/*/drizzle.config.ts",
    "nodes/*/drizzle.doltgres.config.ts",
    "nodes/*/packages/db-schema/**",
    "nodes/*/packages/doltgres-schema/**",
    "nodes/*/migrations/**"
  ]
},
"format:check": {
  "inputs": [
    "**/*.{ts,tsx,js,jsx,mjs,cjs,json,md,yml,yaml}",
    ".prettierrc*",
    ".prettierignore"
  ]
}
```

Workspace-package `lint` task already exists; the root package gets its own `lint` script that turbo runs as part of the DAG.

Re-runs on no-change hit cache in <500ms each.

### 4. Compact turbo logs (already wired)

`run-turbo-checks.sh` already sets `--output-logs=errors-only --log-order=grouped`. Verify it propagates to the new multi-task form.

## Deferred from Phase 1

These were in the original design but were called out in the design review (C1, C2) as correctness-fragile or coupled to a separate concern:

### Vitest `--changed` (deferred — correctness risk)

In a monorepo where cross-package types resolve through built `.d.ts` in sibling `dist/`, vitest `--changed` walks each test's static import graph and can miss transitive source changes that Turbo `--affected` correctly identifies. Layering this on top of Turbo `--affected` buys little and risks false-negative test runs. Defer until import boundaries are resolved through TS project references (Phase 2).

### `check:docs` caching (deferred — work-index regen is a separate concern)

`check:docs` mutates `work/items/_index.md` via `work:index`. Caching this task hits a self-invalidating output (the index is both an input and an output) and would need either (a) splitting `work:index` out of `check:docs` or (b) excluding the index file from inputs/outputs and relying on drift detection. Both are real changes; user has explicitly asked to handle the work-item index in a separate task. Leave `check:docs` as-is.

## Phase 2 (follow-up — separate task)

- **Turbo Remote Cache** (Vercel free tier or self-hosted `turborepo-remote-cache` on R2/S3). Cold worktree → warm cache → 5-10s `check:fast`. Single biggest agent/CI cold-start win.
- **TS project references** _or_ `isolatedDeclarations` to delete `packages:build` entirely. Phase 2 task owes a tradeoff write-up before scheduling — these are very different migrations:
  - _Project references_: requires `composite: true` in every `tsconfig.json` and an explicit `references` graph; downstream cost is migration-only.
  - _Isolated declarations_ (TS 5.5+): requires explicit return-type annotations on every public export; downstream cost is permanent stylistic burden.
- **Root format → biome only**, drop prettier from the gate (move to commit-time only). Prettier check on the world is 18s.
- **`work:index` split out of `check:docs`** so docs validation can be cached independently of the index regenerator.

## Phase 2 (follow-up — separate task)

- **Turbo Remote Cache** (Vercel free tier or self-hosted `turborepo-remote-cache` on R2/S3). Cold worktree → warm cache → 5-10s `check:fast`. Single biggest agent/CI win.
- **TS project references** OR `isolatedDeclarations: true` to delete `packages:build` entirely. Workspace typecheck reads sibling sources, not built `.d.ts`.
- **Root format → biome only**, drop prettier from the gate (move to commit-time only). Prettier check on the world is 18s.

## Risks

- **R-1: Husky pre-push regression.** Mitigation: keep the same `pnpm check:fast` entrypoint, same exit-code semantics, same drift detection. Run before/after wall-time benchmarks on `main` and on a 1-file change.
- **R-2: Removing `--concurrency=1` exposes a real flake.** Mitigation: if CI flakes after this PR, revert just that line and file a bug for the underlying flake — don't block the whole speed-up.
- **R-3: Turbo cache key for `check:docs` misses an input.** Mitigation: include the full set of validator scripts + every doc directory those scripts touch in `inputs:`. If a docs change slips through, cache-bust by editing `globalDependencies`.

## Design

### Outcome

The husky pre-push gate `pnpm check:fast` becomes fast enough that no agent or human is tempted to bypass it: <30s warm-cache on a clean `main` rerun, <90s cold-cache on a fresh worktree, dominated by actual changed-code work rather than orchestration tax.

### Approach

**Solution**: Collapse the bash sequencer into one `turbo run` invocation that drives lint + typecheck + test + format:check + db:check as one parallel DAG; pull root `lint`/`format:check` and `db:check` into the turbo graph with explicit `inputs:` so they cache; drop `--concurrency=1`; keep `check:docs` and `packages:build` outside the turbo run for now. Keep the existing `scripts/check-fast.sh` shell as the husky entrypoint and keep the drift-detection guardrails.

**Reuses**:

- Existing Turbo `--affected` infrastructure already wired in `scripts/run-turbo-checks.sh`.
- Existing per-package vitest configs and `turbo.json` task definitions.
- Existing husky `pre-push` hook contract — no change to what husky calls.

**Rejected**:

- _Replace husky pre-push with CI-only gating_ — pushes broken code into PRs and burns CI minutes; defeats the loop.
- _Switch to Nx or Bazel_ — replaces a tuning problem with a migration project; Turbo already covers everything we need.
- _Implement remote cache + project references in this PR_ — large surface, requires infra/secret setup and TS config rewrites across all packages. Split into Phase 2 to keep this PR reviewable in <300 LOC.
- _Skip prebuild step now via tsconfig `paths` only_ — would work but masks a real architectural debt; do it properly with project references in Phase 2.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] HUSKY_PREPUSH_UNCHANGED: `.husky/pre-push` still calls `pnpm check:fast` and exits non-zero on any failure.
- [ ] DRIFT_DETECTION_INTACT: `scripts/check-fast.sh` still snapshots tree hash before/after and fails on mid-run mutation.
- [ ] CACHE_INPUTS_COMPLETE: `db:check` and `format:check` task `inputs:` cover every file the validators read; missing inputs → silent stale cache → broken push.
- [ ] NO_GLOBAL_TEST_SERIALIZATION: `--concurrency=1` removed from the global test invocation; per-package serialization stays inside that package's vitest config if needed.
- [ ] CONCURRENCY_ROOT_CAUSE_KNOWN: before dropping `--concurrency=1` globally, the original reason for adding it is identified (commit/PR archaeology) and either fixed or scoped to one package.
- [ ] AFFECTED_FALLBACK_PRESERVED: On `main` (no upstream), behavior falls back to full workspace run, same as today.
- [ ] WORK_INDEX_UNTOUCHED: `check:docs` (which regenerates `work/items/_index.md`) is unchanged in this PR; caching it is a separate task.
- [ ] NO_VITEST_CHANGED_FILTER: vitest `--changed` is NOT introduced in this PR (deferred per design review C1).
- [ ] SIMPLE_SOLUTION: One turbo invocation + two new task entries; no new orchestration code.
- [ ] PHASE_2_DEFERRED: Remote cache, project references, prebuild removal explicitly out of scope; tracked separately.

### Files

<!-- High-level scope -->

- Modify: `scripts/check-fast.sh` — collapse 7 `run_check` calls into 3 (prebuild, single turbo run, check:docs).
- Modify: `scripts/run-turbo-checks.sh` — accept multiple task names in one invocation; remove `--concurrency=1` plumbing.
- Modify: `turbo.json` — add `db:check` and `format:check` task definitions with `inputs:`. Confirm `lint` task already covers root lint.
- Modify: `package.json` (root) — name the root workspace package so it's a turbo participant; expose `format:check` and root `lint` as scripts the turbo task can call.
- Test: manual benchmark before/after on (a) clean `main` rerun (b) 1-file change (c) global build input change. Capture in PR description.

## Review Feedback (revision 1)

**B1 (fixed)**: First-cut `//#lint` inputs were narrow to `nodes/operator/app/src/{app,components,features,styles}` — that was the _ESLint_ scope, not the _biome_ scope. Biome's `files.includes` covers `nodes/*/app/**`, `packages/**`, `services/**`, `tests/**`, `scripts/**`, `infra/compose/**`, root files. The narrow inputs would have served stale-pass on biome violations introduced in those untracked paths (especially `scripts/` and `infra/compose/`). Fixed by expanding `inputs:` to mirror `biome.json`'s `files.includes`. Also added `package.json` to both `//#lint` and `//#format:check` so root script changes invalidate cache. Verified locally; CI green.

## Implementation Result

Phase 1 implementation complete and benchmarked locally:

| Mode                           | Before | After | Speedup |
| ------------------------------ | ------ | ----- | ------- |
| Cold cache (fresh worktree)    | ~4 min | ~32s  | ~7.5×   |
| Warm cache (no source changes) | ~4 min | ~3s   | ~80×    |

Detail per phase on warm cache:

```
✓ packages:build passed (0s)   — scoped builder skips when no package source changed
✓ workspace passed (1s)        — turbo cache hit on lint/typecheck/test/format:check/db:check
✓ check:docs passed (2s)       — runs every time (deferred per design review C2)
✓ All fast checks passed!
3.0s wall-clock total (191% CPU)
```

CPU is now bounded at 50% by `--concurrency=50%`, preventing vitest fork-pool exhaustion (the original reason for `--concurrency=1`; commit 42b2b432b). Scales with hardware: 8-core dev → 4 parallel; 4-core CI → 2 parallel.

### Files changed

- `turbo.json` — added `//#lint`, `//#format:check`, `//#db:check` root tasks with explicit `inputs:` for cache correctness.
- `scripts/check-fast.sh` — collapsed 8 sequential `run_check` phases into 3 (`packages:build`, `workspace`, `check:docs`); single turbo invocation drives all parallel-safe checks.

### Note on `MAIN_IS_HOLY_CLEAN` regression

During implementation, surfaced 7 pre-existing lint errors in `@cogni/poly-app` from PR #1103 (commit 5930d4abb). User patched main directly before I rebased, so these are no longer relevant to this PR. Root cause for future watch: `--affected` against `origin/main` from poly-app-untouched feature branches never re-ran `poly-app#lint`, masking the regression until a global-hash-invalidating change like this one.

## Validation

### exercise

```bash
# Worktree freshly bootstrapped (cold cache):
cd /tmp && rm -rf cogni-bench && git clone --depth 1 git@github.com:Cogni-DAO/node-template cogni-bench
cd cogni-bench && git checkout task/0415-check-fast-turbo-dag
pnpm install --frozen-lockfile
time pnpm check:fast   # cold-cache target: <90s

# Same worktree, second run (warm cache):
time pnpm check:fast   # warm-cache target: <30s

# Trivial 1-file change in one package:
echo "// noop" >> packages/db-schema/src/index.ts
time pnpm check:fast   # affected-only target: <30s

# Drift still detected:
# (pre-stage a check that mutates a tracked file mid-run; verify exit 1 + git status surfaced)
```

### observability

Local-only task — no Loki signal needed. Capture before/after wall-time table in PR description, including:

- Cold-cache vs warm-cache.
- Single-package change vs full-workspace change.
- CPU usage during `workspace:test` phase (was 100% all cores due to default concurrency; should still be parallel but not pinned to 1).

The "before" baseline is the screenshot in the design conversation: `packages:build 24s, workspace:typecheck 17s, lint 6s, workspace:lint 3s, format 18s, check:docs 3s, db:check 8s, workspace:test 172s`.
