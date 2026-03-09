---
id: task.0022.handoff
type: handoff
work_item_id: task.0022
status: active
created: 2026-02-12
updated: 2026-02-13
branch: feat/task-0022-git-relay-mvp
last_commit: ec9311af
---

# Handoff: Gateway Internet Egress + Git Relay Deletion

## Context

- **Original goal**: Host-side git relay so sandbox agents could push code without credentials. A complex `GitRelayManager` class handled worktrees, bundles, and PR creation.
- **Pivot**: Instead of relaying through the host, we gave the gateway container direct internet access via the `cogni-edge` Docker network. The agent can now `curl`, `git push`, `web_fetch`, and `web_search` natively.
- **git-relay.ts deleted** — the agent has `GITHUB_TOKEN` in its env and internet egress. It can push directly.
- Ephemeral sandbox containers remain `network=none` (fully isolated). Only the long-running gateway gets egress.

## Current State

- **Done:** Gateway container on `cogni-edge` network (both compose files)
- **Done:** `GITHUB_TOKEN` (from `OPENCLAW_GITHUB_RW_TOKEN`) + `COGNI_REPO_URL` passed into gateway env
- **Done:** `group:web` removed from `tools.deny` in both gateway configs — `web_fetch`/`web_search` enabled
- **Done:** `git-relay.ts` deleted, barrel export cleaned, zero dangling references
- **Done:** Specs updated (invariant 21 renamed `GATEWAY_NETWORK_ACCESS`, tool table, credential strategy)
- **Done:** Root `AGENTS.md` has git remote + credential helper setup commands
- **Done:** `OPENCLAW_GITHUB_RW_TOKEN` propagated to all deploy paths (CI, compose, deploy.sh, env examples)
- **Not done:** Wiring git push into `SandboxGraphProvider.createGatewayExecution()` post-run path
- **Not done:** `gh` CLI not in container image — agent uses `curl` for GitHub API
- **Not done:** Workspace bootstrap automation (agent must manually run `git remote set-url` + credential helper)

## Decisions Made

- **Bridge networking over relay**: User directive — stop overengineering. The gateway runs our own agent, not untrusted code. Internet access is standard for AI coding tools.
- **Token in container is acceptable for gateway**: Ephemeral containers (`network=none`) never get tokens. Gateway is trusted.
- **git-relay deleted, not kept**: Never wired in, pure dead code. Agent pushes directly.
- **No `gh` CLI in image**: `curl -H "Authorization: Bearer $GITHUB_TOKEN"` works. Adding `gh` is a future image rebuild.
- **Credential helper via git config**: `git config --global credential.helper '!f() { ... }; f'` — no image changes needed.

## Next Actions

- [ ] Wire post-run push into `createGatewayExecution()` — after agent session, check for commits, push if any
- [ ] Automate workspace git remote setup (currently manual — agent must run 2 commands from AGENTS.md)
- [ ] Consider adding `gh` CLI to `cogni-sandbox-openclaw` Dockerfile for richer GitHub integration
- [ ] Update `task.0022` work item status and plan checkboxes to reflect pivot
- [ ] Manual smoke test: restart stack → verify `docker exec openclaw-gateway curl https://api.github.com/rate_limit` works

## Risks / Gotchas

- **Agent must set up git remote manually**: `/workspace/current` origin points to local `/repo/current` (git-sync mirror). Agent needs `git remote set-url origin "$COGNI_REPO_URL"` + credential helper. Commands are in root `AGENTS.md`.
- **Leaked PAT found and removed**: A real `github_pat_*` token was in `.env.local.example` working tree. Removed but should be rotated.
- **git-sync shallow clone**: `/repo/current/.git` is a file (worktree), not a directory. Use `git rev-parse`, not `test -d .git`.
- **No branch protection in code**: Agent can push to any branch. Rely on GitHub branch protection rules for safety.

## Pointers

| File / Resource                                          | Why it matters                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `platform/infra/services/runtime/docker-compose.dev.yml` | Gateway network + env config (cogni-edge, GITHUB_TOKEN, COGNI_REPO_URL) |
| `platform/infra/services/runtime/docker-compose.yml`     | Prod equivalent                                                         |
| `services/sandbox-openclaw/openclaw-gateway.json`        | Tool deny list (group:web removed)                                      |
| `docs/spec/openclaw-sandbox-spec.md`                     | Invariant 21 (GATEWAY_NETWORK_ACCESS), tool table, workspace templates  |
| `docs/spec/openclaw-sandbox-controls.md`                 | Credential strategy, anti-patterns, relay rationale                     |
| `src/adapters/server/sandbox/sandbox-graph.provider.ts`  | Where post-run push wiring goes                                         |
| `src/shared/env/server.ts`                               | `OPENCLAW_GITHUB_RW_TOKEN` Zod schema                                   |
| `AGENTS.md`                                              | Git remote setup commands (bottom of file)                              |
