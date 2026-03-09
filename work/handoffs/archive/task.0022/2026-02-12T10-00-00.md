---
id: task.0022.handoff
type: handoff
work_item_id: task.0022
status: active
created: 2026-02-12
updated: 2026-02-12
branch: fix/check-output-verbosity
last_commit: ad1c9544
---

# Handoff: Git Relay MVP — Gateway Agent pnpm + git Foundations

## Context

- task.0022 is a git relay MVP: agent edits code in a sandbox container, commits locally, host pushes + creates PR
- Scope was narrowed to **gateway (long-lived OpenClaw) only** — ephemeral mode is deprioritized
- This session focused on the prerequisite: giving the gateway agent a writable workspace with pnpm offline install and local git commit
- All changes are uncommitted on `fix/check-output-verbosity` (unrelated branch — needs a proper feature branch)
- The gateway container already has pnpm 9.12.2, git, bash/exec tools, and all required Docker volumes

## Current State

- **Done:** Config changes to point gateway agent workspace to `/workspace/current`, set `HOME=/workspace`, add git identity env vars, move `OPENCLAW_STATE_DIR` to `/workspace/.openclaw-state`
- **Done:** Shared test fixtures for gateway workspace bootstrap (`ensureGatewayWorkspace`, `createGatewayTestClone`, `cleanupGatewayDir`)
- **Done:** Stack test with hard prereq check (fails loud if `/repo/current` missing)
- **Done:** AGENTS.md updated in both `src/adapters/server/sandbox/` and `services/sandbox-openclaw/` marking ephemeral as deprioritized
- **Not proven yet:** The 4 new tests (workspace bootstrap + git commit) have not passed — `/repo/current` was absent in test stack run. The 5 existing pnpm store smoke tests pass
- **Not started:** git relay orchestration (host-side clone, post-run push, PR creation), openclaw-coder agent registration, `GITHUB_TOKEN` / credential handling

## Decisions Made

- Gateway-only: ephemeral containers deprioritized — see `src/adapters/server/sandbox/AGENTS.md`
- `/repo/current` stays read-only (git-sync mirror immutable). Agent works in `/workspace/current` (writable clone)
- `pnpm_store` and `cogni_workspace` are named volumes on same Docker fs — pnpm hardlinks work
- Git push/credentials out of scope for this phase — local commits only
- No OpenClaw source code changes needed; agent already has exec/bash tool access

## Next Actions

- [ ] Move uncommitted changes to a proper feature branch (e.g., `feat/task-0022-git-relay-mvp`)
- [ ] Verify the 4 new workspace tests pass with full `dev:stack:test` (needs git-sync to populate `/repo/current`)
- [ ] Validate gateway boots cleanly with `HOME=/workspace` and new `OPENCLAW_STATE_DIR` (manual: `docker logs openclaw-gateway`)
- [ ] Implement git relay orchestration in `sandbox-graph.provider.ts` per task.0022 plan: host clones repo → agent commits → host pushes branch + creates PR
- [ ] Register `openclaw-coder` agent variant in `SANDBOX_AGENTS` registry
- [ ] Add `GITHUB_TOKEN` handling for host-side push (env var, never in container)
- [ ] End-to-end smoke test: send coding task → verify branch pushed + PR created

## Risks / Gotchas

- `HOME=/workspace` was `HOME=/tmp` before — untested with live gateway process. If gateway fails to start, revert to `/tmp` and investigate
- `/repo/current` requires git-sync to have run — tests fail hard if missing (by design)
- `cogni_workspace` volume persists across container restarts — stale `/workspace/current` clone could have outdated code. Consider freshness check against `/repo/current`
- `noexec` on `/tmp` tmpfs (128m) could cause issues with pnpm postinstall scripts. If so, set `PNPM_IGNORE_SCRIPTS=1`

## Pointers

| File / Resource                                                          | Why it matters                                                                          |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `work/items/task.0022.git-relay-mvp.md`                                  | Full requirements, plan, and validation criteria                                        |
| `services/sandbox-openclaw/openclaw-gateway.json`                        | Gateway agent config — workspace now `/workspace/current`                               |
| `platform/infra/services/runtime/docker-compose.dev.yml` (lines 524-575) | Gateway service definition — env vars, volumes, networks                                |
| `src/adapters/server/sandbox/sandbox-graph.provider.ts`                  | Gateway execution path (`createGatewayExecution`) — where git relay orchestration goes  |
| `tests/_fixtures/sandbox/fixtures.ts`                                    | Shared helpers: `ensureGatewayWorkspace`, `createGatewayTestClone`, `GATEWAY_CONTAINER` |
| `tests/stack/sandbox/sandbox-openclaw-pnpm-smoke.stack.test.ts`          | Smoke tests — 5 passing (store), 4 pending (workspace bootstrap + git)                  |
| `docs/spec/openclaw-sandbox-controls.md`                                 | Spec for HOST_SIDE_GIT_RELAY, SECRETS_HOST_ONLY, WORKSPACE_SURVIVES_FOR_PUSH            |
| `src/adapters/server/sandbox/AGENTS.md`                                  | Ephemeral deprioritization rationale                                                    |
