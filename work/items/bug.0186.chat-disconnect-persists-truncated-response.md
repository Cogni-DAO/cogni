---
id: bug.0186
type: bug
title: "Chat disconnect persists truncated assistant response — move thread persistence to execution layer"
status: done
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
branch: fix/chat-0186
pr:
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-03-19
updated: 2026-03-20
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
Chat route (apps/operator)          Internal API route (apps/operator)
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

- `apps/operator/src/app/api/internal/graphs/[graphId]/runs/route.ts`:
  - Accumulate `text_delta`, `tool_call_start`, `tool_call_result`, `assistant_final` events alongside Redis publish (same loop)
  - After stream drain + `result.final` resolves: load thread via `threadPersistenceForUser(actorUserId)`, append assistant UIMessage, save
  - Needs: `stateKey` (already in input), `actorUserId` (already in input)

**3. Strip Phase 2 from chat route**

- `apps/operator/src/app/api/v1/ai/chat/route.ts`:
  - Remove: `accumulatedText`, `assistantFinalContent`, `accToolParts`, `toolPartIndexByCallId`, `pumpDone`, `resolvePumpDone`, `persistAfterPump` (~100 lines)
  - Keep: Phase 1 (user message save), SSE writer (text_delta, tool events, status, reconciliation for display only)
  - The `for await` loop becomes pure SSE piping — no persistence responsibility
  - `request.signal` abort cleanly ends the SSE stream; no data loss because persistence is elsewhere

### Invariants

- [ ] PUMP_TO_COMPLETION_VIA_REDIS: execution drains fully regardless of SSE subscriber (unchanged)
- [ ] PERSIST_AFTER_PUMP: assistant message saved by execution layer after full drain (fixed — was broken)
- [ ] SSE_FROM_REDIS_NOT_MEMORY: chat route reads from Redis, not in-process (unchanged)
- [ ] SINGLE_RUN_LEDGER: graph_runs gains stateKey for thread correlation (additive)
- [ ] IDEMPOTENT_THREAD_PERSIST: assistant message ID = `assistant-{runId}` (deterministic). On retry, check if message already exists in thread before appending. Internal API route can be retried by Temporal — must not duplicate messages.
- [ ] SHARED_EVENT_ASSEMBLER: one function `assembleAssistantMessage(runId, events)` → UIMessage. Used by internal route for persistence. No ad-hoc duplication.
- [ ] TERMINAL_ONLY_PERSIST: persist assistant message only when `assistant_final` received (authoritative success). If run errors after partial deltas, do NOT persist a fake assistant message — the error is the terminal state.
- [ ] STATEKEY_NULLABLE: thread persistence only when stateKey + real user context present. Null stateKey = no thread to persist (e.g., headless API calls).

### Files

- Modify: `packages/db-schema/src/scheduling.ts` — add stateKey column
- Modify: `packages/scheduler-core/src/types.ts` — add stateKey to GraphRun
- Modify: `packages/scheduler-core/src/ports/schedule-run.port.ts` — add stateKey to createRun params
- Modify: `packages/db-client/src/adapters/drizzle-run.adapter.ts` — persist + return stateKey
- Create: `apps/operator/src/features/ai/services/assemble-assistant-message.ts` — shared AiEvent[] → UIMessage builder
- Modify: `apps/operator/src/app/api/internal/graphs/[graphId]/runs/route.ts` — accumulate + persist using shared assembler
- Modify: `apps/operator/src/app/api/v1/ai/chat/route.ts` — strip Phase 2, pure SSE pipe
- Create: migration for stateKey column + index
- Test: idempotent persistence, terminal-only semantics

## Allowed Changes

- `packages/db-schema/src/scheduling.ts` — stateKey column
- `packages/scheduler-core/src/types.ts` — GraphRun type
- `packages/scheduler-core/src/ports/schedule-run.port.ts` — createRun params
- `packages/db-client/src/adapters/drizzle-run.adapter.ts` — stateKey in adapter
- `apps/operator/src/features/ai/services/assemble-assistant-message.ts` — shared event→message builder (new)
- `apps/operator/src/features/ai/public.server.ts` — export assembler
- `apps/operator/src/app/api/internal/graphs/[graphId]/runs/route.ts` — accumulate + persist
- `apps/operator/src/app/api/v1/ai/chat/route.ts` — strip Phase 2
- `apps/operator/src/bootstrap/container.ts` — if wiring changes needed
- Drizzle migration
- Tests

## Plan

- [ ] **Checkpoint 1: stateKey on graph_runs**
  - Milestone: graph_runs has stateKey column; runs store thread correlation
  - Invariants: SINGLE_RUN_LEDGER, STATEKEY_NULLABLE
  - Todos:
    - [ ] Add `stateKey: text("state_key")` to `packages/db-schema/src/scheduling.ts`
    - [ ] Add index `graph_runs_state_key_idx` in same table definition
    - [ ] Add `stateKey: string | null` to `GraphRun` in `packages/scheduler-core/src/types.ts`
    - [ ] Add `stateKey?: string` to `createRun` params in `packages/scheduler-core/src/ports/schedule-run.port.ts`
    - [ ] Persist stateKey in `DrizzleGraphRunAdapter.createRun()` and `toRun()`
    - [ ] Generate Drizzle migration: `pnpm db:generate`
  - Validation:
    - [ ] `pnpm check` passes
    - [ ] Existing tests pass (no regressions)

- [ ] **Checkpoint 2: Shared event assembler + execution-layer persistence**
  - Milestone: internal API route persists assistant message after full stream drain
  - Invariants: SHARED_EVENT_ASSEMBLER, IDEMPOTENT_THREAD_PERSIST, TERMINAL_ONLY_PERSIST, STATEKEY_NULLABLE
  - Todos:
    - [ ] Create `apps/operator/src/features/ai/services/assemble-assistant-message.ts`
      - `assembleAssistantMessage(runId: string, events: AiEvent[]): UIMessage | null`
      - Returns null if no `assistant_final` received (error runs)
      - Message ID = `assistant-${runId}` (deterministic, idempotent)
      - Handles text + tool_call_start + tool_call_result → UIMessage parts
    - [ ] Export from `apps/operator/src/features/ai/public.server.ts`
    - [ ] In internal API route stream drain loop: collect events into array
    - [ ] After drain + final: call assembler, persist thread if stateKey present
      - Load thread, check if `assistant-${runId}` already exists (idempotent guard)
      - If not present: append + save with ThreadConflictError retry
    - [ ] Unit test for assembler
  - Validation:
    - [ ] `pnpm check` passes
    - [ ] Unit test: assembler produces correct UIMessage from events
    - [ ] Unit test: assembler returns null on error-only streams

- [ ] **Checkpoint 3: Strip Phase 2 from chat route**
  - Milestone: chat route is pure SSE pipe; no persistence responsibility
  - Invariants: PERSIST_AFTER_PUMP (now in execution layer)
  - Todos:
    - [ ] Remove from chat route: `accumulatedText`, `assistantFinalContent`, `accToolParts`, `toolPartIndexByCallId`, `pumpDone`, `resolvePumpDone`, `persistAfterPump` block
    - [ ] Remove `redactSecretsInMessages` import (no longer used in route)
    - [ ] Keep: Phase 1 (user message save), SSE writer, reconciliation for display
    - [ ] The `for await` loop keeps writing to SSE; `request.signal.aborted` break is now safe (no data loss)
  - Validation:
    - [ ] `pnpm check` passes
    - [ ] Existing chat streaming tests pass

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

## Review Feedback (revision 1)

**Blocking:**

1. **stateKey never populated** — `CreateGraphRunInput` in `services/scheduler-worker/src/activities/index.ts:59-70` missing `stateKey`. `createGraphRunActivity()` at `graph-run.workflow.ts:149` doesn't pass it. Every graph_runs row has `state_key = NULL`. Fix: add `stateKey?: string` to `CreateGraphRunInput`, pass through workflow, forward to `runAdapter.createRun()`.

**Non-blocking:**

2. `accumulatedEvents` array grows unbounded — consider only accumulating persistence-relevant events (tool_call_start, tool_call_result, assistant_final).

## PR / Links

- https://github.com/Cogni-DAO/node-template/pull/607

## Attribution

-
