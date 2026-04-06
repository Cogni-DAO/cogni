---
id: story.0262
type: story
title: "Agent contributor protocol — shared workflow for AI agents coordinating on a codebase"
status: done
priority: 1
rank: 99
estimate: 5
summary: "Define and implement a protocol for multiple AI coding agents (Claude Code, Codex, Cogni operator review agent) to coordinate work on a shared codebase — claim tasks, submit work, request reviews, receive feedback, and hand off — without a human relaying messages between them."
outcome: "A developer launches N agents on different tasks. Each agent follows a contributor workflow (claim → branch → implement → submit → await review). The review agent receives submissions via webhook/event, reviews, and posts feedback. Agents can check review status without the human shuttling context."
spec_refs: []
assignees: derekg1729
credit:
project: proj.development-workflows
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-02
updated: 2026-04-02
labels: [infrastructure, agents, protocol, dx]
external_refs:
---

# Agent contributor protocol — shared workflow for AI agents coordinating on a codebase

## Problem

Today, coordinating multiple AI agents on the same codebase requires a human to:

1. Launch agent A on task X, agent B on task Y, agent C reviewing
2. Manually copy agent A's output ("PR ready") to agent C ("please review this branch")
3. Copy agent C's review feedback back to agent A ("fix these issues")
4. Track which agents are waiting, which are blocked, which are done

This worked for 1-2 agents. At 3+ concurrent agents (the task.0248 extraction had 3 devs + 1 reviewer), the human becomes the bottleneck. The agents have no way to signal each other.

## Who benefits

- **Cogni operators** running multi-agent development workflows
- **External contributors** whose Claude Code / Codex agents submit PRs to a Cogni repo
- **The Cogni review agent** (operator AI) which currently only triggers via GitHub webhooks on human-created PRs

## Requirements

### Core protocol: contributor workflow states

Every agent working on a codebase follows this state machine:

```
idle → claimed → implementing → submitted → in_review → (approved | changes_requested) → done
```

- **claim(task_id)** — agent announces it's working on a task. Prevents double-assignment.
- **submit(branch, summary)** — agent signals work is ready for review. Includes branch name and a structured summary (files changed, tests run, invariants checked).
- **check_status(task_id)** — agent polls for review result without blocking.
- **receive_feedback(task_id)** — agent gets structured review feedback (blocking issues, suggestions).

### Communication mechanism

Agents need a way to publish and subscribe to task state changes. Options to evaluate:

- **Git-native**: status written to a well-known file (`work/items/<id>.md` frontmatter `status` field) + branch conventions. Agents poll via `git fetch`. Lowest infrastructure, highest latency.
- **GitHub-native**: PR comments, PR labels, check runs. Review agent already uses webhooks. Agents use `gh` CLI. Medium infrastructure, medium latency.
- **Event bus**: Redis pub/sub, GitHub Actions workflow_dispatch, or a lightweight webhook relay. Lowest latency, highest infrastructure.

### External agent onboarding

An external contributor's Claude Code agent should be able to:

1. Read the repo's `CLAUDE.md` and understand the contributor workflow
2. Claim a task from `work/items/` (or be assigned one)
3. Follow the protocol without custom tooling beyond `gh` CLI
4. Submit work and receive review feedback through the same protocol

### Integration with Cogni operator review agent

The operator's AI review agent (story.0091, VCS tool plane from task.0242) already reviews PRs via GitHub webhooks. The protocol should:

- Trigger review when an agent submits (not just when a human creates a PR)
- Post structured feedback that another agent can parse (not just prose comments)
- Support approval → auto-merge for trusted internal agents (with human override)

## Allowed Changes

- `work/` — protocol spec, contributor workflow docs
- `docs/spec/` — agent-contributor-protocol spec
- `.cogni/` — contributor workflow config
- `scripts/` — CLI tooling for protocol operations
- `CLAUDE.md` — contributor workflow instructions for external agents
- `packages/` — potential `@cogni/contributor-protocol` package if warranted

## Plan

High-level only — decomposition into tasks happens after triage + spike.

- [ ] Spike: evaluate communication mechanisms (git-native vs GitHub-native vs event bus)
- [ ] Define protocol spec with state machine, message formats, error handling
- [ ] Implement MVP with GitHub-native approach (PR labels + comments + `gh` CLI)
- [ ] Add structured review feedback format (JSON in PR comments or check run output)
- [ ] Document contributor workflow in CLAUDE.md for external agents
- [ ] Wire Cogni review agent to accept agent-submitted PRs
- [ ] Test with 3+ concurrent agents on a real multi-task workflow

## Validation

- 3 agents work concurrently on different tasks, submit PRs, receive reviews, and iterate — without human relaying messages
- External agent (fresh Claude Code session with only repo access) can follow the workflow from CLAUDE.md
- Review latency: agent submits → review feedback available < 5 minutes

## Review Checklist

- [ ] **Work Item:** story.0262 linked in PR body
- [ ] **Spec:** protocol spec written and reviewed
- [ ] **Tests:** integration test with mock agents following the protocol
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: story.0091 (manager agent), task.0242 (VCS tool plane + PR Manager agent)
- Inspiration: the task.0248 extraction session where 3 dev agents + 1 reviewer needed human message relay

## Attribution

- derekg1729 (problem identification from multi-agent coordination pain)
