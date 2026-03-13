---
id: task.0165
type: task
title: "Unified streaming API: chat endpoint refactor + reconnection + idempotency"
status: needs_triage
priority: 0
rank: 4
estimate: 5
summary: Refactor chat endpoint to start GraphRunWorkflow and subscribe to Redis Streams for SSE delivery; add reconnection endpoint and Idempotency-Key support
outcome: Chat POST starts Temporal workflow instead of inline execution; SSE streams from Redis; reconnection via GET /api/v1/ai/runs/{runId}/stream; idempotent run starts
spec_refs:
  - spec.unified-graph-launch
assignees: []
project: proj.unified-graph-launch
blocked_by:
  - task.0164
created: 2026-03-13
updated: 2026-03-13
labels:
  - ai-graphs
---

# Unified Streaming API

## Requirements

- `POST /api/v1/ai/chat` starts `GraphRunWorkflow` via Temporal client instead of calling `GraphExecutorPort` inline
- SSE response reads from Redis Streams (via `RunStreamPort.subscribe()`), not in-process memory (SSE_FROM_REDIS_NOT_MEMORY)
- AI SDK Data Stream Protocol preserved — `assistant-ui` client works without changes
- Thread persistence continues to work (user message saved before workflow start, assistant message saved after stream pump)
- New `GET /api/v1/ai/runs/{runId}/stream` endpoint for reconnection with `Last-Event-ID` header support
- Returns 410 Gone if Redis TTL expired (client falls back to thread history)
- `Idempotency-Key` header support on chat endpoint — same key → same workflow → same runId
- Stream latency ≤50ms added vs current inline path
- Multiple concurrent runs produce independent SSE streams

## Allowed Changes

- `apps/web/src/app/api/v1/ai/chat/route.ts` — refactor to workflow starter + Redis subscriber
- `apps/web/src/app/api/v1/ai/runs/[runId]/stream/route.ts` — new reconnection endpoint
- `apps/web/src/features/ai/services/ai_runtime.ts` — adapt to workflow-based execution
- `apps/web/src/contracts/` — update/add contracts as needed
- Tests

## Plan

- [ ] **Checkpoint 1: Chat endpoint refactor**
  - Replace inline `GraphExecutorPort` call with `workflowClient.start(GraphRunWorkflow)`
  - Subscribe to Redis Stream `run:{runId}` and pipe events through `createUIMessageStream` → SSE
  - Preserve thread persistence lifecycle (Phase 1: save user msg, Phase 2: save assistant msg after stream)
  - Validation: `pnpm check` passes, existing chat tests adapted

- [ ] **Checkpoint 2: Reconnection endpoint**
  - Create `GET /api/v1/ai/runs/{runId}/stream` with `Last-Event-ID` support
  - XRANGE replay from last cursor, then XREAD BLOCK for live events
  - Return 410 if stream expired
  - Validation: `pnpm check` passes, reconnection test passes

- [ ] **Checkpoint 3: Idempotency + integration tests**
  - Accept `Idempotency-Key` header, derive workflowId from it
  - Duplicate requests return same runId
  - End-to-end: chat POST → SSE stream → tokens arrive → reconnect works
  - Validation: `pnpm check` passes, stack tests pass

## Validation

**Command:**

```bash
pnpm check
pnpm test
```

**Expected:** Chat works end-to-end through Temporal + Redis path. Reconnection works. Idempotency prevents duplicate runs.

## Review Checklist

- [ ] **Work Item:** task.0165 linked in PR body
- [ ] **Spec:** SSE_FROM_REDIS_NOT_MEMORY, ONE_RUN_EXECUTION_PATH, IDEMPOTENT_RUN_START invariants upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
