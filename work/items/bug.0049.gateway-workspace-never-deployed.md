---
id: bug.0049
type: bug
title: Deploy never syncs gateway-workspace + repo mount blocks git — agent is blind and immobile
status: done
priority: 0
estimate: 1
summary: deploy.sh rsync's gateway-workspace/ to production; agent docs updated with safe clone-from-remote dev workflow; /repo/current/ documented as volatile
outcome: Gateway agent boots with full workspace files; dev workflow uses persistent clone at /workspace/repo/ instead of volatile /repo/current/
spec_refs:
  - openclaw-workspace
assignees: []
credit:
project: proj.openclaw-capabilities
branch: fix/bug-0049-gateway-workspace-deploy
pr:
reviewer:
created: 2026-02-13
updated: 2026-02-13
labels: [deploy, openclaw, P0]
external_refs:
  - https://github.com/Cogni-DAO/node-template/pull/400
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Deploy never syncs gateway-workspace + repo mount blocks git — agent is blind and immobile

## Observed

PR #400 (`feat(gov)`) merged and deployed successfully. The gateway agent in production:

1. Did not recognize the `GOVERN` command (should trigger governance checklist from GOVERN.md)
2. Responded with `HEARTBEAT_OK` to unrecognized input instead of using SOUL.md personality
3. Reported "none of these files are present" when asked about SOUL.md, GOVERN.md, etc.
4. Could not `git pull` its own repo (`/repo` is mounted `:ro`)

**Root cause — two issues, both in scope:**

### Issue 1: gateway-workspace never rsync'd

`deploy.sh:805-809` only copies the JSON config:

```bash
scp ... openclaw-gateway.json ... /opt/cogni-template-runtime/openclaw/openclaw-gateway.json
```

The `services/sandbox-openclaw/gateway-workspace/` directory (SOUL.md, GOVERN.md, AGENTS.md, TOOLS.md, MEMORY.md) is **never deployed**. The string `gateway-workspace` does not appear anywhere in `deploy.sh`.

Docker-compose expects it at `./openclaw/gateway-workspace` (`docker-compose.yml:466`), but since the dir doesn't exist on the host, Docker creates an **empty directory** at the mount point. The agent has been running with zero workspace files.

The dev compose correctly references the repo source via relative path (`docker-compose.dev.yml:565`):

```yaml
- ../../../../services/sandbox-openclaw/gateway-workspace:/workspace/gateway
```

### Issue 2: /repo mounted :ro — documented dev workflow is broken

`/repo` is mounted `:ro` (`docker-compose.yml:467`). The agent's own AGENTS.md documents this dev workflow:

```bash
git -C /repo/current worktree add /workspace/dev-<branch> -b <branch>
```

This **cannot work** because `git worktree add` writes to `/repo/current/.git/worktrees/`. The `:ro` mount makes the agent's documented development workflow impossible. The agent also cannot `git fetch` to update its codebase view.

The app container (`docker-compose.yml:74`) should stay `:ro` — it's a web server. But the openclaw-gateway is a developer agent that needs write access to git.

### Out of scope: hash-gated restart (task.0024)

Config-only deploys won't restart the container. Tracked by task.0024 (deploy config reconciliation). Until then, workspace-only changes require manual `docker compose restart openclaw-gateway` after deploy.

## Expected

- After deploy, gateway-workspace files are present at `/opt/cogni-template-runtime/openclaw/gateway-workspace/`
- Agent operates with SOUL.md personality and responds to GOVERN
- Agent can create worktrees, fetch, and push per its documented workflow

## Reproduction

1. Deploy to production (current state reproduces)
2. Send `GOVERN` to the gateway agent → agent doesn't recognize it (workspace empty)
3. Ask agent to create a worktree → fails (`:ro` mount)

## Impact

- **P0**: Gateway agent has NO personality, NO governance loop, NO dev capability. PR #398/#400 features are dead on arrival.
- All future workspace file changes will silently fail to deploy.
- Agent cannot follow its own documented git workflow.

## Requirements

- `deploy.sh` rsync's `services/sandbox-openclaw/gateway-workspace/` to `/opt/cogni-template-runtime/openclaw/gateway-workspace/`
- `docker-compose.yml:467` changes `repo_data:/repo:ro` to `repo_data:/repo` for openclaw-gateway
- After fix: GOVERN works, agent can create worktrees and git fetch

## Allowed Changes

- `platform/ci/scripts/deploy.sh` — add rsync step for gateway-workspace
- `platform/infra/services/runtime/docker-compose.yml` — remove `:ro` from openclaw-gateway repo mount

## Plan

- [ ] Add rsync of `services/sandbox-openclaw/gateway-workspace/` to deploy.sh (after line 809)
- [ ] Remove `:ro` from `repo_data:/repo:ro` on openclaw-gateway (`docker-compose.yml:467`)
- [ ] Test: deploy, verify workspace files present, verify `git -C /repo/current worktree add` works

## Validation

**Command:**

```bash
# After deploy, SSH to VM and verify:
ls /opt/cogni-template-runtime/openclaw/gateway-workspace/
# Expected: SOUL.md, GOVERN.md, AGENTS.md, TOOLS.md, MEMORY.md

# In gateway chat:
# Send: GOVERN
# Expected: Agent responds with EDO checklist

# Verify git works:
# Agent runs: git -C /repo/current worktree add /workspace/dev-test -b test
# Expected: worktree created successfully
```

**Expected:** Workspace files present; GOVERN works; git worktrees work.

## Review Checklist

- [ ] **Work Item:** `bug.0049` linked in PR body
- [ ] **Spec:** openclaw-workspace invariants (GOVERN_TRIGGER, USER_MODE_PRIORITIES) upheld
- [ ] **Tests:** deploy tested on staging or production
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Triggered by: https://github.com/Cogni-DAO/node-template/pull/400 (governance feature, deployed but inert)
- Related: task.0023 (gateway workspace setup), task.0024 (hash-gated config restarts)

## Attribution

- Investigation: Claude Code
