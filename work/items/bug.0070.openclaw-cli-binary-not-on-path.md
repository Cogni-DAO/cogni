---
id: bug.0070
type: bug
title: "OpenClaw CLI binary not executable as `openclaw` — agent CLI commands fail"
status: needs_triage
priority: 1
estimate: 1
summary: "OpenClaw container image ships the CLI as `/app/openclaw.mjs` but no `openclaw` command exists on PATH. The gateway agent's injected system prompt references `openclaw status`, `openclaw gateway status`, etc., which all fail with `sh: 1: openclaw: not found`."
outcome: "Agent can run `openclaw <command>` inside the gateway container and get valid output."
spec_refs:
  - openclaw-sandbox-spec
assignees: derekg1729
credit:
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-16
updated: 2026-02-16
labels: [openclaw, cli, upstream]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 6
---

# bug.0070 — OpenClaw CLI binary not executable as `openclaw`

## Requirements

### Observed

- OpenClaw v2026.2.6-3 container image has CLI entry point at `/app/openclaw.mjs` (shebang `#!/usr/bin/env node`)
- No symlink or wrapper named `openclaw` exists anywhere on PATH
- `/app` is not on container PATH (`PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`)
- The gateway agent's system prompt includes `## OpenClaw CLI Quick Reference` with commands like `openclaw status`, `openclaw gateway status`
- Agent attempts these commands → `sh: 1: openclaw: not found`
- Container filesystem is read-only — cannot create symlinks at runtime without entrypoint hacks

### Expected

- `openclaw` command should be available on PATH inside the container, so the agent can use CLI commands referenced in its own system prompt

### Reproduction

```bash
docker exec openclaw-gateway which openclaw
# → not found

docker exec openclaw-gateway openclaw --version
# → sh: 1: openclaw: not found

docker exec openclaw-gateway openclaw.mjs --version
# → also not found (unless /app is on PATH)

docker exec openclaw-gateway node /app/openclaw.mjs --version
# → 2026.2.6-3 (works)
```

### Impact

- Gateway agent wastes tokens attempting CLI commands that always fail
- Agent cannot self-inspect (e.g. `openclaw status`, `openclaw doctor`)
- Workaround of adding `PATH=/app:...` to docker-compose env only makes `openclaw.mjs` available, not `openclaw`

## Allowed Changes

- **Upstream (preferred):** OpenClaw Dockerfile — add `RUN ln -s /app/openclaw.mjs /usr/local/bin/openclaw` or equivalent
- **Downstream (interim):** Custom entrypoint script that creates the symlink before exec, or SOUL.md instruction to use `node /app/openclaw.mjs` instead of `openclaw`

## Plan

- [ ] File upstream issue/PR on OpenClaw repo to create `/usr/local/bin/openclaw` symlink in Dockerfile
- [ ] Alternatively, if task.0057 lands first (prompt section toggles), disable CLI Reference section entirely

## Validation

**Command:**

```bash
docker exec openclaw-gateway openclaw --version
```

**Expected:** Returns version string (e.g. `2026.2.6-3`).

## Review Checklist

- [ ] **Work Item:** `bug.0070` linked in PR body
- [ ] **Spec:** openclaw-sandbox-spec invariants upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: task.0057 (upstream prompt section toggles — alternative fix path)
- Related: task.0023 (gateway agent system prompt work)

## Attribution

-
