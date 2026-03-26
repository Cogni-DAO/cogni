---
id: proj.agent-workforce
type: project
primary_charter: ENGINEERING
title: Agent Workforce — Playbook-Driven Role Architecture
state: Active
priority: 0
estimate: 5
summary: "Generalize the mission-control operator loop into a multi-role agent workforce with typed RoleDefinitions, queue-filtered dispatch, and playbook-driven execution"
outcome: "Multiple AI agents run concurrently on independent schedules, each scoped to a typed Role (CEO, Git Reviewer, PM, Data Analyst). Roles filter work queues, map statuses to skills, and enforce policies. Playbook quality drives agent quality. Dashboard reads persisted snapshots."
assignees:
  - derekg1729
created: 2026-03-26
updated: 2026-03-26
labels: [agents, governance, workforce, mission-control]
---

# Agent Workforce — Playbook-Driven Role Architecture

## Goal

Evolve the single-agent mission-control operator loop (task.0162) into a multi-role agent workforce. Each role is a typed configuration binding an agent to a filtered work queue, a set of playbooks (skills), and an execution policy. The existing infrastructure (WorkItemPort, skills, Temporal schedules, OpenClaw gateway) remains unchanged — roles are a configuration layer on top.

## Context

### What exists

- **mc-controller.ts** (task.0162): Deterministic observe→gate→pick→snapshot→output loop for CEO agent
- **WorkItemPort** (proj.agentic-project-management): Typed work item CRUD with query filtering
- **Skills** (.openclaw/skills/): 40+ SKILL.md playbooks mapping to lifecycle statuses
- **Temporal schedules**: HEARTBEAT fires hourly, triggers the operator loop
- **OpenClaw gateway**: Agent runtime with SOUL.md persona, model routing, Discord reporting
- **AgentSnapshot**: Persisted JSON state after every controller run

### What's missing

1. **Multiple agents** — only one heartbeat loop exists, processing one global queue
2. **Queue scoping** — no way to say "this agent only handles PRs" or "this agent only triages"
3. **Role-specific policies** — all items share the same status weights and tier rules
4. **Escalation** — stale items rot silently (PR #562 sat for 2 weeks)
5. **Outcome ownership** — the review agent comments but doesn't drive to merge/reject

## As-Built Specs

- [Agent Roles](../../docs/spec/agent-roles.md) — Role abstraction, type definitions, starter roles, invariants

## Roadmap

### Crawl (P0) — Generalize Controller + Git Reviewer Role

**Goal:** mc-controller.ts accepts `--role <id>`. Two roles defined in code: CEO (existing logic, renamed) and Git Reviewer (new, scoped to `needs_merge`).

| Deliverable                                                                          | Status      | Est | Work Item |
| ------------------------------------------------------------------------------------ | ----------- | --- | --------- |
| Extract `RoleDefinition`, `WorkQueueFilter`, `PlaybookMap`, `RolePolicy` Zod schemas | Not Started | 1   | task.0207 |
| Refactor mc-controller.ts to accept `--role <id>` parameter                          | Not Started | 1   | task.0207 |
| Define `CEO_ROLE` constant (rename existing hardcoded logic)                         | Not Started | 0.5 | task.0207 |
| Define `GIT_REVIEWER_ROLE` constant (filter: `needs_merge` only)                     | Not Started | 0.5 | task.0207 |
| Add `roles` field to repo-spec.yaml schedule entries                                 | Not Started | 0.5 | task.0207 |
| Add Git Reviewer schedule to repo-spec.yaml (cron: every 4h)                         | Not Started | 0.5 | task.0207 |
| Enhance `/review-implementation` skill for outcome ownership (fix CI, merge/reject)  | Not Started | 2   | task.0208 |

### Walk (P1) — Feedback Loop + PM/Analyst Roles + Dashboard

**Goal:** Playbook outcome logging, two additional roles, role-specific dashboard panels.

| Deliverable                                                                       | Status      | Est | Work Item            |
| --------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| `PlaybookOutcome` logging after each dispatch                                     | Not Started | 1   | (create at P1 start) |
| Define `PM_ROLE` (filter: `needs_triage`)                                         | Not Started | 1   | (create at P1 start) |
| Define `DATA_ANALYST_ROLE` (filter: labels `metrics`/`observability`/`cost`)      | Not Started | 1   | (create at P1 start) |
| API contract: `agent-roles.snapshot.v1.contract.ts`                               | Not Started | 1   | (create at P1 start) |
| Dashboard: role overview panel (reads AgentSnapshot files)                        | Not Started | 2   | (create at P1 start) |
| Escalation: stale item detection + Discord notification                           | Not Started | 1   | (create at P1 start) |
| Webhook triggers for Git Reviewer (GitHub PR events → Temporal signal)            | Not Started | 2   | (create at P1 start) |
| Playbook improvement: weekly metaprompt reviews failures, proposes SKILL.md edits | Not Started | 2   | (create at P1 start) |

### Run (P2) — Role Config Files + Cross-Role Orchestration

**Goal:** Roles move from code constants to config files. Roles can hand off items to each other.

| Deliverable                                                                          | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------------ | ----------- | --- | -------------------- |
| Extract role definitions to `work/roles/role.*.yaml` files                           | Not Started | 1   | (create at P2 start) |
| `RoleQueryPort` + markdown/YAML adapter for dashboard                                | Not Started | 2   | (create at P2 start) |
| Cross-role handoff (reviewer → PM on reject, PM → CEO on escalation)                 | Not Started | 2   | (create at P2 start) |
| Role performance dashboard (success rates, time-to-resolution, escalation frequency) | Not Started | 2   | (create at P2 start) |
| Role definitions in repo-spec.yaml for fork-time customization                       | Not Started | 1   | (create at P2 start) |

## Constraints

- `ROLE_IS_CONFIG` — Roles are typed constants (crawl) or config files (walk/run), never database entities
- `SKILL_OWNS_OUTCOME` — Role quality comes from skill (playbook) quality, not schema sophistication
- `CODE_FIRST_NO_YAML` — TypeScript + Zod until 3+ roles prove the shape
- `REUSE_WORKQUERY` — Queue filtering maps directly to `WorkQuery` from `@cogni/work-items`
- `CONTROLLER_NOT_REWRITTEN` — mc-controller.ts gains a `--role` param; the loop logic is unchanged
- `SNAPSHOT_PER_ROLE` — Each role produces independent AgentSnapshot files

## Dependencies

- [x] `@cogni/work-items` WorkItemQueryPort (proj.agentic-project-management P0)
- [x] mc-controller.ts + AgentSnapshot (task.0162)
- [x] Temporal schedules (existing)
- [x] OpenClaw gateway + SKILL.md system (existing)
- [ ] task.0162 PR #562 merged (foundation)

## Design Notes

**Why not a RolePort:** Roles are configuration, not application state. You don't CRUD roles at runtime — you define them in code (crawl) or config files (walk). A port implies storage, adapters, concurrency control — none of which roles need. If we ever need a `RoleQueryPort`, it's a walk-phase concern for the dashboard.

**Why Role, not Agent:** "Agent" is overloaded — it means the LLM runtime (OpenClaw), the identity (AgentDescriptor), and the execution profile. "Role" is the execution profile specifically: what work you see, what skills you use, what rules you follow. An agent (OpenClaw) fulfills a role.

**Why not Temporal workflows per role:** The existing pattern (Temporal schedule → OpenClaw gateway → skill → mc-controller.ts) works. Adding a Temporal workflow per role would mean rewriting the dispatch in TypeScript instead of shell — unnecessary complexity for crawl. The controller IS the workflow logic, just invoked via OpenClaw rather than directly via Temporal activities. Walk phase may move dispatch into Temporal activities for better observability.

**Relationship to charters:** Charters define strategic direction. Roles operationalize it. The CEO role covers all charters. The Git Reviewer role operationalizes the ENGINEERING charter's PR quality goals. Future: `charter` field on Role for alignment tracking.
