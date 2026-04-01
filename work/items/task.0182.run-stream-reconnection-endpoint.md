---
id: task.0182
type: task
title: "Run stream reconnection endpoint — GET /api/v1/ai/runs/{runId}/stream"
status: done
revision: 1
branch: feat/task.0182-run-stream-reconnection
priority: 1
rank: 5
estimate: 2
summary: SSE reconnection endpoint that replays from Redis Streams cursor position; enables browser close → reopen without losing stream state
outcome: GET /api/v1/ai/runs/{runId}/stream with Last-Event-ID replay; 410 Gone when Redis TTL expired
spec_refs:
  - spec.unified-graph-launch
assignees: []
project: proj.unified-graph-launch
blocked_by:
  - task.0177
created: 2026-03-18
updated: 2026-03-19
labels:
  - ai-graphs
---

# Run Stream Reconnection Endpoint

## Context

After task.0177, chat SSE streams from Redis via `RunStreamPort.subscribe()`. Reconnection is a natural follow-on: if the browser closes mid-stream, the client can reconnect to the same Redis stream key and resume from where it left off. V0 scope is reconnecting to streams the UI itself initiated — no cross-session or cross-device reconnection.

## Requirements

- New `GET /api/v1/ai/runs/{runId}/stream` endpoint
- Accepts `Last-Event-ID` header (SSE spec) — maps to Redis stream entry ID
- XRANGE replay from cursor, then XREAD BLOCK for live events
- Returns 410 Gone if Redis stream TTL expired (client falls back to thread history from DB)
- Auth: session-required (same user who started the run)
- Validates `runId` belongs to the authenticated user (via `graph_runs` table lookup)
- Streams raw SSE with AiEvent JSON (id: Redis stream ID, event: type, data: JSON)

## Allowed Changes

- `apps/operator/src/app/api/v1/ai/runs/[runId]/stream/route.ts` — new endpoint
- `apps/operator/src/contracts/` — reconnection contract if needed
- Tests

## Plan

- [x] **Checkpoint 1: Port extension + Route**
  - Milestone: GET /api/v1/ai/runs/{runId}/stream returns SSE from Redis Streams
  - Invariants: SSE_FROM_REDIS_NOT_MEMORY, REDIS_IS_STREAM_PLANE
  - Todos:
    - [x] Add `getRunByRunId` to `GraphRunRepository` port (scheduler-core) — needed for ownership check
    - [x] Implement `getRunByRunId` in `DrizzleGraphRunAdapter` (db-client)
    - [x] Add `streamLength` to `RunStreamPort` (graph-execution-core) — needed for 410 detection
    - [x] Implement `streamLength` in `RedisRunStreamAdapter`
    - [x] Create `apps/operator/src/contracts/runs.stream.v1.contract.ts` — path param schema
    - [x] Create `apps/operator/src/app/api/v1/ai/runs/[runId]/stream/route.ts` — GET endpoint
  - Validation:
    - [x] Route compiles and serves SSE events from Redis stream
    - Test levels:
      - [x] unit: `pnpm test` passes (no regressions)
      - [x] static: `pnpm check` passes

- [x] **Checkpoint 2: Tests**
  - Milestone: Contract test verifies auth, ownership, 410, and SSE wire format
  - Todos:
    - [x] Contract test for endpoint behavior (8 tests)
  - Validation:
    - Test levels:
      - [x] contract: route contract tests pass
      - [x] static: `pnpm check` passes

## Validation

```bash
pnpm check
pnpm test
```

## Review Checklist

- [ ] **Spec:** SSE_FROM_REDIS_NOT_MEMORY invariant upheld
- [ ] **Tests:** reconnection + expiry + auth coverage
- [ ] **Reviewer:** assigned and approved

## Review Feedback (revision 1)

**Blocking:**

1. **`SYSTEM_ACTOR` in user-facing route** (`route.ts:18,70`): `@cogni/ids/system` AGENTS.md says user-facing routes must not import `SYSTEM_ACTOR`. Use `userActor(toUserId(sessionUser.id))` from `@cogni/ids` instead.

2. **Double `controller.close()`** (`route.ts:134,141`): Normal completion calls `close()` at L134. If a later error reaches the catch block, L141 calls `close()` again — which throws on an already-closed controller. Add a guard.

**Non-blocking:**

3. Work item L38 says "AI SDK Data Stream Protocol" but implementation uses raw SSE (approved in design review). Update requirement text.
4. Add `.limit(1)` to `getRunByRunId` query for clarity.
5. Add test for 401 unauthenticated access.

## PR / Links

- https://github.com/Cogni-DAO/node-template/pull/603

## Attribution

-
