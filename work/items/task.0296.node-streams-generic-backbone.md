---
id: task.0296
type: task
title: "Phase 2: Generic backbone + operator/poly publishers + SSE endpoint"
summary: "Make @cogni/node-streams generic over event type. Add SSE route to all nodes. Wire operator publishers (health 60s) and poly publishers (health 60s, market snapshot 60s) via setInterval."
outcome: "GET /api/v1/node/stream on operator returns health events. GET /api/v1/node/stream on poly returns health + market events. Both support Last-Event-ID reconnection."
status: done
priority: 0
rank: 2
estimate: 5
actor: ai
project: proj.operator-plane
project_id: proj.operator-plane
assignees: []
spec_refs:
  - data-streams-spec
  - architecture-spec
branch: feat/task-0281-node-streams-pkg
pr: https://github.com/Cogni-DAO/node-template/pull/752
created: 2026-04-04
updated: 2026-04-04
revision: 0
---

# Phase 2: Generic Backbone + Operator/Poly Publishers + SSE Endpoint

## Context

Phase 1 created `@cogni/node-streams` with a closed `NodeEvent` union (health | ci_status | deploy). The package works but isn't extensible — poly can't add market-specific events without polluting the shared package. This phase makes the backbone generic and wires the first two nodes.

Spec: [data-streams-spec](../../docs/spec/data-streams.md)

## Design

### Outcome

```bash
# Operator: health + CI events
curl -N https://test.cognidao.org/api/v1/node/stream
# → event: health\ndata: {"status":"healthy","environment":"canary",...}\n\n
# → event: ci_status\ndata: {"branch":"canary","conclusion":"success",...}\n\n

# Poly: health + market events
curl -N https://poly-test.cognidao.org/api/v1/node/stream
# → event: health\ndata: {"status":"healthy",...}\n\n
# → event: snapshot\ndata: {"provider":"polymarket","markets":[...]}\n\n
```

### Approach

**Checkpoint 1 — Generic port** (package change)

- Make `NodeStreamPort<T extends NodeEventBase = NodeEventBase>` generic
- Make `RedisNodeStreamAdapter<T>` and `encodeSSE<T>` generic
- Keep `HealthEvent`, `CiStatusEvent`, `DeployEvent` in shared package as common events
- Keep `NodeEvent` as convenience alias for the common set
- No breaking changes (default generic parameter = current behavior)
- Update existing tests

**Checkpoint 2 — SSE route** (node-template)

- Add `GET /api/v1/node/stream` route in node-template
- Wire `NodeStreamPort` into container with stream key `node:{nodeId}:events`
- Support `Last-Event-ID` header for cursor replay
- **Require session auth** — follow auth pattern from `runs/[runId]/stream/route.ts` (endpoint is Caddy-exposed)
- Follow SSE response pattern from same route (Content-Type, Cache-Control, Connection headers)

**Checkpoint 3 — Operator publishers** (operator node)

- Health probe: `setInterval` every 60s, probe own `/readyz`
- CI status: `setInterval` every 5min, GitHub Actions API
- Deploy events: webhook handler publishes on occurrence (if webhook infra exists, else defer)
- Place in `bootstrap/publishers.ts` (NOT `bootstrap/jobs/` — jobs are ops-triggered, not process-lifetime)
- Call `startPublishers()` from container.ts after wiring, pass shutdown signal
- Every callback must catch + log errors (failed probe = logged warning, not crash)

**Checkpoint 4 — Poly publishers** (poly node)

- Health probe: `setInterval` every 60s, probe own `/readyz`
- Market snapshot: `setInterval` every 60s, `MarketCapability.listMarkets()`
- Define `MarketSnapshotEvent` in poly node (NOT in shared package)
- Define `PolyEvent = HealthEvent | MarketSnapshotEvent` union in poly
- Same error handling pattern as operator: catch + log in every callback

**Checkpoint 5 — Verify end-to-end**

- `pnpm check` passes
- `curl -N localhost:3000/api/v1/node/stream` returns events (dev stack)
- Last-Event-ID reconnection works

### Rejected

- **Attribution events** — separate pipeline, separate lifecycle. Not part of the monitoring backbone
- **Temporal workflows for publishing** — overkill for lightweight polling. `setInterval` is sufficient
- **Per-event-type stream keys** — multiplexing on single stream is simpler for consumers

### Files

- Modify: `packages/node-streams/src/node-stream.port.ts` — add generic parameter
- Modify: `packages/node-streams/src/redis-node-stream.adapter.ts` — add generic parameter
- Modify: `packages/node-streams/src/sse-encoder.ts` — add generic parameter
- Modify: `packages/node-streams/src/index.ts` — export updated types
- Create: `nodes/node-template/app/src/app/api/v1/node/stream/route.ts` — SSE endpoint with session auth
- Create: `nodes/operator/app/src/bootstrap/publishers.ts` — health + CI publishers
- Create: `nodes/poly/app/src/bootstrap/publishers.ts` — health + market publishers
- Create: `nodes/poly/app/src/types/poly-events.ts` — MarketSnapshotEvent, PolyEvent union
- Modify: `nodes/operator/app/src/bootstrap/container.ts` — wire NodeStreamPort + call startPublishers
- Modify: `nodes/poly/app/src/bootstrap/container.ts` — wire NodeStreamPort + call startPublishers

### Design Review Feedback (2026-04-04)

Concerns addressed from design review — all incorporated above:

1. **Publisher placement**: `bootstrap/publishers.ts`, NOT `bootstrap/jobs/` (jobs = ops-triggered, publishers = process-lifetime)
2. **Error handling**: Every publisher callback catches + logs. Failed probe = warning, not crash
3. **SSE auth**: Session auth required (Caddy exposes endpoint publicly)
4. **Interval drift**: Acceptable at ~2 events/min. Document choice, switch to setTimeout chaining if any publisher exceeds 30s
5. **Scope size**: 5 checkpoints is large but interdependent. Consider splitting PRs (1-2 then 3-5) if review cycles are slow

## Invariants

- [ ] GENERIC_PORT: NodeStreamPort<T> has zero domain knowledge
- [ ] DOMAIN_EVENTS_IN_NODE: MarketSnapshotEvent defined in poly, not shared package
- [ ] ONE_STREAM_PER_NODE: Single stream key `node:{nodeId}:events`
- [ ] MINIMAL_POLLING: Health 60s, CI 5min, market 60s
- [ ] PUBLISHERS_ARE_INTERVALS: setInterval in bootstrap, no Temporal
- [ ] SSE_RESUME_SAFE: Last-Event-ID reconnection works

## Validation

- [ ] `NodeStreamPort<T>` compiles with custom event types
- [ ] SSE endpoint at `/api/v1/node/stream` returns `text/event-stream`
- [ ] Operator stream includes health + ci_status events
- [ ] Poly stream includes health + snapshot events
- [ ] Last-Event-ID reconnection replays from cursor
- [ ] `pnpm check` passes
