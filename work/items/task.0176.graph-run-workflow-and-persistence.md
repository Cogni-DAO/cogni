---
id: task.0176
type: task
title: "GraphRunWorkflow + promote schedule_runs → graph_runs"
status: done
priority: 0
rank: 3
estimate: 5
summary: Promote schedule_runs to graph_runs as single canonical run ledger; create GraphRunWorkflow in Temporal; execution stays in apps/operator via internal API with Redis pump
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

## Design Decision (2026-03-18): Execution host stays in apps/operator

**Problem:** task.0176 originally specified `executeAndStreamActivity` calling `GraphExecutorPort.runGraph()` directly in the scheduler-worker. But the full execution stack (InProc, Sandbox, LangGraph providers, billing/observability decorators, `createGraphExecutor()`, `createScopedGraphExecutor()`) lives in `apps/operator/src/`. The scheduler-worker has no composition root for this and operates under invariant `EXECUTION_VIA_SERVICE_API: Worker NEVER imports graph execution code`.

**Resolution:** Execution stays in `apps/operator` via the existing internal API route. The internal API route (`POST /api/internal/graphs/{graphId}/runs`) is modified to publish events to Redis Streams as it drains the executor stream. The scheduler-worker's `executeGraphActivity` continues calling the internal API via HTTP — no new execution host, no adapter extraction.

**Why not extract adapters to a package?**

- `@cogni/graph-execution-core` must stay contracts-only (ports, types, run lifecycle). Adding adapters destroys the boundary task.0179/0180 just cleaned up.
- A new `graph-execution-runtime` package is premature — only one consumer (`apps/operator`) needs the full stack today.
- If worker-local execution becomes necessary later, that's a separate task with its own package (`graph-execution-host` or similar).

**What changes:**

- Internal API route publishes each `AiEvent` to Redis via `RunStreamPort.publish()` as it drains the stream (PUMP_TO_COMPLETION_VIA_REDIS)
- Internal API route calls `RunStreamPort.expire()` after terminal event
- `GraphRunWorkflow` in scheduler-worker uses the existing `executeGraphActivity` (HTTP call), not a new `executeAndStreamActivity`
- Workflow structure: `validateGrantActivity` → `createRunRecordActivity` → `executeGraphActivity` → `finalizeRunActivity`

**What stays the same:**

- Scheduler-worker remains a lean Temporal worker (no graph execution code)
- `apps/operator` composition root unchanged
- `@cogni/graph-execution-core` stays contracts-only

## Design Feedback (2026-03-18): Codebase audit + review notes

Feedback items analyzed against existing code to avoid unnecessary rebuilds:

| Feedback                              | Existing Code                                                                                   | Action                                                                                                                                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow ID conflict/reuse policy     | No custom workflow IDs today — `GovernanceScheduledRunWorkflow` uses Temporal auto-assigned IDs | New: define format, document conflict policy                                                                                                                                                                                |
| Heartbeat for long-running activities | Zero heartbeat usage in scheduler-worker                                                        | Deferred: `executeGraphActivity` does a single blocking `await fetch()` — can't heartbeat mid-call. `maximumAttempts: 1` + 15-min timeout is sufficient. Heartbeat relevant only if we switch to chunked/streaming response |
| No Redis consumer groups for SSE      | `RedisRunStreamAdapter.subscribe()` already uses `XRANGE` + `XREAD` offset-based replay         | No change — already correct                                                                                                                                                                                                 |
| Single finalize step                  | `finalizeRequest()` and `markRunCompleted()` already exist as separate port methods             | Compose into one `finalizeRunActivity` that calls both                                                                                                                                                                      |
| Standardize status vocabulary         | `GRAPH_RUN_STATUSES` already defined in `db-schema/scheduling.ts`                               | No rename — already standardized                                                                                                                                                                                            |
| Add monotonic seq                     | `markRunStarted(WHERE pending)` and `markRunCompleted(WHERE pending                             | running)` already enforce monotonic transitions                                                                                                                                                                             | Defer `seq` column — Redis Stream entry IDs (`XADD` auto-assigned) are the canonical cursor for replay. `RunStreamPort.subscribe(fromId)` already uses this contract. No app-level seq needed |

## Requirements

**Schema (checkpoint 1 — done):**

- `schedule_runs` renamed to `graph_runs` via migration (single canonical run ledger)
- New columns on `graph_runs`: `run_kind`, `trigger_source`, `trigger_ref`, `requested_by`, `graph_id`
- `schedule_id` made nullable; `schedule_slot_unique` constraint relaxed to `WHERE schedule_id IS NOT NULL`
- Status enum: reuse existing `GRAPH_RUN_STATUSES` (`pending`, `running`, `success`, `error`, `skipped`, `cancelled`) — no rename
- `attemptCount` column already exists (was hardcoded 0) — unfreeze for real attempt tracking

**Workflow (checkpoint 2a):**

- `GraphRunWorkflow` Temporal workflow with activities: `validateGrantActivity`, `createRunRecordActivity`, `executeGraphActivity`, `finalizeRunActivity`
- Workflow ID format: `graph-run:{billingAccountId}:{idempotencyKey}` — `billingAccountId` is not PII; visible in Temporal UI/logs is acceptable. Conflict policy: Temporal rejects duplicate workflow start with `WorkflowExecutionAlreadyStarted` — caller treats as idempotent success
- `executeGraphActivity` calls internal API via HTTP (existing pattern, existing idempotency via `execution_requests`). Single blocking `await fetch()` — no heartbeat (can't heartbeat mid-call; `maximumAttempts: 1` + 15-min timeout is sufficient)
- Workflow ID conflict policy set explicitly in code: `workflowIdConflictPolicy: USE_EXISTING` (running duplicate = idempotent no-op), `workflowIdReusePolicy: REJECT_DUPLICATE` (completed duplicate = already ran, don't re-run)
- `finalizeRunActivity` converges ALL terminal paths (success, error, timeout) into a single activity that calls both `markRunCompleted()` on `graph_runs` AND `finalizeRequest()` on `execution_requests`
- `createRunRecordActivity` always creates a `graph_runs` record (no `dbScheduleId` gate — SINGLE_RUN_LEDGER)
- `GovernanceScheduledRunWorkflow` replaced by `GraphRunWorkflow` (zero users, no migration)

**Redis pump (checkpoint 2b):**

- Internal API route publishes events to Redis via `RunStreamPort.publish()` as it drains the executor stream
- Calls `RunStreamPort.expire()` after terminal event
- PUMP_TO_COMPLETION_VIA_REDIS enforced in the internal API route, not the activity
- No Redis consumer groups — `RunStreamPort.subscribe()` already uses offset-based `XRANGE` + `XREAD` (confirmed by codebase audit)
- **Cursor contract:** Redis Stream entry IDs (auto-assigned by `XADD`) are the canonical cursor for replay semantics. `RunStreamPort.subscribe(runId, signal, fromId?)` uses these IDs directly. No app-level `seq` column needed — this is why we defer it

**Reused infrastructure (NOT rebuilt):**

- `execution_requests` table + `ExecutionRequestPort` (checkIdempotency/createPending/finalize) — unchanged
- `GRAPH_RUN_STATUSES` enum — unchanged
- `markRunStarted()` / `markRunCompleted()` monotonic guards — unchanged
- `RedisRunStreamAdapter` publish/subscribe — unchanged
- `GRAPH_EXECUTION_ACTIVITY_OPTIONS` (`maximumAttempts: 1`, 15-min timeout) — unchanged

## Allowed Changes

- `packages/db-schema/src/scheduling.ts` — rename table, add columns, adjust constraints
- `packages/db-schema/src/` — migration for rename + new columns + backfill
- `services/scheduler-worker/src/` — update all `schedule_runs` references → `graph_runs`
- `services/scheduler-worker/src/workflows/` — new `graph-run.workflow.ts` (replaces `scheduled-run.workflow.ts`)
- `services/scheduler-worker/src/activities/` — update existing activities for unified workflow shape
- `apps/operator/src/app/api/internal/graphs/[graphId]/runs/route.ts` — add Redis Stream publishing (publish events as stream drains)
- `apps/operator/src/ports/` — new `graph-run.port.ts` if needed for run record CRUD
- `apps/operator/src/adapters/server/` — Drizzle adapter for graph_runs
- `apps/operator/tests/` — update fixtures and tests referencing `schedule_runs`
- Tests

## Plan

- [x] **Checkpoint 1: Promote schedule_runs → graph_runs** (schema rename + columns)
  - Validation: `pnpm check` passes ✓

- [x] **Checkpoint 2a: GraphRunWorkflow + unified orchestration** (UNBLOCKED — task.0179, task.0180 done)
  - Build `GraphRunWorkflow` in scheduler-worker replacing `GovernanceScheduledRunWorkflow`
  - Workflow shape: try { validate → createRecord → execute → finalize(success) } catch { finalize(error) }
  - `executeGraphActivity` reuses existing HTTP call to internal API + existing `execution_requests` idempotency (no heartbeat — single blocking fetch, maximumAttempts: 1)
  - `createRunRecordActivity` always creates a `graph_runs` record (no `dbScheduleId` gate)
  - `finalizeRunActivity` = single converged terminal step: calls `markRunCompleted()` + `finalizeRequest()`
  - Workflow ID: `graph-run:{billingAccountId}:{idempotencyKey}` with explicit conflict policy in code (`USE_EXISTING` for running, `REJECT_DUPLICATE` for completed)
  - Delete `GovernanceScheduledRunWorkflow` — zero users, just replace
  - Validation: `pnpm check` passes, scheduled runs use new workflow

- [x] **Checkpoint 2b: Redis pump in internal API route**
  - Modify `POST /api/internal/graphs/{graphId}/runs` to publish `AiEvent`s to Redis via `RunStreamPort.publish()` as it drains the executor stream
  - Call `RunStreamPort.expire()` after terminal event
  - No consumer groups — reuse existing offset-based `XRANGE`/`XREAD` in `RedisRunStreamAdapter.subscribe()`
  - This is the PUMP_TO_COMPLETION_VIA_REDIS implementation — events reach Redis regardless of SSE subscribers
  - Validation: `pnpm check` passes, Redis Stream populated during execution

- [ ] **Checkpoint 3: Integration test** (requires `pnpm dev:stack:test` — deferred to stack validation)
  - Stack test: start workflow → verify run record in `graph_runs` → verify events in Redis Stream
  - Existing stack tests updated to reference `GraphRunWorkflow` (workflow type name change)

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
