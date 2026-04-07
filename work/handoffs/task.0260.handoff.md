---
id: task.0260.handoff
type: handoff
work_item_id: task.0260
status: active
created: 2026-04-07
updated: 2026-04-07
branch: feat/task-0260-turborepo-ci
last_commit: 004c6ffdc
---

# Handoff: Monorepo CI Pipeline — Affected-Scope Testing

## Context

- PR #790 adds `pnpm turbo run test --affected` to CI so only changed packages run tests on each PR
- `turbo.json` already exists at repo root with `typecheck`, `lint`, `test` tasks and strict env passthrough
- poly and resy nodes were squash-merged from separate repos — their `app/tests/` (207 files each) are **identical copies** of node-template's tests and have **never run in CI** until this PR
- PR #790 was the first execution of per-node tests in the monorepo — surfaced multiple pre-existing test failures across all nodes
- All known failures have been fixed and verified locally from package-dir CWD (exact CI simulation)

## Current State

- PR #790 open, last push `004c6ffdc`, CI run in progress for that commit
- Previous CI run (`7610bb882`) failed on `@cogni/node-template-app#test` → `treasury.snapshot.test.ts` (503s); root cause fixed in `004c6ffdc`
- Full resy suite runs clean from package dir: 134 files, 1234 tests, 0 failures (verified locally)
- node-template's full suite from package dir was NOT completed before handoff — CI result is the verification
- Stack tests (`stack-test` job) are conditional on scope changes and will also run for this push

## Decisions Made

- turbo v2 strict env mode: all env vars needed by test tasks are listed in [`turbo.json`](../../turbo.json) `test.env` array — unlisted vars are stripped from subprocesses
- `COGNI_REPO_PATH: ${{ github.workspace }}` set in CI checks job env so tests can find `.cogni/repo-spec.yaml` at repo root
- `TURBO_SCM_BASE: origin/${{ github.base_ref }}` set explicitly (branch not locally available in PR checkout with fetch-depth:0)
- Graphs packages (`nodes/*/graphs/`) had empty `test` scripts that crashed tsconfck — scripts removed in earlier commit
- All test fixes applied to all 3 nodes (resy, poly, node-template) even when only resy was failing — same bug exists in all 3 due to identical files, would surface on nightly `--force` run

## Next Actions

- [ ] Monitor CI run for `004c6ffdc` — check [Actions](https://github.com/Cogni-DAO/node-template/actions) for the `checks` job result
- [ ] If `checks` passes, verify `stack-test` job also green (conditional on scope detection)
- [ ] If new test failures surface: reproduce locally with `cd nodes/<node>/app && COGNI_REPO_PATH=<repo-root> vitest run --config vitest.config.mts` (exact CI simulation)
- [ ] Merge PR #790 once CI is green
- [ ] After merge: file `task.0261` to audit and remove duplicate test files from resy/poly (207 identical files each → keep only node-specific tests)
- [ ] `task.0261` should also migrate `tests/setup.ts` + `tests/_fixtures/` to `packages/node-test-utils` and use `createNodeVitestConfig()` factory in all node vitest configs

## Risks / Gotchas

- **Turbo caches can mask failures**: node-template tests may show "passing" from a stale cache hit — nightly `--force` run will expose them. All known failures were proactively fixed in all 3 nodes.
- **`process.cwd()` in fixtures**: any test fixture or mock that uses `process.cwd()` instead of `process.env.COGNI_REPO_PATH ?? process.cwd()` will fail when turbo sets cwd to the package dir — already fixed in `base-env.ts` and `tests/setup.ts`
- **207 × 3 duplicate tests** run sequentially on every canary/main push (~3× CI time); `--affected` scoping limits this on PRs but not branch pushes
- **Stack tests are not `--affected`**: when the `stack-test` job runs, it runs all stack tests — no turbo scoping there
- **INTERNAL_OPS_TOKEN min(32)** and similar token length validations in server-env.ts — CI values in `ci.yaml` must be ≥32 chars; short values cause `invalid` (not `missing`) errors that are harder to diagnose

## Pointers

| File / Resource                                                                                                | Why it matters                                                                                    |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`turbo.json`](../../turbo.json)                                                                               | Task pipeline + strict env allowlist — add env vars here if tests can't see them                  |
| [`.github/workflows/ci.yaml`](../../.github/workflows/ci.yaml)                                                 | Checks job env block (lines ~60-90) — fake-but-valid env values for unit/contract tests           |
| [`nodes/*/app/tests/_fixtures/env/base-env.ts`](../../nodes/node-template/app/tests/_fixtures/env/base-env.ts) | `CORE_TEST_ENV` + `MOCK_SERVER_ENV` — both now use `process.env.COGNI_REPO_PATH ?? process.cwd()` |
| [`nodes/*/app/tests/setup.ts`](../../nodes/node-template/app/tests/setup.ts)                                   | Global test setup — sets `COGNI_REPO_PATH` fallback, mocks server-only + rainbowkit               |
| [PR #790](https://github.com/Cogni-DAO/node-template/pull/790)                                                 | Full commit history of all CI fixes                                                               |
| [`packages/node-test-utils/src/vitest-configs/`](../../packages/node-test-utils/src/vitest-configs/)           | `createNodeVitestConfig()` factory — not yet used by resy/poly vitest configs                     |
