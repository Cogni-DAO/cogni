---
id: task.0177
type: task
title: "Unified streaming API: chat endpoint → Temporal + Redis + idempotency"
status: done
revision: 1
priority: 0
rank: 4
estimate: 5
summary: Refactor chat endpoint to start GraphRunWorkflow and subscribe to Redis Streams for SSE delivery; add Idempotency-Key support for API-triggered runs
outcome: Chat POST starts Temporal workflow instead of inline execution; SSE streams from Redis; idempotent run starts; non-scheduled GraphRunWorkflow path works
spec_refs:
  - spec.unified-graph-launch
assignees: []
project: proj.unified-graph-launch
blocked_by:
  - task.0176
created: 2026-03-13
updated: 2026-03-24
labels:
  - ai-graphs
---

# Unified Streaming API

## Design Decisions (2026-03-18)

### Execution grant: skip for API runs

`GraphRunWorkflow` calls `validateGrantActivity` — scheduled runs have pre-provisioned execution grants. API chat runs do not. The billing decorator stack (preflight credit check + billing account validation) already enforces credit/auth at the execution layer, which is defense-in-depth for grants anyway.

**Decision:** For `user_immediate` runs, the workflow skips `validateGrantActivity`. Pass `executionGrantId: null` and have the workflow bypass grant validation when null. The internal API route's existing billing decorator is the enforcement point for API runs. Grant unification (all runs get grants) is deferred — separate task if needed.

### Internal API route: generalize idempotency key format

The internal API route's `extractScheduleId()` function parses schedule IDs from idempotency keys using ISO-8601 timestamp detection. For API-triggered runs, the idempotency key format is `api:{requestId}` — no timestamp suffix.

**Decision:** `extractScheduleId()` already handles this — if no ISO timestamp boundary is found, it returns the full key. The schedule-specific `stateKey` derivation (SHA-256 of scheduleId for conversation continuity) should be conditional: only for scheduled runs. API runs use the client-supplied `stateKey` directly.

### Temporal client: singleton in container

Per-request `Connection.connect()` is ~50-100ms — unacceptable on the chat hot path. The finalize route has a TODO for this exact problem.

**Decision:** Add a lazy `WorkflowClient` singleton to the apps/operator container (`bootstrap/container.ts`), matching the pattern used by `ScheduleControlAdapter`. The chat route gets the client from the container.

### Latency acknowledgment

Adding Temporal + Redis between the HTTP handler and execution adds latency:

- Temporal workflow start + activity scheduling: ~100-300ms to first token
- Redis XREAD BLOCK: up to 5s worst-case poll interval

The spec's "≤50ms added" claim is aspirational for steady-state streaming latency (per-token overhead via Redis). First-token latency increases significantly. This is the architectural tradeoff for durability, idempotency, and reconnection.

**Mitigation:** Short initial XREAD timeout (100ms) with exponential backoff to 5s. First token arrives within ~200ms of Redis publish in practice.

### Single orchestration seam via facade — no dual execution path

Both `/api/v1/ai/chat` and `/api/v1/chat/completions` call the same facade (`completionStream()` in `completion.server.ts`). The facade returns `{ stream: AsyncIterable<AiEvent>, final }`. Each route is a thin protocol adapter: chat maps `AiEvent` → AI SDK UIMessageChunks, completions maps `AiEvent` → OpenAI SSE chunks. Neither contains execution logic.

**Decision:** Change the facade, not the routes. `completionStream()` switches from inline `GraphExecutorPort.runGraph()` to workflow start + Redis subscribe. Both routes get Temporal orchestration for free — same interface, same `AiEvent` stream, just from Redis instead of in-process memory. Zero users, no reason to keep inline execution alive. ONE_RUN_EXECUTION_PATH is fully realized in this task for all API triggers.

### Thread persistence accumulator with Redis events

The current chat route has ~120 lines of accumulator logic (text_delta, tool parts, assistant_final). With Redis-based streaming, `RunStreamEntry.event` is `AiEvent` — the exact same types. The accumulator logic moves unchanged into the Redis subscribe consumer loop. No new mapping needed.

## Requirements

- `POST /api/v1/ai/chat` starts `GraphRunWorkflow` via Temporal client instead of calling `GraphExecutorPort` inline
- SSE response reads from Redis Streams (via `RunStreamPort.subscribe()`), not in-process memory (SSE_FROM_REDIS_NOT_MEMORY)
- AI SDK Data Stream Protocol preserved — `assistant-ui` client works without changes
- Thread persistence continues to work (user message saved before workflow start, assistant message saved after stream pump)
- `Idempotency-Key` header support on chat endpoint — same key → same workflow → same runId
- Multiple concurrent runs produce independent SSE streams
- `GraphRunWorkflow` handles `user_immediate` runKind (remove NotImplemented guard)
- `executeGraphActivity` supports API-originated idempotency keys (`api:{requestId}`)
- Temporal `WorkflowClient` singleton in apps/operator container (no per-request connections)

## Allowed Changes

- `apps/operator/src/app/_facades/ai/completion.server.ts` — convergence point: `completionStream()` switches to workflow start + Redis subscribe (both chat and completions routes inherit)
- `apps/operator/src/app/api/v1/ai/chat/route.ts` — thread persistence accumulator adapts to Redis-backed stream
- `apps/operator/src/app/api/v1/chat/completions/route.ts` — minimal: consumes same facade, no execution logic change
- `apps/operator/src/features/ai/services/ai_runtime.ts` — remove RunEventRelay (dead: pump moved to internal API, fanout moved to Redis)
- `apps/operator/src/contracts/` — update/add contracts as needed
- `apps/operator/src/bootstrap/container.ts` — add Temporal WorkflowClient singleton
- `apps/operator/src/app/api/internal/graphs/[graphId]/runs/route.ts` — generalize for API-originated inputs (stateKey passthrough, conditional schedule logic)
- `services/scheduler-worker/src/workflows/graph-run.workflow.ts` — remove NotImplemented guard, handle user_immediate runKind (skip grant validation when executionGrantId is null)
- `services/scheduler-worker/src/activities/index.ts` — make temporalScheduleId optional in ExecuteGraphInput, support `api:{runId}` idempotency key format
- Tests

## Plan

- [x] **Checkpoint 1: Temporal client + workflow unblock**
  - Add lazy `WorkflowClient` singleton to apps/operator container
  - Remove NotImplemented guard in `GraphRunWorkflow` for non-scheduled runs
  - Make `temporalScheduleId` optional in `ExecuteGraphInput`; derive idempotency key as `api:{runId}` when absent
  - Skip `validateGrantActivity` when `executionGrantId` is null (API runs)
  - Generalize internal API route for API-originated inputs (conditional schedule logic in `extractScheduleId`, stateKey passthrough)
  - Validation: `pnpm check` passes, scheduled runs still work

- [x] **Checkpoint 2: Chat endpoint refactor**
  - Replace inline `GraphExecutorPort` call with `workflowClient.start(GraphRunWorkflow)`
  - Subscribe to Redis Stream `run:{runId}` and pipe events through `createUIMessageStream` → SSE
  - Preserve thread persistence lifecycle (Phase 1: save user msg, Phase 2: save assistant msg after stream)
  - Accumulator logic: same AiEvent types, moves into Redis subscribe loop
  - Accept optional `Idempotency-Key` header; derive workflowId from it (or generate `api:{requestId}`)
  - Duplicate requests → same runId (Temporal `WorkflowExecutionAlreadyStarted` → subscribe to existing stream)
  - Validation: `pnpm check` passes, chat works end-to-end via Temporal + Redis

- [x] **Checkpoint 3: Integration tests + cleanup**
  - Stack test: chat POST → SSE stream → tokens arrive
  - Idempotency test: duplicate key → same runId
  - Delete RunEventRelay (dead: both routes use Redis-backed stream via facade)
  - Validation: `pnpm check` passes, stack tests pass

## Validation

**Command:**

```bash
pnpm check
pnpm test
```

**Expected:** Chat works end-to-end through Temporal + Redis path. Idempotency prevents duplicate runs. Scheduled runs unaffected.

## Review Checklist

- [ ] **Work Item:** task.0177 linked in PR body
- [ ] **Spec:** ONE_RUN_EXECUTION_PATH, SSE_FROM_REDIS_NOT_MEMORY, IDEMPOTENT_RUN_START invariants upheld
- [ ] **No inline execution:** both chat and completions routes go through Temporal via facade
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## Review Feedback (revision 1)

**Blocking:**

1. **Race condition in `getTemporalWorkflowClient()`** (`apps/operator/src/bootstrap/container.ts:245-258`): Two concurrent callers during startup both see `_workflowClient === null`, both call `Connection.connect()`, first connection is overwritten and leaked. On the chat hot path, this WILL happen under load. Fix: store the pending promise so concurrent callers coalesce on the same connection.

**Non-blocking:**

2. Facade file header (`completion.server.ts:9`) still says `UNIFIED_GRAPH_EXECUTOR: Both chatCompletion() and completionStream() use GraphExecutorPort` — stale, should reference Temporal.
3. Hardcoded `"scheduler-tasks"` in `completion.server.ts:342` — consider reading from `TEMPORAL_TASK_QUEUE` env var.

## PR / Links

-

## Attribution

-
