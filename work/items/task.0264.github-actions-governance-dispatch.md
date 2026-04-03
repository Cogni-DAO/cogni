---
id: task.0264
type: task
title: Implement GitHub Actions governance dispatch workflow for multi-agent coordination
status: needs_triage
priority: 1
rank: 99
estimate: 3
summary: Create a GitHub Actions workflow that selects the next work item by priority/status weight, claims it for an agent, invokes the agent (Claude Code remote trigger or Codex API), and handles the result.
outcome: Governance dispatch runs as a GitHub Action, selecting tasks, invoking agents, and updating work item status — no human relay needed.
spec_refs:
  - development-lifecycle
project: proj.development-workflows
assignees:
  - cogni-dev
credit:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-02
updated: 2026-04-02
labels: [agents, workflow, ci, automation]
external_refs:
  - docs/research/agent-contributor-protocol.md
---

# GitHub Actions Governance Dispatch Workflow

## Requirements

- GitHub Actions workflow selects next dispatchable work item by priority and status weight
- Workflow claims the task for the assigned agent (atomic via GitHub API)
- Workflow invokes the appropriate agent (Claude Code remote trigger, Codex API, or custom)
- On agent completion, workflow updates work item frontmatter status
- Stale claim detection: revoke claims older than configurable timeout
- Supports both manual trigger (workflow_dispatch) and scheduled trigger (cron)

## Allowed Changes

- `.github/workflows/` — new governance dispatch workflow
- `scripts/` — helper scripts for task selection and claiming
- `work/items/` — this task item

## Plan

- [ ] Define task selection query logic (parse frontmatter, sort by weight)
- [ ] Implement atomic claim via GitHub issue assignment API
- [ ] Implement agent invocation (Claude Code remote trigger wrapper)
- [ ] Implement agent invocation (Codex API wrapper)
- [ ] Handle completion: update frontmatter, push, trigger next step
- [ ] Add stale claim timeout detection and revocation
- [ ] Add workflow_dispatch inputs for manual override
- [ ] Test with dry-run mode (select + claim without invoking agent)

## Validation

**Command:**

```bash
# Dry-run: verify task selection and claiming logic
act -j governance-dispatch --input dry_run=true
```

**Expected:** Workflow selects highest-priority dispatchable task and logs the claim without invoking an agent.

## Review Checklist

- [ ] **Work Item:** `task.0264` linked in PR body
- [ ] **Spec:** aligns with development-lifecycle.md dispatch model
- [ ] **Tests:** dry-run mode validates selection logic
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Research: [docs/research/agent-contributor-protocol.md](../../docs/research/agent-contributor-protocol.md)
- Parent story: [story.0262](story.0262.agent-contributor-protocol.md)

## Attribution

-
