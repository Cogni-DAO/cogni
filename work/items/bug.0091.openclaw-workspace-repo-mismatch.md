---
id: bug.0091
type: bug
title: "OpenClaw workspace path ≠ git repo path causes agent CWD mismatch"
status: needs_triage
priority:
rank:
estimate:
summary: OpenClaw ties SOUL.md location to agent CWD, but agents need to work in a separate git worktree — forcing a fragile `cd` on every message.
outcome: Development agent starts in its git worktree without manual `cd` or symlink hacks.
spec_refs:
assignees: derekg1729
credit:
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-19
updated: 2026-02-19
labels: [openclaw, dx, infra]
external_refs:
---

# OpenClaw workspace path ≠ git repo path causes agent CWD mismatch

## Requirements

- The development agent's CWD must be its git worktree (`/workspace/dev-repo/`) when it starts processing a message.
- The agent should not need to know about or compensate for OpenClaw workspace internals.
- SOUL.md (and other bootstrap files) must still be discoverable by OpenClaw.

## Problem

OpenClaw uses a single `workspace` field per agent that serves double duty:

1. **Where to find SOUL.md** — the agent's personality/instructions
2. **The agent's CWD** — where shell commands execute

For agents that work in a git repo, these are different paths:

- SOUL.md lives on a persistent volume mount: `/workspace/gateway/development/SOUL.md`
- The git worktree lives at: `/workspace/dev-repo/` (branch `gov/development`)

**Current workaround:** The SOUL.md's first step is `cd /workspace/dev-repo`. This is fragile:

- If `cd` fails silently, the agent works in the wrong directory and hallucinates "empty repo"
- Every skill/subagent inherits the wrong CWD unless it also `cd`s
- The agent leaks infrastructure knowledge into its prompt

**Evaluated alternatives:**

| Approach                                   | Problem                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Set `workspace: /workspace/dev-repo`       | OpenClaw can't find SOUL.md                                                                        |
| Symlink SOUL.md into worktree at bootstrap | Worktree is ephemeral; symlinks lost on recreate; BOOTSTRAP.md is agent-interpreted, not automated |
| Separate `soulPath` vs `cwd` config        | Not available in OpenClaw's config surface                                                         |

## Allowed Changes

- OpenClaw config schema (upstream)
- Container entrypoint / init scripts
- BOOTSTRAP.md automation
- Docker compose service definition

## Plan

- [ ] Investigate if OpenClaw supports (or could support) separate `soulPath` / `cwd` fields
- [ ] Alternatively: automate symlink creation in a container entrypoint script (not BOOTSTRAP.md)
- [ ] Remove `cd /workspace/dev-repo` from SOUL.md once the root cause is fixed

## Validation

**Command:**

```bash
# After fix: agent should report correct CWD without any cd in SOUL.md
docker exec openclaw-gateway pwd
# Should show the git worktree path, not the SOUL.md directory
```

**Expected:** Development agent operates in `/workspace/dev-repo/` by default.

## Review Checklist

- [ ] **Work Item:** `bug.0091` linked in PR body
- [ ] **Spec:** OpenClaw workspace contract documented
- [ ] **Tests:** agent starts in correct CWD without manual cd
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
