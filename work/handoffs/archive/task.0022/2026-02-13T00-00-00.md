---
id: task.0022.handoff
type: handoff
work_item_id: task.0022
status: active
created: 2026-02-12
updated: 2026-02-12
branch: feat/task-0022-git-relay-mvp
last_commit: 49d72138
---

# Handoff: Git Relay MVP — Simplified publish() + Dev Tools PoC

## Context

- **Goal:** Sandbox agent (OpenClaw gateway) edits code, commits locally, and host pushes the branch + creates a GitHub PR via a single `publish()` call.
- The relay uses **git bundle** (offline transport) + `docker cp` + host-side `git push` + `gh pr create`. No network egress from container.
- **Major simplification**: No auto-branching, no pre/post-run hooks, no cron. Agent must `git switch -c sandbox/<slug>` itself. Host only does publish.
- `OPENCLAW_GITHUB_RW_TOKEN` is a **required** env var (Zod-validated, fail-fast in compose, in REQUIRED_SECRETS for deploy).
- Token stays host-only (invariant 4, SECRETS_HOST_ONLY). Never enters the container.

## Current State

- **Done:** `OPENCLAW_GITHUB_RW_TOKEN` propagated everywhere — Zod schema (required), `.env.*.example`, docker-compose (dev + prod), deploy.sh (REQUIRED_SECRETS), both GH workflows, SETUP_DESIGN.md
- **Done:** `git-relay.ts` — `GitRelay.publish()` implemented: detect branch in container → guard `sandbox/*` allowlist → `git bundle` → `docker cp` → host clone+fetch+push. Has `import "server-only"`.
- **Done:** 13 unit tests for pure helpers (`demuxDockerStream`, `injectTokenIntoUrl`, `parseGitHubUrl`) — all passing
- **Done:** PoC proven — `pnpm check` runs successfully inside `openclaw-gateway` container (typecheck, lint, format, 568 unit + 101 contract tests, docs, arch check all pass)
- **Not done:** Simplify `git-relay.ts` — remove `GitRelayManager` class, worktree management, `ensureWorkspaceBranch`, branchKey resolution. Keep only `publish()` + helpers.
- **Not done:** Wire `publish()` into `createGatewayExecution()` in `sandbox-graph.provider.ts`
- **Not done:** `gh pr create`/`gh pr list` integration (currently push-only, no PR creation in code)
- **Not done:** Fresh workspace bootstrap — a new workspace clone needs `pnpm install` (pnpm store at `/pnpm-store/v3/` is populated, install is fast)

## Decisions Made

- **Single `publish()` tool, no orchestration**: User directive — remove pre/post-run relay manager surface. Agent creates its own branch; host only publishes. See conversation context.
- **`sandbox/*` allowlist only**: Never push staging/main/master/HEAD. Guard in `git-relay.ts:89-98`.
- **`injectTokenIntoUrl` is acceptable**: User explicitly rejected GIT_ASKPASS (reverted in `49d72138`). Simple token-in-URL for the ephemeral clone+push is fine.
- **`gh` CLI for PR ops**: Use `GITHUB_TOKEN` env in child process. No bespoke REST client.
- **Required env var, not optional**: `OPENCLAW_GITHUB_RW_TOKEN` — Zod `.min(1)`, `REQUIRED_SECRETS` in deploy.sh, fail-fast `${?...}` in compose.

## Next Actions

- [ ] Simplify `git-relay.ts`: delete `GitRelayManager` class, worktree management, `ensureWorkspaceBranch`. Keep `GitRelay.publish()` + module-level helpers.
- [ ] Add `gh pr list` / `gh pr create` to `publish()` flow (after push succeeds)
- [ ] Wire `publish()` into `createGatewayExecution()` post-run path in `sandbox-graph.provider.ts`
- [ ] Ensure fresh workspace runs `pnpm install` on first boot (or document it as agent responsibility)
- [ ] Manual e2e smoke test: `pnpm dev:stack` → agent creates `sandbox/*` branch → `publish()` → PR created
- [ ] Confirm `gh` CLI available in host env (dev + CI)

## Risks / Gotchas

- **Fresh workspace needs `pnpm install`**: `node_modules` is gitignored. The `cogni_workspace` Docker volume retains it across restarts, but a fresh clone from git-sync won't have it. Pnpm store at `/pnpm-store/v3/` is populated so install is fast (~seconds).
- **`docker cp` + tmpfs limits**: Bundles written to `/tmp/` in container (tmpfs, 128m). Large bundles could exceed tmpfs. Monitor bundle size.
- **Token in clone URL**: `injectTokenIntoUrl` puts the PAT in the URL for ephemeral clone. The temp dir is cleaned up in `finally` block. Never log the URL.
- **git-sync uses worktrees**: `/repo/current/.git` is a file, not a directory. Always use `git rev-parse` (not `test -d .git`).

## Pointers

| File / Resource                                                | Why it matters                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/adapters/server/sandbox/git-relay.ts`                     | `GitRelay.publish()` + pure helpers — the relay implementation    |
| `tests/unit/adapters/server/sandbox/git-relay-helpers.test.ts` | 13 unit tests for `demux`, `injectTokenIntoUrl`, `parseGitHubUrl` |
| `src/shared/env/server.ts`                                     | `OPENCLAW_GITHUB_RW_TOKEN` Zod schema (required)                  |
| `platform/ci/scripts/deploy.sh`                                | REQUIRED_SECRETS + .env write block + SSH passthrough             |
| `scripts/setup/SETUP_DESIGN.md`                                | Setup design — token listed under service secrets                 |
| `src/adapters/server/sandbox/sandbox-graph.provider.ts`        | `createGatewayExecution()` — where `publish()` wiring goes        |
| `docs/spec/openclaw-sandbox-controls.md`                       | Spec — relay flow, invariants 20-26                               |
| `work/items/task.0022.git-relay-mvp.md`                        | Full requirements and plan                                        |
