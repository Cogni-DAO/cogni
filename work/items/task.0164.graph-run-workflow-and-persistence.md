---
id: task.0164
type: task
title: "GraphRunWorkflow + promote schedule_runs → graph_runs"
status: needs_triage
priority: 0
rank: 3
estimate: 5
summary: Promote schedule_runs to graph_runs as single canonical run ledger; create GraphRunWorkflow in Temporal with executeAndStreamActivity that publishes to Redis Streams
outcome: All graph runs (API, scheduled, webhook) share a single run ledger with trigger provenance; GraphRunWorkflow executes graphs via Temporal activities and publishes events to Redis Streams
spec_refs:
  - spec.unified-graph-launch
assignees: []
project: proj.unified-graph-launch
blocked_by:
  - task.0163
created: 2026-03-13
updated: 2026-03-13
labels:
  - ai-graphs
  - scheduler
---

# GraphRunWorkflow + Promote schedule_runs → graph_runs

## Design Decision (2026-03-13)

**Single canonical run ledger.** Do not introduce a second run table. Promote `schedule_runs` → `graph_runs` via rename + migration. Scheduled runs and API-triggered runs are the same entity with different provenance metadata.

**Idempotency stays in `execution_requests`.** Idempotency is a request-layer concern, not a run-ledger concern. No `idempotency_key` column on `graph_runs`. The existing `execution_requests` table handles request deduplication for all trigger types.

## Requirements

- `schedule_runs` renamed to `graph_runs` via migration (single canonical run ledger)
- New columns on `graph_runs`: `run_kind` (user_immediate | system_scheduled | system_webhook), `trigger_source`, `trigger_ref`, `requested_by`, `graph_id`
- `schedule_id` made nullable (API/webhook runs have no schedule)
- `schedule_slot_unique` constraint relaxed to `WHERE schedule_id IS NOT NULL`
- Existing rows backfilled: `run_kind = 'system_scheduled'`, `trigger_source = 'temporal_schedule'`
- Status enum extended: `pending`, `running`, `success`/`completed`, `error`/`failed`, `skipped`, `cancelled`
- `attempt` column supports real attempt semantics (unfreeze from hardcoded 0)
- `GraphRunWorkflow` Temporal workflow exists with activities: `validateGrantActivity`, `createRunRecordActivity`, `executeAndStreamActivity`, `finalizeRunActivity`
- `executeAndStreamActivity` calls `GraphExecutorPort.runGraph()`, pumps `AsyncIterable<AiEvent>` to completion, publishes each event to Redis via `RunStreamPort.publish()`, and calls `expire()` after terminal event
- Activity publishes events to Redis regardless of subscriber count (PUMP_TO_COMPLETION_VIA_REDIS)
- Workflow ID format: `graph-run:{tenantId}:{idempotencyKey}` (IDEMPOTENT_RUN_START — key comes from `execution_requests`, not the run table)
- DB migration created and tested
- All existing scheduler-worker code updated to reference `graph_runs` instead of `schedule_runs`

## Allowed Changes

- `packages/db-schema/src/scheduling.ts` — rename table, add columns, adjust constraints
- `packages/db-schema/src/` — migration for rename + new columns + backfill
- `services/scheduler-worker/src/` — update all `schedule_runs` references → `graph_runs`
- `services/scheduler-worker/src/workflows/` — new `graph-run.workflow.ts`
- `services/scheduler-worker/src/activities/` — new `execute-graph.activity.ts`, `run-record.activity.ts`, `validate-grant.activity.ts`
- `apps/web/src/ports/` — new `graph-run.port.ts` if needed for run record CRUD
- `apps/web/src/adapters/server/` — Drizzle adapter for graph_runs
- `apps/web/tests/` — update fixtures and tests referencing `schedule_runs`
- Tests

## Plan

- [ ] **Checkpoint 1: Promote schedule_runs → graph_runs**
  - Rename table in schema: `schedule_runs` → `graph_runs`
  - Add new columns: `run_kind`, `trigger_source`, `trigger_ref`, `requested_by`, `graph_id`
  - Make `schedule_id` nullable
  - Relax `schedule_slot_unique` to `WHERE schedule_id IS NOT NULL`
  - Create DB migration with backfill for existing rows
  - Update all code references: scheduler-worker, fixtures, tests
  - Validation: `pnpm check` passes

- [ ] **Checkpoint 2: GraphRunWorkflow + activities**
  - Create `graph-run.workflow.ts` with 4-activity orchestration
  - Create activities: validateGrant, createRunRecord, executeAndStream, finalizeRun
  - `executeAndStreamActivity` pumps graph events → Redis publish loop → expire on terminal
  - Validation: `pnpm check` passes, unit tests pass

- [ ] **Checkpoint 3: Integration test**
  - Workflow starts, creates run record, executes graph, publishes events to Redis, finalizes
  - Idempotent: same workflowId → at most one execution (via `execution_requests`)
  - Run record status transitions: pending → running → completed/failed
  - Validation: `pnpm test` passes

## Validation

**Command:**

```bash
pnpm check
pnpm test
```

**Expected:** All checks pass. `graph_runs` table exists (promoted from `schedule_runs`). Workflow orchestrates execution correctly. No `schedule_runs` table remains.

## Review Checklist

- [ ] **Work Item:** task.0164 linked in PR body
- [ ] **Spec:** ONE_RUN_EXECUTION_PATH, IDEMPOTENT_RUN_START, PUMP_TO_COMPLETION_VIA_REDIS, STREAM_PUBLISH_IN_ACTIVITY invariants upheld
- [ ] **Design Decision:** Single run ledger — no second table, no idempotency_key on run table
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
