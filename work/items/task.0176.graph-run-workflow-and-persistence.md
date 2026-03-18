---
id: task.0176
type: task
title: "GraphRunWorkflow + promote schedule_runs → graph_runs"
status: needs_implement
priority: 0
rank: 3
estimate: 5
summary: Promote schedule_runs to graph_runs as single canonical run ledger; create GraphRunWorkflow in Temporal; execution stays in apps/web via internal API with Redis pump
outcome: All graph runs (API, scheduled, webhook) share a single run ledger with trigger provenance; GraphRunWorkflow orchestrates via Temporal; internal API route publishes events to Redis Streams
spec_refs:
  - spec.unified-graph-launch
assignees: []
project: proj.unified-graph-launch
blocked_by:
  - task.0175
created: 2026-03-13
updated: 2026-03-18
branch: claude/unified-graph-launch-mmXvl
labels:
  - ai-graphs
  - scheduler
---

# GraphRunWorkflow + Promote schedule_runs → graph_runs

## Design Decision (2026-03-13)

**Single canonical run ledger.** Do not introduce a second run table. Promote `schedule_runs` → `graph_runs` via rename + migration. Scheduled runs and API-triggered runs are the same entity with different provenance metadata.

**Idempotency stays in `execution_requests`.** Idempotency is a request-layer concern, not a run-ledger concern. No `idempotency_key` column on `graph_runs`. The existing `execution_requests` table handles request deduplication for all trigger types.

## Design Decision (2026-03-18): Execution host stays in apps/web

**Problem:** task.0176 originally specified `executeAndStreamActivity` calling `GraphExecutorPort.runGraph()` directly in the scheduler-worker. But the full execution stack (InProc, Sandbox, LangGraph providers, billing/observability decorators, `createGraphExecutor()`, `createScopedGraphExecutor()`) lives in `apps/web/src/`. The scheduler-worker has no composition root for this and operates under invariant `EXECUTION_VIA_SERVICE_API: Worker NEVER imports graph execution code`.

**Resolution:** Execution stays in `apps/web` via the existing internal API route. The internal API route (`POST /api/internal/graphs/{graphId}/runs`) is modified to publish events to Redis Streams as it drains the executor stream. The scheduler-worker's `executeGraphActivity` continues calling the internal API via HTTP — no new execution host, no adapter extraction.

**Why not extract adapters to a package?**

- `@cogni/graph-execution-core` must stay contracts-only (ports, types, run lifecycle). Adding adapters destroys the boundary task.0179/0180 just cleaned up.
- A new `graph-execution-runtime` package is premature — only one consumer (`apps/web`) needs the full stack today.
- If worker-local execution becomes necessary later, that's a separate task with its own package (`graph-execution-host` or similar).

**What changes:**

- Internal API route publishes each `AiEvent` to Redis via `RunStreamPort.publish()` as it drains the stream (PUMP_TO_COMPLETION_VIA_REDIS)
- Internal API route calls `RunStreamPort.expire()` after terminal event
- `GraphRunWorkflow` in scheduler-worker uses the existing `executeGraphActivity` (HTTP call), not a new `executeAndStreamActivity`
- Workflow structure: `validateGrantActivity` → `createRunRecordActivity` → `executeGraphActivity` → `finalizeRunActivity`

**What stays the same:**

- Scheduler-worker remains a lean Temporal worker (no graph execution code)
- `apps/web` composition root unchanged
- `@cogni/graph-execution-core` stays contracts-only

## Requirements

- `schedule_runs` renamed to `graph_runs` via migration (single canonical run ledger)
- New columns on `graph_runs`: `run_kind` (user_immediate | system_scheduled | system_webhook), `trigger_source`, `trigger_ref`, `requested_by`, `graph_id`
- `schedule_id` made nullable (API/webhook runs have no schedule)
- `schedule_slot_unique` constraint relaxed to `WHERE schedule_id IS NOT NULL`
- Zero users — no data to backfill, no migration needed
- Status enum extended: `pending`, `running`, `success`/`completed`, `error`/`failed`, `skipped`, `cancelled`
- `attempt` column supports real attempt semantics (unfreeze from hardcoded 0)
- `GraphRunWorkflow` Temporal workflow exists with activities: `validateGrantActivity`, `createRunRecordActivity`, `executeGraphActivity`, `finalizeRunActivity`
- `executeGraphActivity` calls internal API via HTTP; the internal API route publishes events to Redis via `RunStreamPort.publish()` and calls `expire()` after terminal event
- Activity publishes events to Redis regardless of subscriber count (PUMP_TO_COMPLETION_VIA_REDIS — enforced in the internal API route, not the activity)
- Workflow ID format: `graph-run:{tenantId}:{idempotencyKey}` (IDEMPOTENT_RUN_START — key comes from `execution_requests`, not the run table)
- All scheduler-worker code references `graph_runs` (already done in checkpoint 1)
- `GovernanceScheduledRunWorkflow` replaced by `GraphRunWorkflow` (zero users, no migration)
- `graph_runs` record created for ALL runs (no `dbScheduleId` gate — SINGLE_RUN_LEDGER)

## Allowed Changes

- `packages/db-schema/src/scheduling.ts` — rename table, add columns, adjust constraints
- `packages/db-schema/src/` — migration for rename + new columns + backfill
- `services/scheduler-worker/src/` — update all `schedule_runs` references → `graph_runs`
- `services/scheduler-worker/src/workflows/` — new `graph-run.workflow.ts` (replaces `scheduled-run.workflow.ts`)
- `services/scheduler-worker/src/activities/` — update existing activities for unified workflow shape
- `apps/web/src/app/api/internal/graphs/[graphId]/runs/route.ts` — add Redis Stream publishing (publish events as stream drains)
- `apps/web/src/ports/` — new `graph-run.port.ts` if needed for run record CRUD
- `apps/web/src/adapters/server/` — Drizzle adapter for graph_runs
- `apps/web/tests/` — update fixtures and tests referencing `schedule_runs`
- Tests

## Plan

- [x] **Checkpoint 1: Promote schedule_runs → graph_runs** (schema rename + columns)
  - Validation: `pnpm check` passes ✓

- [ ] **Checkpoint 2a: GraphRunWorkflow + unified orchestration** (UNBLOCKED — task.0179, task.0180 done)
  - Build `GraphRunWorkflow` in scheduler-worker replacing `GovernanceScheduledRunWorkflow`
  - Workflow shape: `validateGrantActivity` → `createRunRecordActivity` → `executeGraphActivity` → `finalizeRunActivity`
  - `executeGraphActivity` uses existing internal API call (HTTP to apps/web)
  - `createRunRecordActivity` always creates a `graph_runs` record (no `dbScheduleId` gate)
  - Delete `GovernanceScheduledRunWorkflow` — zero users, no migration, just replace
  - Validation: `pnpm check` passes, scheduled runs use new workflow

- [ ] **Checkpoint 2b: Redis pump in internal API route**
  - Modify `POST /api/internal/graphs/{graphId}/runs` to publish `AiEvent`s to Redis via `RunStreamPort.publish()` as it drains the executor stream
  - Call `RunStreamPort.expire()` after terminal event
  - This is the PUMP_TO_COMPLETION_VIA_REDIS implementation — events reach Redis regardless of SSE subscribers
  - Validation: `pnpm check` passes, Redis Stream populated during execution

- [ ] **Checkpoint 3: Integration test**
  - Stack test: start workflow → verify run record in `graph_runs` → verify events in Redis Stream

## Validation

**Command:**

```bash
pnpm check
pnpm test
```

**Expected:** All checks pass. `graph_runs` table exists (promoted from `schedule_runs`). Workflow orchestrates execution correctly. No `schedule_runs` table remains.

## Review Checklist

- [ ] **Work Item:** task.0176 linked in PR body
- [ ] **Spec:** ONE_RUN_EXECUTION_PATH, IDEMPOTENT_RUN_START, PUMP_TO_COMPLETION_VIA_REDIS, STREAM_PUBLISH_IN_EXECUTION_LAYER, SINGLE_RUN_LEDGER invariants upheld
- [ ] **Design Decision:** Single run ledger — no second table, no idempotency_key on run table
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
