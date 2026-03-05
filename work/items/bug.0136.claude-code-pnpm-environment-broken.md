---
id: bug.0136
type: bug
title: "Claude Code remote environment ships empty pnpm store — pnpm install and pnpm check fail out-of-the-box"
status: needs_closeout
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
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-05
updated: 2026-03-05
labels: [dx, ci, environment, p0]
last_command: /implement
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

Remote Claude Code agent sessions boot into a working state: `pnpm install` completes automatically and `pnpm check` passes without vitest forks-runner timeout errors.

### Approach

**Solution**: Three targeted, low-risk changes — no new code, no new dependencies.

**Fix A — SessionStart hook** (`.claude/settings.json`): Add a project-level Claude Code settings file with a SessionStart hook. The hook runs a conditional install script: if `node_modules/.modules.yaml` is missing (the signal that pnpm linking didn't complete), run `pnpm install --frozen-lockfile`. If already linked, skip (zero cost on subsequent sessions or if the image is ever fixed). This is the Claude Code standard mechanism — hooks in `.claude/settings.json` are loaded automatically for every session.

**Fix B — Vitest pool: `singleFork` mode** (`vitest.config.mts`): Set `poolOptions.forks.singleFork: true`. This reuses a single child process for all test files instead of spawning 16 concurrent forks. Eliminates the stampede that overwhelms the 5s hardcoded `WORKER_START_TIMEOUT` in vitest. Trade-off: tests run sequentially in one worker → ~10-15% slower on beefy machines, but **eliminates the 5 unhandled forks-runner timeout errors** that cause exit code 1 in constrained containers. CI machines are not affected (they have normal ulimits).

**Fix C — Bump `testTimeout` to 30s** (`vitest.config.mts`): The first dynamic import of `@/bootstrap/container` takes ~10.7s in the remote environment (cold module graph with 50+ adapter imports). Current 10s timeout clips it. 30s provides headroom without masking real hangs. CI remains fast — the timeout only matters when a test actually hangs.

**Fix D — AGENTS.md update**: Change `pnpm install --offline --frozen-lockfile` → `pnpm install --frozen-lockfile` since the pnpm store is not pre-populated in the Claude Code image.

**Reuses**: Claude Code's built-in SessionStart hooks system (`.claude/settings.json`), vitest's existing `poolOptions.forks.singleFork` config.

**Rejected alternatives**:

- **Switch to `threads` pool**: Tested — same runner-startup timeout at scale (threads share the same signal constraints). Also breaks tests using `process.chdir()` or process-level env manipulation (container.spec.ts does both).
- **`vmForks`/`vmThreads`**: More complex, less stable with ESM, can leak memory. Overkill.
- **Patch vitest's `WORKER_START_TIMEOUT`**: Fragile — gets overwritten on every `pnpm install`. Not portable.
- **Run `pnpm install` on every SessionStart unconditionally**: Wastes 2 min if already installed. The conditional check (`test -f node_modules/.modules.yaml`) is a one-liner guard.

### Invariants

- [ ] SIMPLE_SOLUTION: Only modifies config files — zero new runtime code
- [ ] ARCHITECTURE_ALIGNMENT: SessionStart hook follows Claude Code's standard hook pattern
- [ ] CI_PARITY: `singleFork` + 30s timeout does not regress CI (CI has normal ulimits; `singleFork` just serializes within one worker)
- [ ] NO_OFFLINE_ASSUMPTION: `AGENTS.md` no longer assumes pnpm store is pre-populated

### Files

- Create: `.claude/settings.json` — SessionStart hook for conditional `pnpm install`
- Modify: `vitest.config.mts` — add `poolOptions.forks.singleFork: true`, bump `testTimeout` to 30000
- Modify: `AGENTS.md:29` — drop `--offline` from install instruction

## Plan

- [ ] Create `.claude/settings.json` with SessionStart hook that conditionally runs `pnpm install --frozen-lockfile`
- [ ] Update `vitest.config.mts`: add `pool: 'forks'` (explicit), `poolOptions.forks.singleFork: true`, `testTimeout: 30_000`, `hookTimeout: 30_000`
- [ ] Update `AGENTS.md:29`: change `pnpm install --offline --frozen-lockfile` to `pnpm install --frozen-lockfile`
- [ ] Run `pnpm check:docs` to validate
- [ ] Commit and push

## Validation

**Command:**

```bash
# After fixes, a fresh session should pass:
pnpm install --frozen-lockfile && pnpm check
```

**Expected:** Both commands succeed with exit code 0. `pnpm check` reports all checks passed.

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
