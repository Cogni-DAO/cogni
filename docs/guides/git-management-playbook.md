---
id: git-management-playbook
type: guide
title: "Git Management Playbook — Operational Guide for the Git Manager Agent"
status: draft
trust: draft
summary: Evolving operational playbook for the Git Manager orchestrator agent. Contains escalation rules, integration branch edge cases, and schedule hygiene. The agent reads this on demand, not at startup.
read_when: You are the Git Manager agent encountering an edge case, or you are updating git management policy.
owner: derekg1729
created: 2026-04-06
verified:
tags: [agents, git-manager, playbook, vcs, orchestration]
---

# Git Management Playbook

> This playbook is read by the Git Manager agent **on demand** when encountering situations not covered by its system prompt. Update it via PR when patterns emerge.

## Escalation Rules

| Situation                                                | Action                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| CI fails on lockfile mismatch                            | Flag: "needs human fix — lockfile mismatch"                           |
| CI fails on test                                         | Flag: "needs author — test failure in [check name]"                   |
| CI stuck > 1 hour                                        | Flag: "CI may be hung — check [check name]"                           |
| Merge conflict on integration branch                     | Flag: "needs rebase — merge conflict"                                 |
| PR approved but CI pending > 2 hours                     | Flag: "CI delayed — investigate"                                      |
| Sub-PR merged directly to canary (bypassing integration) | Flag: "integration branch bypassed — needs coordination"              |
| Schedule fails repeatedly                                | Disable schedule, flag: "schedule [id] failing — needs investigation" |
| You're unsure about any action                           | Skip. A missed cycle is harmless. Report the uncertainty.             |

## Integration Branch Edge Cases

These operations **require a human** — the agent cannot perform them via current tools:

### Cherry-Pick Commits

When commits exist on one branch and need to move to another:

- Flag: "commits [SHAs] need cherry-pick from [source] to [target]"
- Provide the exact SHAs and target branch in the report

### Rescue Direct Commits

When commits were accidentally made directly to an integration branch:

- Flag: "direct commits detected on [branch] — needs rescue to sub-branch"
- List the commit SHAs and suggest a sub-branch name

### Conflict Resolution

When a sub-PR has merge conflicts with the integration branch:

- Flag: "PR #N has conflicts with [integration branch] — needs manual rebase"

### Force-Push Required

When the integration branch needs history cleanup:

- Flag: "integration branch [name] needs force-push — requires human"
- Never attempt force-push via tools

## Schedule Hygiene

- **Disable completed schedules**: After a coding agent finishes a work item, disable its schedule
- **Clean up dead schedules**: Schedules with no successful run in > 48h should be investigated
- **One schedule per work item**: Don't create duplicate schedules for the same work item
- **Check before creating**: Always call core\_\_schedule_list before creating a new schedule

## Data Streams Architecture

The Git Manager sits at the consumer end of the VCS data pipeline:

```
GitHub API → VCS PollAdapter → Temporal → streams:vcs:github (Redis)
                                        → node:{nodeId}:events (SSE summary)
```

Current state (see work/charters/DATA_STREAMS.md for scorecard):

- GitHub poll adapter: 30% maturity (Postgres ingestion, no Redis stream yet)
- GitHub webhooks: 30% maturity (normalized, no Redis stream yet)
- Agent stream access tool (core\_\_node_stream_read): not built yet (task.0297)

When stream tools ship, the agent gains real-time awareness without prompt changes.

## Patterns Log

> Record recurring patterns here so the playbook evolves. Format: date, pattern, resolution.

_No patterns logged yet. This section will grow as the agent operates._
