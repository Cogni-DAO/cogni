---
id: task.0022.handoff
type: handoff
work_item_id: task.0022
status: active
created: 2026-02-12
updated: 2026-02-12
branch: feat/task-0022-git-relay-mvp
last_commit: ef74cb86
---

# Handoff: Git Relay MVP — Gateway Worktree + Bundle + PR

## Context

- **Goal:** A sandbox agent (OpenClaw gateway) edits code, commits locally, and the host pushes the branch + creates a GitHub PR. The PR URL is returned in the chat response.
- The relay uses **git-native offline transport** (`git bundle`, not format-patch) and **`gh` CLI** for PR ops (no bespoke REST client).
- Branch identity is `branchKey` (stable work identity) — **never `runId`**. Multiple runs/agents can append commits to the same branch. See spec invariant 23 (BRANCH_KEY_IDENTITY).
- Gateway is the only active execution mode (ephemeral deprioritized). The agent runs in a long-lived container on `sandbox-internal` network with no external egress.
- Credentials (`OPENCLAW_GITHUB_RW_TOKEN`) stay on the host — never in the container (invariant 4, SECRETS_HOST_ONLY).

## Current State

- **Done:** Gateway workspace config (HOME=/workspace, git identity env vars, agent workspace at /workspace/current)
- **Done:** Smoke tests passing (9/9): pnpm store, offline install, workspace bootstrap, git commit inside container
- **Done:** Spec updated — `openclaw-sandbox-controls.md` rewritten with gateway-mode flow, branchKey contract, worktree model, `gh` CLI for PRs
- **Done:** `git-relay.ts` implemented — `GitRelayManager` class with worktree setup, bundle creation, host-side push, `gh pr create/list`
- **Done:** `OPENCLAW_GITHUB_RW_TOKEN` added to server env schema (optional; relay skipped if absent)
- **Not done:** Wiring `GitRelayManager` into `createGatewayExecution()` in `sandbox-graph.provider.ts`
- **Not done:** `OPENCLAW_GITHUB_RW_TOKEN` propagation to `.env` files and deployment configs
- **Not done:** End-to-end manual smoke test

## Decisions Made

- **branchKey > runId**: Spec invariant 23 in `docs/spec/openclaw-sandbox-controls.md`. Sources ranked: explicit branchName > workItemId > stateKey (opt-in only). Never auto-derive from stateKey.
- **git bundle > format-patch**: First-party git transport; handles binaries, merge commits. Bundle written to container `/tmp/`, `docker cp` to host.
- **gh CLI > REST API**: No bespoke GitHub REST client. `gh pr list` / `gh pr create` with `GITHUB_TOKEN` env.
- **Worktrees > single checkout**: `/workspace/wt/<branchKey>` via `git worktree add`. Symlink `/workspace/current` → active worktree for agent compatibility.
- **Origin = git-sync mirror**: Worktree remote `origin` points to `/repo/current` (local). `git fetch`/`rebase` work natively in container without network.

## Next Actions

- [ ] Wire `GitRelayManager` into `createGatewayExecution()`: pre-run calls `ensureWorkspaceBranch()`, post-run calls `relayCommits()`, append PR URL to `GraphFinal.content`
- [ ] Resolve branchKey from `GraphRunRequest` — check for explicit branchName, then workItemId, skip if neither present
- [ ] Propagate `OPENCLAW_GITHUB_RW_TOKEN` to `.env.local.example`, `.env.test.example`, and deploy pipeline
- [ ] Manual e2e smoke test: `pnpm dev:stack` → chat with openclaw agent → verify branch pushed + PR created
- [ ] Confirm `gh` CLI is available in the host environment (CI + dev)

## Risks / Gotchas

- **git-sync uses worktrees**: `/repo/current/.git` is a file, not a directory. Always use `git rev-parse` (not `test -d .git`) — this was already a bug we fixed (commit `aefcb5b5`).
- **`/workspace/current` is a symlink**: After `ensureWorkspaceBranch`, `/workspace/current` → `/workspace/wt/<branchKey>`. The OpenClaw agent config points to `/workspace/current` — it follows the symlink transparently.
- **P0 concurrency = single branchKey**: Only one branchKey active at a time. The provider should hold a branchKey lock if concurrent requests are possible. Worktrees make P0.5 multi-branch safe.
- **`docker cp` for bundle transfer**: Named Docker volumes aren't directly accessible on macOS. Bundle is written to `/tmp/` (tmpfs, 128m, noexec) in the container — bundles must stay small. If bundle exceeds tmpfs, consider a different transfer path.

## Pointers

| File / Resource                                                          | Why it matters                                                                                |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `work/items/task.0022.git-relay-mvp.md`                                  | Full requirements, plan with [x] progress, validation criteria                                |
| `docs/spec/openclaw-sandbox-controls.md`                                 | Authoritative spec — branchKey contract (sec 2), relay flow diagram (sec 3), invariants 20-26 |
| `src/adapters/server/sandbox/git-relay.ts`                               | `GitRelayManager` — the relay implementation (worktree, bundle, push, PR)                     |
| `src/adapters/server/sandbox/sandbox-graph.provider.ts`                  | `createGatewayExecution()` (line ~411) — where relay wiring goes                              |
| `src/shared/env/server.ts`                                               | `OPENCLAW_GITHUB_RW_TOKEN` schema definition                                                  |
| `platform/infra/services/runtime/docker-compose.dev.yml` (lines 524-579) | Gateway service: env vars, volumes, networks                                                  |
| `tests/stack/sandbox/sandbox-openclaw-pnpm-smoke.stack.test.ts`          | 9 passing smoke tests — pnpm + workspace + git commit                                         |
| `tests/_fixtures/sandbox/fixtures.ts`                                    | Shared helpers: `ensureGatewayWorkspace`, `createGatewayTestClone`, `GATEWAY_CONTAINER`       |
