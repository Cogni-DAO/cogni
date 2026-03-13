---
id: task.0164
type: task
title: "GraphRunWorkflow + graph_runs persistence table"
status: needs_triage
priority: 0
rank: 3
estimate: 5
summary: Create graph_runs table for run lifecycle persistence and GraphRunWorkflow in Temporal with executeAndStreamActivity that publishes to Redis Streams
outcome: All graph runs have durable run records with trigger provenance; GraphRunWorkflow executes graphs via Temporal activities and publishes events to Redis Streams
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

# GraphRunWorkflow + graph_runs Persistence Table

## Requirements

- `graph_runs` table exists with: `id`, `tenant_id`, `graph_id`, `graph_name`, `run_kind` (user_immediate | system_scheduled | system_webhook), `trigger_source`, `trigger_ref`, `requested_by`, `status` (pending → running → completed | failed | cancelled), `idempotency_key`, `started_at`, `completed_at`, `error_code`, `error_message`, `attempt` (unfrozen from hardcoded 0), `langfuse_trace_id`, `run_id` (correlation key)
- `GraphRunWorkflow` Temporal workflow exists with activities: `validateGrantActivity`, `createRunRecordActivity`, `executeAndStreamActivity`, `finalizeRunActivity`
- `executeAndStreamActivity` calls `GraphExecutorPort.runGraph()`, pumps `AsyncIterable<AiEvent>` to completion, publishes each event to Redis via `RunStreamPort.publish()`, and calls `expire()` after terminal event
- Activity publishes events to Redis regardless of subscriber count (PUMP_TO_COMPLETION_VIA_REDIS)
- Workflow ID format: `graph-run:{tenantId}:{idempotencyKey}` (IDEMPOTENT_RUN_START)
- `attempt` column supports real attempt semantics (unfreeze from hardcoded 0)
- DB migration created and tested

## Allowed Changes

- `packages/db-schema/src/` — new `graph-runs.ts` schema, migration
- `services/scheduler-worker/src/workflows/` — new `graph-run.workflow.ts`
- `services/scheduler-worker/src/activities/` — new `execute-graph.activity.ts`, `run-record.activity.ts`, `validate-grant.activity.ts`
- `apps/web/src/ports/` — new `graph-run.port.ts` if needed for run record CRUD
- `apps/web/src/adapters/server/` — Drizzle adapter for graph_runs
- Tests

## Plan

- [ ] **Checkpoint 1: graph_runs schema + migration**
  - Create `packages/db-schema/src/graph-runs.ts` with table definition
  - Create DB migration
  - Validation: `pnpm check` passes

- [ ] **Checkpoint 2: GraphRunWorkflow + activities**
  - Create `graph-run.workflow.ts` with 4-activity orchestration
  - Create activities: validateGrant, createRunRecord, executeAndStream, finalizeRun
  - `executeAndStreamActivity` pumps graph events → Redis publish loop → expire on terminal
  - Validation: `pnpm check` passes, unit tests pass

- [ ] **Checkpoint 3: Integration test**
  - Workflow starts, creates run record, executes graph, publishes events to Redis, finalizes
  - Idempotent: same workflowId → at most one execution
  - Run record status transitions: pending → running → completed/failed
  - Validation: `pnpm test` passes

## Validation

**Command:**

```bash
pnpm check
pnpm test
```

**Expected:** All checks pass. graph_runs table created. Workflow orchestrates execution correctly.

## Review Checklist

- [ ] **Work Item:** task.0164 linked in PR body
- [ ] **Spec:** ONE_RUN_EXECUTION_PATH, IDEMPOTENT_RUN_START, PUMP_TO_COMPLETION_VIA_REDIS, STREAM_PUBLISH_IN_ACTIVITY invariants upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
