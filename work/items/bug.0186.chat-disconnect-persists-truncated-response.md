---
id: bug.0186
type: bug
title: "Chat disconnect persists truncated assistant response — move thread persistence to execution layer"
status: needs_implement
priority: 0
rank: 99
estimate: 3
summary: Browser close mid-stream saves partial text because thread persistence lives in the chat route (dies on disconnect). Fix by moving assistant message persistence to the internal API route (execution layer), which drains the full stream regardless.
outcome: Assistant messages persisted by execution layer; chat route is a pure SSE pipe; graph_runs stores stateKey for thread↔run correlation
spec_refs:
  - spec.unified-graph-launch
assignees: []
credit:
project: proj.unified-graph-launch
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-19
updated: 2026-03-19
labels:
  - ai-graphs
  - p0
external_refs:
---

# Chat disconnect persists truncated assistant response

## Observed

When a user closes the browser mid-stream, the chat route saves a **truncated** assistant message to the thread. Reopening the conversation shows a cut-off response.

The execution finishes in Temporal — the internal API route drains the full stream to Redis including `assistant_final`. But the chat route's Redis consumer dies on `request.signal` abort, so the accumulator has partial text.

## Root Cause

Thread persistence is the only critical write that still lives in the HTTP request lifecycle. Everything else (execution, billing, run records) moved to Temporal/callbacks. The chat route's Phase 2 persistence at `route.ts:575` is aspirationally "disconnect-safe" but relies on an accumulator that dies with the request.

## Design

### Outcome

Assistant messages are always persisted with full content, regardless of client connection state. Runs are correlated with threads via `stateKey` on `graph_runs`.

### Approach

**Solution:** Move assistant message persistence from the chat route to the internal API route (execution layer). The internal API route already drains the full executor stream for Redis publishing — add accumulation and thread persistence alongside it. Add `stateKey` column to `graph_runs` for thread↔run correlation.

**Reuses:**

- Existing stream drain loop in internal API route (`route.ts:487-507`) — accumulate alongside Redis publish
- Existing `ThreadPersistencePort` and `threadPersistenceForUser()` from container
- Existing UIMessage assembly pattern (same as current chat route accumulator)

**Rejected:**

- _Signal decoupling in chat route_ — keeps persistence in the wrong layer; band-aid that doesn't fix the architectural issue. The chat route should be a pure SSE pipe.
- _Separate persistence subscriber process_ — more moving parts, needs thread context plumbed through yet another system
- _Temporal activity for persistence_ — over-engineered; the internal API route already has the stream and context

### Architecture after fix

```
Chat route (apps/web)          Internal API route (apps/web)
─────────────────────          ──────────────────────────────
Phase 1: save user msg         Drains executor stream:
Start workflow                   → publish each event to Redis
Subscribe to Redis               → accumulate text + tool parts
Pipe events → SSE               → on stream end: persist assistant msg to thread
(pure pipe, no persistence)      → update graph_runs status
```

### Changes

**1. Add `stateKey` to `graph_runs`**

- `packages/db-schema/src/scheduling.ts` — add `stateKey: text("state_key")` column to `graphRuns`
- `packages/scheduler-core/src/types.ts` — add `stateKey: string | null` to `GraphRun` interface
- `packages/scheduler-core/src/ports/schedule-run.port.ts` — add `stateKey?: string` to `createRun` params
- `packages/db-client/src/adapters/drizzle-run.adapter.ts` — persist stateKey in `createRun`, return in `toRun`
- Migration: `ALTER TABLE graph_runs ADD COLUMN state_key TEXT; CREATE INDEX graph_runs_state_key_idx ON graph_runs (state_key);`

**2. Move assistant persistence to internal API route**

- `apps/web/src/app/api/internal/graphs/[graphId]/runs/route.ts`:
  - Accumulate `text_delta`, `tool_call_start`, `tool_call_result`, `assistant_final` events alongside Redis publish (same loop)
  - After stream drain + `result.final` resolves: load thread via `threadPersistenceForUser(actorUserId)`, append assistant UIMessage, save
  - Needs: `stateKey` (already in input), `actorUserId` (already in input)

**3. Strip Phase 2 from chat route**

- `apps/web/src/app/api/v1/ai/chat/route.ts`:
  - Remove: `accumulatedText`, `assistantFinalContent`, `accToolParts`, `toolPartIndexByCallId`, `pumpDone`, `resolvePumpDone`, `persistAfterPump` (~100 lines)
  - Keep: Phase 1 (user message save), SSE writer (text_delta, tool events, status, reconciliation for display only)
  - The `for await` loop becomes pure SSE piping — no persistence responsibility
  - `request.signal` abort cleanly ends the SSE stream; no data loss because persistence is elsewhere

### Invariants

- [ ] PUMP_TO_COMPLETION_VIA_REDIS: execution drains fully regardless of SSE subscriber (unchanged)
- [ ] PERSIST_AFTER_PUMP: assistant message saved by execution layer after full drain (fixed — was broken)
- [ ] SSE_FROM_REDIS_NOT_MEMORY: chat route reads from Redis, not in-process (unchanged)
- [ ] SINGLE_RUN_LEDGER: graph_runs gains stateKey for thread correlation (additive)
- [ ] SIMPLE_SOLUTION: no new abstractions, reuses existing stream loop + ThreadPersistencePort

### Files

- Modify: `packages/db-schema/src/scheduling.ts` — add stateKey column
- Modify: `packages/scheduler-core/src/types.ts` — add stateKey to GraphRun
- Modify: `packages/scheduler-core/src/ports/schedule-run.port.ts` — add stateKey to createRun params
- Modify: `packages/db-client/src/adapters/drizzle-run.adapter.ts` — persist + return stateKey
- Modify: `apps/web/src/app/api/internal/graphs/[graphId]/runs/route.ts` — add accumulator + thread persistence after stream drain
- Modify: `apps/web/src/app/api/v1/ai/chat/route.ts` — strip Phase 2, pure SSE pipe
- Create: migration for stateKey column + index
- Test: disconnect mid-stream → verify full response persisted

## Allowed Changes

- `packages/db-schema/src/scheduling.ts` — stateKey column
- `packages/scheduler-core/src/types.ts` — GraphRun type
- `packages/scheduler-core/src/ports/schedule-run.port.ts` — createRun params
- `packages/db-client/src/adapters/drizzle-run.adapter.ts` — stateKey in adapter
- `apps/web/src/app/api/internal/graphs/[graphId]/runs/route.ts` — accumulator + persistence
- `apps/web/src/app/api/v1/ai/chat/route.ts` — strip Phase 2
- `apps/web/src/bootstrap/container.ts` — if wiring changes needed
- Drizzle migration
- Tests

## Plan

- [ ] **Checkpoint 1: stateKey on graph_runs**
  - Add column + index migration, schema, type, port, adapter
  - Pass stateKey through in facade → workflow → internal API
  - Validation: `pnpm check`, existing tests pass

- [ ] **Checkpoint 2: Persist assistant in execution layer**
  - Add accumulator to internal API route stream drain loop
  - After drain: load thread, append assistant UIMessage, save
  - Validation: `pnpm check`, manual test (chat → verify thread persisted)

- [ ] **Checkpoint 3: Strip Phase 2 from chat route**
  - Remove accumulator + persistAfterPump block
  - Chat route becomes pure SSE pipe
  - Validation: `pnpm check`, disconnect test (close browser → reopen → full response visible)

## Validation

```bash
pnpm check
pnpm test
```

**Expected:** Chat works normally. Browser disconnect mid-stream → reopen → full assistant response visible.

## Review Checklist

- [ ] **Work Item:** bug.0186 linked in PR body
- [ ] **Spec:** PERSIST_AFTER_PUMP invariant holds after disconnect
- [ ] **Tests:** disconnect + full persistence test
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
