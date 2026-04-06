---
id: task.0295
type: task
title: "Phase 1: @cogni/node-streams package + operator SSE endpoint"
summary: "Create shared node-streams package (NodeStreamPort + Redis adapter + SSE encoder). Wire operator deployment matrix to publish via Redis and serve via SSE instead of direct HTTP polling."
outcome: "GET /api/v1/node/stream returns SSE events with deployment health data. Deployment matrix UI consumes SSE instead of polling."
status: done
priority: 0
rank: 1
estimate: 5
actor: ai
project: proj.operator-plane
project_id: proj.operator-plane
assignees: []
spec_refs:
  - data-streams-spec
  - architecture-spec
branch: integration/node-data-streams
created: 2026-04-04
updated: 2026-04-04
revision: 2
---

# Phase 1: @cogni/node-streams package + operator SSE endpoint

## Context

Poly has a proven 3-tier data-streams pattern (External → Redis → Postgres). RunStreamPort exists for per-run AI events. Neither is reusable for continuous node-level data streams. The deployment matrix (PR #714) uses naive HTTP polling — this task replaces that data layer with proper streaming.

## Design

### Outcome

`curl -N https://test.cognidao.org/api/v1/node/stream` receives `event: health\ndata: {"environment":"canary","status":"healthy",...}\n\n` within 30s.

### Approach

**Solution**: New `@cogni/node-streams` package with:

1. `NodeStreamPort` — distinct from `RunStreamPort` (continuous lifecycle, MAXLEN-trimmed, no terminal events)
2. `RedisNodeStreamAdapter` — XADD/XRANGE/XREAD, shares Redis mechanics but not RunStreamPort interface
3. `StreamSSEEncoder` — AsyncIterable → ReadableStream for SSE responses

**Reuses**: ioredis (existing), Redis XADD/XREAD patterns (proven in RedisRunStreamAdapter), SSE encoding (from runs stream route)

**Rejected**: Generalizing RunStreamPort — different lifecycle models (per-run terminal vs continuous trimmed). Distinct interfaces, can share internal Redis helpers later.

### Invariants

- [ ] REDIS_IS_STREAM_PLANE: All live data flows through Redis
- [ ] SSE_RESUME_SAFE: Last-Event-ID enables reconnection without data loss
- [ ] TEMPORAL_OWNS_IO: Source polling happens in Temporal activities
- [ ] NODE_STREAM_NOT_RUN_STREAM: Separate port interface from RunStreamPort — no terminal events, MAXLEN lifecycle
- [ ] REDIS_MAXLEN_ENFORCED: All XADD calls include MAXLEN

### Files

- Create: `packages/node-streams/src/node-stream.port.ts`
- Create: `packages/node-streams/src/node-event.ts`
- Create: `packages/node-streams/src/redis-node-stream.adapter.ts`
- Create: `packages/node-streams/src/sse-encoder.ts`
- Create: `packages/node-streams/tests/` — port contract tests
- Create: `nodes/node-template/app/src/app/api/v1/node/stream/route.ts` — SSE endpoint
- Modify: deployment matrix facade → consume from Redis instead of direct HTTP
- Modify: `services/scheduler-worker/` — add stream publish activity

### E2E Validation (AI-executable)

```bash
# Success criterion: SSE endpoint returns health events within 30s
curl -N -H "Accept: text/event-stream" https://test.cognidao.org/api/v1/node/stream \
  | timeout 30 head -5
# Expected: "event: health\ndata: {\"environment\":\"canary\",...}\n\n"
```

## Validation

- [ ] `packages/node-streams/` builds, exports port + adapter + encoder
- [ ] Port contract tests pass (publish → subscribe → receive)
- [ ] SSE endpoint at `/api/v1/node/stream` returns `text/event-stream`
- [ ] Last-Event-ID reconnection replays from cursor
- [ ] Deployment matrix consumes from SSE, not polling
- [ ] `pnpm check` passes

## Review Feedback

**Revision 1 — 2026-04-04**

### Blocking

1. **`sse-encoder.ts:53-58` — Silent error swallowing.** Non-AbortError exceptions close the SSE stream cleanly instead of signaling an error to the consumer. Fix: call `controller.error(error)` for non-abort errors so consumers can distinguish "stream ended" from "stream broke."

2. **`check:docs` fails — 16 header lint violations.** All new files in `packages/node-streams/src/` are missing required header labels (`Links`, `Side-effects`, negative-scope clause). `tsup.config.ts` is missing the header entirely. `redis-node-stream.adapter.ts` has `DH005 side-effects-invalid` — use the exact allowed format for side-effects.

### Suggestions (non-blocking)

- `package.json`: move `ioredis` to `peerDependencies` (runtime instance is constructor-injected).
- `redis-node-stream.adapter.ts:35`: `JSON.parse(data) as NodeEvent` has no runtime validation — consider a `type` field guard for Phase 2.
- Add `packages/node-streams/AGENTS.md` for consistency with other packages.
