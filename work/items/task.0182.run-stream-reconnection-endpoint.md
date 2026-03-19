---
id: task.0182
type: task
title: "Run stream reconnection endpoint — GET /api/v1/ai/runs/{runId}/stream"
status: needs_triage
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
updated: 2026-03-18
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
- Streams AI SDK Data Stream Protocol (same wire format as chat POST)

## Allowed Changes

- `apps/web/src/app/api/v1/ai/runs/[runId]/stream/route.ts` — new endpoint
- `apps/web/src/contracts/` — reconnection contract if needed
- Tests

## Plan

- [ ] **Checkpoint 1: Reconnection endpoint**
  - Create GET route with auth + runId ownership check
  - Subscribe to Redis via `RunStreamPort.subscribe(runId, signal, lastEventId)`
  - Pipe `RunStreamEntry` events through `createUIMessageStream` → SSE
  - Set `id` field on SSE events (Redis stream entry ID) for subsequent reconnection
  - Return 410 if stream key doesn't exist (expired)
  - Validation: `pnpm check` passes

- [ ] **Checkpoint 2: Tests**
  - Unit test: 410 for expired stream, auth enforcement
  - Stack test: start chat → disconnect → reconnect → resume from cursor
  - Validation: `pnpm check` passes, stack tests pass

## Validation

```bash
pnpm check
pnpm test
```

## Review Checklist

- [ ] **Spec:** SSE_FROM_REDIS_NOT_MEMORY invariant upheld
- [ ] **Tests:** reconnection + expiry + auth coverage
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
