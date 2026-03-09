---
id: task.0022
type: task
title: "Git publish relay: credential isolation + agent-triggered host push"
status: needs_design
priority: 0
estimate: 2
summary: Remove GITHUB_TOKEN from gateway container, add host-side HTTP publish endpoint that agent curls when ready. Agent reads from file:///repo, commits locally, host extracts patches via docker exec and pushes with GIT_ASKPASS.
outcome: Agent can commit and publish code changes without ever seeing git credentials. Credentials stay host-only per inv. 4 (SECRETS_HOST_ONLY) and inv. 20 (HOST_SIDE_GIT_RELAY).
spec_refs: openclaw-sandbox-controls-spec, openclaw-sandbox-spec
assignees: derekg1729
credit:
project: proj.openclaw-capabilities
branch: feat/task-0022-git-relay-mvp
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-13
labels: [openclaw, sandbox, git-relay, security]
external_refs:
  - docs/research/sandbox-git-write-permissions.md
revision: 0
blocked_by:
deploy_verified: false
rank: 15
---

# Git publish relay: credential isolation + agent-triggered host push

## Context

The gateway container currently has `GITHUB_TOKEN` in its env and AGENTS.md tells the agent to echo it via a credential helper. This means the agent can leak the token via `echo $GITHUB_TOKEN`, `env`, `printenv`, or prompt injection. It also pushes arbitrary commits with no host-side review or branch allowlist. This violates inv. 4 (SECRETS_HOST_ONLY) and inv. 20 (HOST_SIDE_GIT_RELAY).

The previous git relay (deleted in ec9311af) used docker exec + git bundle — correct principle but overly complex. This task restores credential isolation with a simpler architecture: the agent curls a host-side publish endpoint when ready.

## Requirements

- `GITHUB_TOKEN` is NOT in the gateway container's environment — `docker exec openclaw-gateway env` must not show it
- Credential helper removed from AGENTS.md — no `echo "password=$GITHUB_TOKEN"` pattern
- Agent reads repo content via `file:///repo` git remote (the existing `repo_data:/repo:ro` volume)
- Agent commits locally (git is already installed, git author/committer env vars stay)
- Agent triggers publish explicitly: `curl -s -X POST "$PUBLISH_URL"`
- Host-side publish endpoint extracts patches via `docker exec git format-patch --stdout`, applies in temp clone, pushes with `GIT_ASKPASS` (token never in URL, logs, or process list)
- Pushed branches must match `sandbox/*` prefix
- Endpoint returns `{ ok, branch, commitCount }` or `{ ok: false, error }`
- No PR creation (deferred)
- No pre-run workspace setup (agent uses existing workspace)
- No post-run lifecycle hooks — publish is agent-initiated only

## Allowed Changes

- `src/adapters/server/sandbox/git-relay.ts` (new) — GitRelay class with `publish()` method
- `src/adapters/server/sandbox/index.ts` — re-export GitRelay
- `src/app/api/internal/sandbox/publish/route.ts` (new) — HTTP endpoint
- `platform/infra/services/runtime/docker-compose.dev.yml` — gateway env changes
- `AGENTS.md` — replace credential helper section
- `docs/spec/openclaw-sandbox-controls.md` — update credential strategy / inv. 20

## Plan

- [ ] Create `src/adapters/server/sandbox/git-relay.ts`:
  - `publish({ containerName, workspacePath, baseRef, repoUrl, token })` → `{ branch, commitCount } | null`
  - `docker exec git log --oneline <baseRef>..HEAD` — check for commits, return null if none
  - `docker exec git rev-parse --abbrev-ref HEAD` — get branch, validate `sandbox/*` prefix
  - `docker exec git format-patch --stdout <baseRef>..HEAD` — extract patches to stdout
  - `mkdtemp` → `git clone --depth=1` → `git checkout -b <branch>` → `git am` → push via `GIT_ASKPASS`
  - `rmSync` cleanup of temp dir
- [ ] Create `src/app/api/internal/sandbox/publish/route.ts`:
  - POST handler, follows existing pattern in `src/app/api/internal/graphs/[graphId]/runs/route.ts`
  - No auth for MVP (network-level isolation, only pushes to `sandbox/*`)
  - Creates Dockerode + GitRelay, reads `GITHUB_TOKEN` + `COGNI_REPO_URL` from `serverEnv()`
  - Container name: `openclaw-gateway`, workspace: `/workspace/current`
- [ ] Update `src/adapters/server/sandbox/index.ts` — export GitRelay
- [ ] Update `docker-compose.dev.yml`:
  - Remove `GITHUB_TOKEN=${OPENCLAW_GITHUB_RW_TOKEN...}` from gateway env
  - Add `PUBLISH_URL=http://host.docker.internal:3000/api/internal/sandbox/publish`
- [ ] Update `AGENTS.md` lines 130-142:
  - Remove credential helper, add: `git remote set-url origin file:///repo`, commit locally, `curl -s -X POST "$PUBLISH_URL"` when ready
- [ ] Update `docs/spec/openclaw-sandbox-controls.md` — restore inv. 20 narrative

## Non-Goals (deferred)

- PR creation via GitHub API
- Auth on publish endpoint (add when moving to production)
- Pre-run workspace bootstrap / branch reset
- `gh` CLI in container
- Branch cleanup after publish
- Concurrent run isolation (gateway is single-instance for now)

## Validation

**Command:**

```bash
pnpm check
```

**Expected:** Lint + type + format clean, all tests pass.

**Manual smoke test:**

1. Start `pnpm dev:stack` with sandbox profile
2. Verify: `docker exec openclaw-gateway env | grep GITHUB` returns nothing
3. Talk to agent, ask it to create a file, commit, and publish
4. Agent runs `curl -s -X POST "$PUBLISH_URL"`
5. Verify: branch `sandbox/*` pushed to GitHub, endpoint returns `{ ok: true, branch, commitCount }`

**Negative test:**

- Agent tries `git push` directly → fails (no credentials)
- Agent tries `echo $GITHUB_TOKEN` → empty

## Review Checklist

- [ ] **Work Item:** task.0022 linked in PR body
- [ ] **Spec:** SECRETS_HOST_ONLY (inv. 4), HOST_SIDE_GIT_RELAY (inv. 20) upheld
- [ ] **Tests:** `pnpm check` passes
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/task.0022.handoff.md)

## Attribution

-
