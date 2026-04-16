---
id: task.0241
type: task
title: "Schedule Management AI Tools + Planner UI"
status: needs_merge
priority: 1
rank: 1
estimate: 3
summary: "Add 2 AI tools for schedule CRUD (list + manage) and a /planner page that renders schedules as a 24-hour grid."
outcome: "AI can self-schedule graph executions via tools. Humans see/edit the same schedules on a time grid. editPolicy metadata controls AI vs human-only slots."
spec_refs: scheduler
assignees: derekg1729
credit:
project: proj.scheduler-evolution
branch: feat/scheduled-sweep-v0
pr:
reviewer:
revision: 2
blocked_by:
deploy_verified: false
created: 2026-03-30
updated: 2026-03-31
labels: [scheduler, ai-tools, ui]
external_refs:
---

# Schedule Management AI Tools + Planner UI

## Design (revision 1 — post review)

Schedules are the primitive. No "day plan" abstraction. The planner UI is a time-grid projection of existing schedules. AI tools are generic schedule CRUD, not day-plan-specific.

- **ScheduleCapability** (packages/ai-tools): generic list/create/update/delete
- **2 tools**: `core__schedule_list` (read_only) + `core__schedule_manage` (state_change, action-discriminated)
- **editPolicy**: `"ai_managed" | "human_only"` in schedule `input._meta` — checked by capability impl
- **No new API routes**: planner UI reuses `GET /api/v1/schedules`, groups by hour client-side
- **User scoping**: extend `ExecutionScope` (ALS) with `actorUserId` — capability impl reads real userId at tool invocation time, enforces RLS via `ScheduleUserPort`

## Requirements

- 2 native AI tools registered in TOOL_CATALOG:
  - `core__schedule_list` (read_only) — returns all schedules with metadata
  - `core__schedule_manage` (state_change) — `action: "create"|"update"|"delete"|"enable"|"disable"` with per-action input
- `ScheduleCapability` in packages/ai-tools is generic schedule CRUD — no day-plan domain concepts
- `editPolicy` metadata in `input._meta.editPolicy`: `"ai_managed" | "human_only"` — AI tool rejects mutations on `human_only` slots
- CEO Operator and Brain graphs gain the 2 schedule tool IDs
- Planner UI deferred — existing /schedules page serves as the human view

## Allowed Changes

- `packages/ai-tools/src/capabilities/` — new ScheduleCapability interface
- `packages/ai-tools/src/tools/` — 2 new tool files
- `packages/ai-tools/src/catalog.ts` + `index.ts` — register + export
- `apps/operator/src/adapters/server/ai/execution-scope.ts` — add actorUserId + billingAccountId to ExecutionScope
- `apps/operator/src/bootstrap/graph-executor.factory.ts` — pass actorUserId into runInScope
- `apps/operator/src/bootstrap/capabilities/` — capability implementation (reads from ALS)
- `apps/operator/src/bootstrap/ai/tool-bindings.ts` — wire capability
- `apps/operator/src/bootstrap/container.ts` — create capability
- `packages/langgraph-graphs/src/graphs/{operator,brain}/tools.ts` — add tool IDs

## Plan

- [ ] Create `packages/ai-tools/src/capabilities/schedule.ts` — generic ScheduleCapability interface
- [ ] Create `packages/ai-tools/src/tools/schedule-list.ts` — contract + factory + stub
- [ ] Create `packages/ai-tools/src/tools/schedule-manage.ts` — action-discriminated contract + factory + stub
- [ ] Register in catalog + export from index
- [ ] Create `apps/operator/src/bootstrap/capabilities/schedule.ts` — impl wrapping ScheduleUserPort
- [ ] Wire in tool-bindings.ts + container.ts
- [ ] Add tool IDs to operator + brain graphs
- [ ] Create `/planner` page + view (24-hour grid, reuses fetchSchedules + fetchAgents)
- [ ] Add Planner to sidebar nav
- [ ] Verify: `pnpm packages:build && pnpm check:fast`

## Validation

```bash
pnpm packages:build && pnpm check:fast
```

**Manual:** Run brain graph, ask "list my schedules" and "schedule research every day at 3pm" — tools fire correctly.

## Review Checklist

- [ ] **Work Item:** `task.0234` linked in PR body
- [ ] **Spec:** CRUD_IS_TEMPORAL_AUTHORITY, GRANT_NOT_SESSION upheld
- [ ] **Tests:** tool contract tests for 2 new tools
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
