---
id: spike.0266
type: spike
title: "Research: Agent invocation patterns — Claude Code remote trigger, Codex API, unattended execution"
status: needs_triage
priority: 1
rank: 99
estimate: 1
summary: Evaluate how to invoke AI coding agents (Claude Code, Codex, custom) programmatically for unattended task execution — remote trigger APIs, sandboxing, result collection, and failure handling.
outcome: Research document with invocation patterns for each agent type, failure modes, and integration recommendations for the governance dispatch workflow.
spec_refs:
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
labels: [agents, workflow, research, automation]
external_refs:
  - docs/research/agent-contributor-protocol.md
---

# Research: Agent Invocation Patterns

## Question

How do we programmatically invoke Claude Code, Codex, and custom agents for unattended task execution? What are the APIs, sandboxing models, result collection mechanisms, and failure modes for each?

## Requirements

- Evaluate Claude Code remote trigger / scheduled agents API
- Evaluate OpenAI Codex task submission API
- Evaluate OpenClaw agent invocation for custom agents
- Document failure modes (timeout, crash, partial work, cost overrun)
- Recommend invocation strategy for the governance dispatch workflow (task.0264)

## Allowed Changes

- `docs/research/` — research output document
- `work/items/` — this spike item

## Plan

- [ ] Research Claude Code remote trigger API and constraints
- [ ] Research Codex task queue API and constraints
- [ ] Research OpenClaw agent invocation patterns
- [ ] Document failure modes and recovery strategies
- [ ] Recommend invocation wrappers for governance dispatch

## Validation

**Command:**

```bash
pnpm check:docs
```

**Expected:** Research doc passes validation.

## Review Checklist

- [ ] **Work Item:** `spike.0266` linked to research doc
- [ ] **Spec:** invocation patterns documented for all agent types
- [ ] **Tests:** N/A (research spike)
- [ ] **Reviewer:** TBD

## PR / Links

- Research: TBD (output of this spike)
- Parent story: [story.0262](story.0262.agent-contributor-protocol.md)

## Attribution

-
