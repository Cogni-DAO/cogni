---
id: proj.workflow-building-monitoring
type: project
primary_charter:
title: "Workflow Building & Monitoring — Configuration, Execution Visibility, and User Workflows"
state: Active
priority: 2
estimate: 10
summary: "Give admins and end users visibility into configured workflows, execution history, and status — then progressively empower users to configure their own workflows. System (DAO account) workflows are first-class. Builds on Temporal infrastructure from proj.scheduler-evolution and typed pipeline composition from task.0144."
outcome: "Admins see all configured system workflows, drill into execution history per run, and edit schedule/input configurations from the UI. End users can view workflows relevant to them and (eventually) configure their own."
assignees: derekg1729
created: 2026-03-09
updated: 2026-03-09
labels: [temporal, governance, ui, dx, observability]
---

# Workflow Building & Monitoring

## Goal

Make Temporal workflow state visible and manageable through the Cogni UI. Today, workflow configuration and execution history are only visible via the Temporal UI (operator-only). This project surfaces that information to admins and end users, then progressively adds workflow configuration capabilities.

## Context

### What exists today

- **Temporal infrastructure**: Schedules, workers, workflows all running (proj.scheduler-evolution P0-P1 complete)
- **ScheduleControlPort**: CRUD for Temporal schedules (create/pause/resume/delete/describe)
- **schedule_runs table**: Execution ledger for DB-backed scheduled graph runs (status, traceId, error)
- **Ledger workflows**: CollectEpochWorkflow, FinalizeEpochWorkflow — schedule-triggered, no DB run records yet
- **Typed pipeline composition** (task.0144): Child workflows with stage I/O types — richer execution data to surface

### What's missing

- No UI showing configured workflows or schedules
- No UI showing execution history or run status
- Ledger workflows don't write to schedule_runs (only GovernanceScheduledRunWorkflow does)
- No user-configurable workflows (all hardcoded in deploy config)
- No concept of "system account" vs "user" workflow ownership

## Roadmap

### Crawl (P0) — Admin Visibility (Read-Only)

**Goal:** Admins can see all configured workflows, their schedules, and execution history from the Cogni UI.

| Deliverable                                                                   | Status      | Est | Work Item            |
| ----------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Read model: unified workflow/schedule list API (Temporal + DB)                | Not Started | 2   | (create at P0 start) |
| Read model: execution history API (schedule_runs + Temporal workflow history) | Not Started | 2   | (create at P0 start) |
| Extend ledger workflows to write schedule_runs records                        | Not Started | 1   | (create at P0 start) |
| UI: Workflow list page — name, schedule, status, last run, next run           | Not Started | 2   | (create at P0 start) |
| UI: Workflow detail page — run history table, status badges, duration         | Not Started | 2   | (create at P0 start) |
| UI: Run detail view — stage breakdown (child workflows), errors, retry info   | Not Started | 2   | (create at P0 start) |

**Key decisions for P0:**

- **Data source**: Query Temporal API directly for schedule/workflow state, or mirror to DB? Temporal API is authoritative but adds latency. Mirroring risks drift. Start with direct Temporal queries (via ScheduleControlPort) + schedule_runs for history.
- **Auth**: Admin-only (existing approver/admin role). No end-user access in P0.

### Walk (P1) — Admin Configuration

**Goal:** Admins can edit workflow configurations (schedule timing, input parameters, pause/resume) from the UI.

| Deliverable                                                               | Status      | Est | Work Item            |
| ------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| UI: Edit schedule (cron, timezone, pause/resume)                          | Not Started | 2   | (create at P1 start) |
| UI: Edit workflow input parameters (weight config, sources, grace period) | Not Started | 2   | (create at P1 start) |
| UI: Manual trigger button (reuses task.0138 trigger endpoint)             | Not Started | 1   | (create at P1 start) |
| Audit log: who changed what, when                                         | Not Started | 2   | (create at P1 start) |
| System account concept: DAO-owned workflows distinct from user workflows  | Not Started | 2   | (create at P1 start) |

### Run (P2) — User Workflows

**Goal:** End users can view workflows relevant to them and configure their own scheduled workflows within granted permissions.

| Deliverable                                                                          | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------------ | ----------- | --- | -------------------- |
| Design: user workflow permissions model (what can users schedule?)                   | Not Started | 2   | (create at P2 start) |
| Design: workflow template system (pre-approved workflow types users can instantiate) | Not Started | 2   | (create at P2 start) |
| UI: User-facing workflow dashboard (my workflows, shared workflows)                  | Not Started | 3   | (create at P2 start) |
| UI: Create workflow from template (select type, configure inputs, set schedule)      | Not Started | 3   | (create at P2 start) |
| ExecutionGrant integration: user workflows require valid grants                      | Not Started | 2   | (create at P2 start) |

## Architecture Alignment

### Builds on

- **proj.scheduler-evolution** — Temporal infrastructure, ScheduleControlPort, schedule_runs schema
- **task.0144** — Typed pipeline composition: child workflows provide per-stage visibility data
- **proj.transparent-credit-payouts** — Attribution workflows are the first system workflows to surface
- **RBAC spec** — Admin vs user role distinction for workflow access

### Data flow

```
Temporal Schedules (authoritative config)
    ↓ ScheduleControlPort.describeSchedule()
Workflow List API (read model)
    ↓
Admin UI — Workflow List Page

Temporal Workflow History + schedule_runs (DB)
    ↓
Execution History API (read model)
    ↓
Admin UI — Run History + Detail Pages
```

### Key invariants

- **TEMPORAL_IS_AUTHORITY**: Temporal is the source of truth for schedule state. The DB mirrors for query performance and history, never overrides.
- **CRUD_VIA_PORT**: All schedule mutations go through ScheduleControlPort — no direct Temporal API calls from UI layer.
- **SYSTEM_WORKFLOW_IDENTITY**: System workflows are owned by a DAO system account, not a user. Visible to all admins.
- **USER_WORKFLOW_GATED**: User-created workflows require a valid ExecutionGrant and respect RBAC scope.

## Dependencies

- [x] Temporal infrastructure (proj.scheduler-evolution P0-P1)
- [x] ScheduleControlPort with CRUD (proj.scheduler-evolution P1)
- [x] schedule_runs schema (proj.scheduler-evolution P0)
- [ ] task.0144 — Typed pipeline composition (child workflow visibility)
- [ ] task.0138 — Manual trigger endpoint (reused by P1 trigger button)
- [ ] RBAC hardening (proj.rbac-hardening) — admin role for P0, user roles for P2

## Constraints

- Temporal is the source of truth for schedule/workflow state — DB is a read-optimized mirror
- All schedule mutations go through ScheduleControlPort — no direct Temporal API calls from UI
- P0 is read-only — no configuration changes from UI until P1
- System workflows owned by DAO system account, not attributable to any individual user

## As-Built Specs

- [Temporal Patterns](../../docs/spec/temporal-patterns.md) — Workflow conventions, pipeline stage composition
- [Scheduler Spec](../../docs/spec/scheduler.md) — Schedule CRUD, execution grants, schedule_runs schema

## Design Notes

**Phase progression:**

| Phase | Audience  | Capability                                                               |
| ----- | --------- | ------------------------------------------------------------------------ |
| P0    | Admins    | Read-only visibility: workflow list, run history, stage detail           |
| P1    | Admins    | Configuration: edit schedules, edit inputs, manual trigger, audit log    |
| P2    | End users | Self-service: create workflows from templates within granted permissions |

**Open questions (resolve during P0 design):**

- Mirror Temporal state to DB for fast queries, or query Temporal API on demand?
- How to unify schedule_runs (DB-backed) with Temporal workflow history (ledger workflows)?
- What's the right granularity for "system account" identity?

## Related

- [Scheduler Evolution](proj.scheduler-evolution.md) — Temporal migration (infrastructure layer)
- [Transparent Credit Payouts](proj.transparent-credit-payouts.md) — First system workflows to surface
- [Temporal Patterns Spec](../../docs/spec/temporal-patterns.md) — Workflow conventions
- [Scheduler Spec](../../docs/spec/scheduler.md) — Schedule CRUD, execution grants
