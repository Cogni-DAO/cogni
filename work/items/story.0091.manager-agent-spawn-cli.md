---
id: story.0091
type: story
title: Clawdbot as High-Level Manager Agent
status: needs_triage
priority: 1
rank: 99
estimate: 5
summary: Transform clawdbot into a high-level manager agent that delegates all coding and design work to spawned CLI agents (Claude Code, Codex), maintaining zero codebase awareness itself.
outcome: Clawdbot operates purely as an orchestrator, spawning specialized coding agents via CLI to perform all implementation work while remaining completely isolated from the codebase.
spec_refs:
assignees: derekg1729
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-24
updated: 2026-02-24
labels: [architecture, agents, automation]
external_refs:
  - https://x.com/elvissun/status/2025920521871716562?s=46
---

# Clawdbot as High-Level Manager Agent

## Requirements

<!-- What must be true when this is done? Be specific. -->

- Clawdbot maintains zero awareness of the codebase (no file reads, no code context)
- All coding tasks are delegated by spawning Claude Code or Codex via CLI
- All design/architecture decisions are delegated to spawned agents
- Clawdbot acts purely as an orchestrator/manager, defining _what_ needs to happen
- Spawned agents receive clear task definitions and return results
- Manager agent can chain multiple spawned agent calls to complete complex workflows
- Proper error handling when spawned agents fail or return unexpected results

## Allowed Changes

<!-- What files/areas may this item touch? Scope boundaries. -->

- Agent orchestration layer
- CLI spawning interfaces
- Task definition schemas
- Agent communication protocols
- Workflow编排逻辑

## Plan

<!-- Step-by-step execution plan. -->

- [ ] Design task definition format for passing context to spawned agents
- [ ] Implement CLI spawning interface for Claude Code
- [ ] Implement CLI spawning interface for Codex
- [ ] Create agent result aggregation and error handling logic
- [ ] Define manager agent workflow patterns (sequential, parallel, conditional)
- [ ] Migrate existing clawdbot capabilities to use spawned agents
- [ ] Document agent orchestration patterns and best practices

## Validation

<!-- Name exact commands/tests and expected outcome. -->

**Command:**

```bash
pnpm test agents/spawn-manager.test.ts
```

**Expected:** All tests pass, demonstrating manager agent spawning sub-agents and aggregating results.

## Review Checklist

<!-- All required before status=done. -->

- [ ] **Work Item:** `story.0091` linked in PR body
- [ ] **Spec:** all invariants of linked specs (here, or project) are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

<!-- PR URL and any related links. -->

- Source tweet: https://x.com/elvissun/status/2025920521871716562?s=46

## Attribution

<!-- Credit contributors. -->

- Idea: Derek (via Elvis Sun tweet)
