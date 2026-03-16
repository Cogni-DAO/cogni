---
id: bug.0136
type: bug
title: "Claude Code remote environment ships empty pnpm store — pnpm install and pnpm check fail out-of-the-box"
status: done
priority: 0
rank: 1
estimate: 2
summary: Every remote Claude Code session starts with an empty pnpm content-addressable store and partially-extracted node_modules (1996 dirs in .pnpm but no .modules.yaml). `pnpm install --offline --frozen-lockfile` (the AGENTS.md-prescribed command) fails immediately. Even after a network install succeeds (~2 min), `pnpm check` hits vitest forks-runner timeouts on the container.spec.ts test.
outcome: Remote Claude Code sessions can run `pnpm install --frozen-lockfile` and `pnpm check` cleanly on first boot with no manual intervention.
spec_refs:
assignees: derekg1729
credit:
project:
branch: claude/fix-pnpm-environment-jPDbs
pr: pending — branch pushed, no gh CLI auth available to create PR
reviewer:
revision: 2
blocked_by:
deploy_verified: false
created: 2026-03-05
updated: 2026-03-06
labels: [dx, ci, environment, p0]
last_command: /closeout
external_refs:
---

# Claude Code remote environment ships empty pnpm store — pnpm install and pnpm check fail out-of-the-box

## Requirements

### Observed

1. **Empty pnpm store**: The content-addressable store at `/root/.local/share/pnpm/store/v3` is completely empty on session start (0 files). The `node_modules/.pnpm` directory contains 1996 skeleton directories but no `.modules.yaml` — packages are extracted but never linked.

2. **`pnpm install --offline --frozen-lockfile` fails immediately**:

   ```
   ERR_PNPM_NO_OFFLINE_TARBALL  A package is missing from the store but cannot
   download it in offline mode. The missing package may be downloaded from
   https://registry.npmjs.org/@assistant-ui/react/-/react-0.12.10.tgz.
   ```

   This is the command prescribed by `AGENTS.md:29` for agent installs.

3. **`pnpm install --frozen-lockfile` (with network) works** but takes ~2 minutes to download all 1996 packages from scratch, burning session time and network egress.

4. **`pnpm check` fails after install** — `test:unit` hits repeated `[vitest-pool]: Timeout starting forks runner` errors in `tests/unit/bootstrap/container.spec.ts`. The test itself times out at 10s, then 5 forks-runner timeout errors cascade. This may be a resource-constraint issue (the container has 16 vCPUs and 22 GB RAM, but `pending signals` ulimit is 0, which may starve child process signaling).

### Expected

- The pnpm store should be pre-populated so `pnpm install --offline --frozen-lockfile` completes in seconds (the way sandbox environments work via `task.0036`).
- `pnpm check` should pass cleanly on a fresh staging checkout with no manual setup.
- No vitest forks-runner timeouts on the standard unit test suite.

### Reproduction

1. Start any new Claude Code remote session on this repository (staging branch).
2. Run: `pnpm install --offline --frozen-lockfile` — **fails** with `ERR_PNPM_NO_OFFLINE_TARBALL`.
3. Run: `pnpm install --frozen-lockfile` — succeeds after ~2 min network download.
4. Run: `pnpm check` — `test:unit` fails with forks-runner timeouts.

### Impact

- **Every remote Claude Code agent session is broken on boot.** No agent can run `pnpm check` without first doing a 2-minute network install, and even then the test suite has flaky timeouts.
- Agents that follow `AGENTS.md:29` (`pnpm install --offline --frozen-lockfile`) fail immediately and get stuck.
- This affects all automated agent workflows (governance, implementation, closeout) that depend on `pnpm check` as a validation gate.

### Root Cause Analysis

**Problem 1 — Empty store**: The Claude Code remote environment image pre-extracts `node_modules/.pnpm` directories but does NOT populate the pnpm content-addressable store (`/root/.local/share/pnpm/store/v3`). Without the store, `--offline` mode has no package tarballs to link from. The image build likely runs `pnpm install` during image creation but the store lives outside the repo directory and is not persisted into the container image, or is cleaned during a layer-squash step.

**Problem 2 — Vitest forks timeout**: The container's `ulimit -i` (pending signals) is set to `0`. Vitest's forks pool spawns child processes and relies on IPC signals. With zero pending signals allowed, child process startup can deadlock, causing the `Timeout starting forks runner` cascade. This is a container security policy that is too restrictive for running a Node.js test suite with process forking.

### Key file pointers

| File                                     | Relevance                                             |
| ---------------------------------------- | ----------------------------------------------------- |
| `AGENTS.md:29`                           | Prescribes `pnpm install --offline --frozen-lockfile` |
| `scripts/check-fast.sh:76`               | Runs `test:unit` as part of `pnpm check`              |
| `vitest.config.mts`                      | Default forks pool config, 10s timeout                |
| `tests/unit/bootstrap/container.spec.ts` | The test that times out                               |
| `package.json` → `packageManager`        | `pnpm@9.12.2`                                         |

## Allowed Changes

- Claude Code environment configuration (SessionStart hooks, `.claude/settings.json`, `.claude/hooks.json`)
- Container/image build configuration for Claude Code remote sessions
- `AGENTS.md` — update install instructions if `--offline` cannot be guaranteed
- `vitest.config.mts` — pool configuration (e.g., switch to `threads` pool or increase forks timeout)
- `tests/unit/bootstrap/container.spec.ts` — timeout adjustments if needed

## Design

### Outcome

Remote Claude Code agent sessions boot into a working state: `pnpm install` completes automatically and `pnpm check` passes — same tests, same config, every environment. No ad-hoc exclude lists.

### Problem Summary

Two independent problems:

1. **Empty pnpm store** — Claude Code remote image has skeleton `node_modules` but no store. `pnpm install --offline` fails.
2. **Vitest forks hang** — `ulimit -i 0` in Claude Code remote kills the `forks` pool (IPC signals can't be delivered).

The rev 1 implementation fixed (2) by switching to `vmThreads` in constrained envs, then built a hand-maintained exclude list in `check-fast.sh` to shuttle DOM tests and `vi.hoisted`-dependent tests back to `forks`. This is fragile: every new DOM test or mock-hoisting test must be manually added to the exclude list, the list drifts, tests run twice or not at all, and the shell script becomes the source of truth for test routing instead of vitest config.

### Approach

**Principle: one config, zero shell-level test routing.** Vitest 4's `test.projects` lets us define two projects in `vitest.config.mts` with different pools. The split is declarative, vitest handles it, and `check-fast.sh` just calls `pnpm test:unit` — no excludes, no hardcoded file lists.

**Fix A — SessionStart hook** (`.claude/settings.json`): Unchanged from rev 1. Conditional `pnpm install --frozen-lockfile` if `node_modules/.modules.yaml` is missing.

**Fix B — Vitest projects** (`vitest.config.mts`): Replace the single-config-with-conditional-pool with two vitest projects:

1. **`unit`** — All `tests/unit/**` and `tests/ports/**` files. Uses `forks` normally, `vmThreads` when constrained. Excludes nothing — `vi.mock`, `vi.hoisted`, all patterns work identically in both pools for Node-environment tests.
2. **`unit:dom`** — Only files with `@vitest-environment happy-dom` or `@vitest-environment jsdom` annotation. Uses `forks` always (DOM environments need process-level isolation). In constrained envs: `singleFork: true`, `maxWorkers: 1`.

Wait — **`vi.mock`/`vi.hoisted` breaks in vmThreads too** (see `metrics.test.ts` in rev 1 review). So the `unit` project using vmThreads in constrained envs will still fail for any test using `vi.hoisted`. That's 4+ files today and growing.

**Revised approach — just use `forks` with `singleFork` everywhere:**

The real question: can `forks` with `singleFork: true` + `maxWorkers: 1` survive `ulimit -i 0`? With only ONE child process and no concurrent signal delivery, the IPC bottleneck that caused the original hang (spawning 16 workers simultaneously) is eliminated. The single fork communicates via stdin/stdout pipes, not signals. **This needs validation**, but if it works, it's the simplest possible fix: no pool switching, no projects split, no exclude lists. Same pool, same behavior, everywhere.

**Solution (rev 2):**

1. **`.claude/settings.json`** — SessionStart hook (unchanged from rev 1)
2. **`vitest.config.mts`** — Keep `pool: 'forks'` always. In constrained envs: `singleFork: true`, `maxWorkers: 1`. Remove vmThreads entirely.
3. **`scripts/check-fast.sh`** — Delete the entire constrained-env branch (lines 79-99). Replace with a single `run_check "test:unit" "pnpm test:unit"` and `run_check "test:contract" "pnpm test:contract"` — same as the non-constrained path. The shell script stops caring about environments.
4. **`AGENTS.md:29`** — Drop `--offline`
5. **Bump `testTimeout`/`hookTimeout` to 30s** — Unchanged from rev 1 (cold container import is slow)

**If `singleFork` hangs under `ulimit -i 0`:** Fall back to vitest projects split. But try the simple thing first.

**Reuses**: Vitest's built-in `singleFork` option, Claude Code SessionStart hooks.

**Rejected alternatives**:

- **vmThreads + shell exclude lists** (rev 1): Fragile. Every new DOM test or `vi.hoisted` test breaks silently. Shell becomes test router. Rejected by review.
- **vitest `test.projects` split (Node vs DOM)**: Viable fallback, but adds config complexity. Only needed if `singleFork` can't survive `ulimit -i 0`.
- **`threads` pool**: Breaks `process.chdir()` and process-level env manipulation used by container.spec.ts.
- **Patch ulimit in container**: Not under our control (Claude Code image).

### Invariants

- [ ] SAME_TESTS_EVERYWHERE: Every test file runs in every environment. No excludes, no conditional routing.
- [ ] SINGLE_CONFIG: `vitest.config.mts` is the sole source of truth for pool selection. `check-fast.sh` does not participate in test routing.
- [ ] CI_PARITY: Constrained env uses same pool (`forks`) as CI, just with `singleFork: true` + `maxWorkers: 1`. No behavioral divergence.
- [ ] SIMPLE_SOLUTION: Config-only changes. Zero new runtime code.
- [ ] NO_OFFLINE_ASSUMPTION: `AGENTS.md` no longer assumes pnpm store is pre-populated.

### Files

- Keep: `.claude/settings.json` — SessionStart hook (already created in rev 1)
- Modify: `vitest.config.mts` — Remove vmThreads. Use `forks` always. Constrained: `singleFork: true`, `maxWorkers: 1`.
- Modify: `scripts/check-fast.sh` — Delete constrained-env branch (lines 79-99). Single code path for all envs.
- Modify: `AGENTS.md:29` — Drop `--offline`
- Revert: `tests/unit/app/*.spec.tsx`, `tests/unit/features/**/*.test.ts` — Undo any JSDoc changes from rev 1 that were only needed for vmThreads compatibility

## Plan

- [x] Validate: singleFork survives `ulimit -i 0` — confirmed, container.spec.ts passes (12.5s)
- [x] Update `vitest.config.mts`: remove vmThreads, use `forks` always, constrained → `singleFork: true` + `maxWorkers: 1`
- [x] Simplify `scripts/check-fast.sh`: delete constrained-env branch, single code path
- [x] Revert unnecessary test file changes from rev 1 (6 files: jsdom→happy-dom reverts + repoSpec.server.test.ts process.chdir restore)
- [x] `AGENTS.md:29`: already had `--offline` removed in rev 1 — no change needed
- [x] Run `pnpm check` end-to-end — all checks passed
- [ ] Commit and push

## Validation

**Command:**

```bash
# In constrained env (this session):
pnpm check
```

**Expected:** All checks pass. Same tests run as CI. No exclude lists in shell script. No vmThreads anywhere.

**Fallback:** If `singleFork` hangs under `ulimit -i 0`, implement the vitest `test.projects` split (unit vs unit:dom) instead. This is the backup plan, not the primary design.

## Review Feedback

### Revision 1 — Blocking Issues (addressed by rev 2 redesign)

1. **`metrics.test.ts` fails in vmThreads pool**: `vi.hoisted` pattern breaks in shared VM context. **Rev 2 fix:** Eliminate vmThreads entirely.

2. **`app-layout-auth-guard.test.tsx` runs twice**: Shell exclude list doesn't match `.test.tsx` suffix. **Rev 2 fix:** Eliminate shell-level test routing entirely.

3. **Dead config**: `poolOptions.forks.singleFork` inert when pool is vmThreads. **Rev 2 fix:** Pool is always forks, so singleFork is always active in constrained envs.

4. **Fragile hardcoded file list**: Every new DOM test must be manually added. **Rev 2 fix:** No file lists. Vitest handles everything.

## Review Checklist

- [ ] **Work Item:** `bug.0136` linked in PR body
- [ ] **Spec:** all invariants of linked specs are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: `task.0036` (pnpm store CI/CD pipeline)
- Related: `task.0031` (openclaw cogni dev image)

## Attribution

- Investigation: Claude Code agent (claude-opus-4-6)
