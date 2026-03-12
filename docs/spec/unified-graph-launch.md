---
id: spec.unified-graph-launch
type: spec
title: Unified Graph Launch Design
status: draft
spec_state: draft
trust: draft
summary: All graph execution flows through GraphRunWorkflow in Temporal — Redis Streams bridge real-time SSE streaming
read_when: Adding new graph trigger types, modifying execution paths, or implementing idempotency
implements: []
owner: cogni-dev
created: 2026-02-03
verified: null
tags:
  - ai-graphs
  - scheduler
---

# Unified Graph Launch Design

## Context

Graph execution currently has two paths: API handlers call `GraphExecutorPort` inline, while scheduled runs go through Temporal workflows via internal API. This dual-path creates inconsistency in billing, observability, and durability guarantees. Unifying all execution through a single Temporal workflow eliminates these gaps.

## Goal

Define the invariants, schema, and architecture for routing all graph execution (API immediate, scheduled, webhook) through a single `GraphRunWorkflow` in Temporal, ensuring idempotent run starts, auditable trigger provenance, and consistent billing.

## Non-Goals

- Event bus / rule engine — not building generic event routing
- Auto-execution of actions — human review stays for governance
- WorkItemPort — MCP-only for Plane integration
- Incident router integration — governance uses same workflow but separate trigger logic

## Core Invariants

1. **ONE_RUN_EXECUTION_PATH**: Every graph execution is executed by `GraphRunWorkflow` in Temporal. API handlers start workflows, never call `GraphExecutorPort` directly.

2. **TRIGGERS_ONLY_START_RUNS**: Trigger handlers (API, webhook, schedule) create run records and start workflows. They do not execute graphs.

3. **IDEMPOTENT_RUN_START**: `workflowId = graph-run:{tenantId}:{idempotencyKey}`. Starting the same run twice results in at most one workflow execution.

4. **WORKFLOW_DETERMINISM**: Workflows orchestrate only. All I/O, tool calls, and LLM calls happen in Activities (per TEMPORAL_PATTERNS.md).

5. **RUN_CONTEXT_REQUIRED**: Every run has explicit context: `tenantId`, `executionGrantRef`, `runKind`, `initiator`, and `correlationIds`.

6. **AUDITABLE_TRIGGER_PROVENANCE**: Each run stores trigger provenance (`triggerSource`, `triggerRef`, `requestedBy`).

7. **REDIS_IS_STREAM_PLANE**: Redis holds only ephemeral stream data (events in-flight). PostgreSQL is the durable source of truth for all persisted state. Redis loss = stream interruption, not data loss.

8. **STREAM_PUBLISH_IN_ACTIVITY**: The Temporal activity (not the workflow) publishes events to Redis. Activities are non-deterministic I/O — Redis calls belong here.

9. **PUMP_TO_COMPLETION_VIA_REDIS**: The activity pumps `AsyncIterable<AiEvent>` to completion and publishes each event to Redis, regardless of subscriber count. Same billing safety guarantee as today's `RunEventRelay`.

10. **SSE_FROM_REDIS_NOT_MEMORY**: SSE endpoints read from Redis Streams (not in-process memory). This enables cross-process streaming and reconnection.

## Schema

**Option A: Extend `schedule_runs`** (if `graph_runs` not yet created)

| Column           | Type | Notes                                                      |
| ---------------- | ---- | ---------------------------------------------------------- |
| `run_kind`       | text | `user_immediate` \| `system_scheduled` \| `system_webhook` |
| `trigger_source` | text | `api` \| `temporal_schedule` \| `webhook:{type}`           |
| `trigger_ref`    | text | Upstream delivery ID / schedule ID                         |
| `requested_by`   | text | User ID or `cogni_system`                                  |

**Option B: New `graph_runs` table** (preferred if P1 persistence lands)

Fold trigger fields into the run persistence table per GRAPH_EXECUTION.md P1.

**Forbidden:**

- `run_requests` as separate table (adds indirection without value if `graph_runs` exists)
- Duplicating execution logic between scheduled and immediate paths

## Design

### Key Decisions

#### 1. Execution Path Unification

| Trigger Type        | Current Path                                               | Unified Path                                           |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| **API (immediate)** | HTTP → `AiRuntime` → `GraphExecutorPort` (inline)          | HTTP → `GraphRunWorkflow` → `executeGraphActivity`     |
| **Scheduled**       | Temporal → `GovernanceScheduledRunWorkflow` → internal API | Temporal → `GraphRunWorkflow` → `executeGraphActivity` |
| **Webhook**         | Not implemented                                            | HTTP → `GraphRunWorkflow` → `executeGraphActivity`     |

**Rule:** All paths converge at `GraphRunWorkflow`. HTTP handlers become workflow starters, not executors.

#### 2. Workflow Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ TRIGGER LAYER (decides when)                                        │
│ ─────────────────────────────                                       │
│ • POST /api/v1/ai/chat       → workflowClient.start(GraphRunWorkflow)
│ • Temporal Schedule fires    → starts GraphRunWorkflow              │
│ • Webhook handler (P2)       → workflowClient.start(GraphRunWorkflow)
│                                                                     │
│ All triggers:                                                       │
│   1. Validate auth/grant                                            │
│   2. Generate idempotencyKey (or use client-supplied)               │
│   3. Start workflow with workflowId = graph-run:{tenant}:{key}      │
│   4. Return { runId, workflowId } immediately                       │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ GraphRunWorkflow (Temporal)                                         │
│ ───────────────────────────                                         │
│ Input: { runId, graphId, input, grantRef, triggerContext }          │
│                                                                     │
│ 1. Activity: validateGrantActivity(grantRef)                        │
│ 2. Activity: createRunLedgerActivity(runId, triggerContext)         │
│ 3. Activity: executeGraphActivity(runId, graphId, input)            │
│    └─► POST /api/internal/graphs/{graphId}/runs (existing)          │
│ 4. Activity: finalizeRunActivity(runId, result)                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ EXECUTION LAYER (how — unchanged)                                   │
│ ─────────────────────────────────                                   │
│ • Internal API validates grant (defense-in-depth)                   │
│ • Calls GraphExecutorPort.runGraph()                                │
│ • Billing via commitUsageFact() (existing)                          │
│ • Returns { runId, traceId, ok, errorCode? }                        │
└─────────────────────────────────────────────────────────────────────┘
```

**Why this approach?** Reuses existing internal API and billing infrastructure. No changes to `GraphExecutorPort` or billing paths.

#### 3. Idempotency Key Strategy

| Trigger                    | Idempotency Key                                        |
| -------------------------- | ------------------------------------------------------ |
| **API (client-supplied)**  | `Idempotency-Key` header value                         |
| **API (server-generated)** | `api:{requestId}` (one-time execution)                 |
| **Scheduled**              | `schedule:{scheduleId}:{TemporalScheduledStartTime}`   |
| **Webhook**                | `webhook:{deliveryId}` or `webhook:{source}:{eventId}` |

**workflowId derivation:** `graph-run:{tenantId}:{idempotencyKey}`

**Never** use `Date.now()` or random values for scheduled/webhook keys.

#### 4. Streaming Strategy — Redis Streams

**Challenge:** Current API returns SSE stream directly. Temporal workflows run in worker processes (potentially different machines). Putting Temporal between HTTP handler and `GraphExecutorPort` breaks the direct SSE pipe.

**Solution:** Redis Streams as the ephemeral event bus between execution (Temporal activity) and delivery (SSE endpoint).

**Three-plane separation:**

| Plane       | Technology    | Responsibility                                      |
| ----------- | ------------- | --------------------------------------------------- |
| **Control** | Temporal      | Run lifecycle, orchestration, retries, idempotency  |
| **Stream**  | Redis Streams | Real-time event transport (ephemeral, ≤1h TTL)      |
| **Durable** | PostgreSQL    | Threads, run records, billing receipts, transcripts |

**Data flow:**

```
┌─ TRIGGER ──────────────────────────────────────────────────────────────┐
│ POST /api/v1/ai/chat                                                   │
│   1. Validate auth, generate runId + idempotencyKey                    │
│   2. workflowClient.start(GraphRunWorkflow, { runId, ... })            │
│   3. Subscribe to Redis Stream run:{runId} (XREAD BLOCK)               │
│   4. Pipe Redis events → createUIMessageStream → SSE response          │
│                                                                        │
│ From client's perspective: POST returns SSE stream (unchanged)         │
└────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ ORCHESTRATION (Temporal Worker) ──────────────────────────────────────┐
│ GraphRunWorkflow                                                       │
│   1. validateGrantActivity(grantRef)                                   │
│   2. createRunRecordActivity(runId, triggerContext)                     │
│   3. executeAndStreamActivity(runId, graphId, input)                   │
│      └─ GraphExecutorPort.runGraph() → pump AsyncIterable<AiEvent>     │
│      └─ Each event → XADD run:{runId} * type <t> data <json>          │
│      └─ On done/error → XADD terminal event + EXPIRE key 3600s        │
│   4. finalizeRunActivity(runId, result)                                │
└────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STREAM PLANE (Redis) ────────────────────────────────────────────────┐
│ Key: run:{runId}                                                       │
│ Format: XADD run:{runId} * type <event_type> data <json_payload>       │
│ Each entry gets a Redis-assigned stream ID (used as SSE Last-Event-ID) │
│ MAXLEN ~10000 per stream (safety cap)                                  │
│ EXPIRE 3600s after terminal event (auto-cleanup)                       │
└────────────────────────────────────────────────────────────────────────┘
```

**Why Redis Streams (not Pub/Sub):** Redis Pub/Sub is fire-and-forget (at-most-once). Streams are an append-log with cursor-based reads — supports replay from any position, enabling reconnection after browser close.

**Reconnection:** New `GET /api/v1/ai/runs/{runId}/stream` endpoint. Accepts `Last-Event-ID` header (SSE spec). Does `XRANGE` from that ID to catch up, then `XREAD BLOCK` for new events. Runs are reconnectable for as long as the Redis Stream exists (TTL ≤1h after completion).

**Multiple concurrent runs:** Each run has its own Redis Stream key. UI can open multiple SSE connections to different runIds simultaneously.

**Billing safety:** `executeAndStreamActivity` pumps `AsyncIterable<AiEvent>` to completion regardless of Redis subscriber count. `BillingGraphExecutorDecorator` intercepts `usage_report` events in the decorator stack before they reach the activity's publish loop. Same PUMP_TO_COMPLETION invariant as today's `RunEventRelay`.

**What stays the same:**

- `GraphExecutorPort` interface — unchanged
- Decorator stack (billing, observability, preflight) — unchanged
- `NamespaceGraphRouter` — unchanged
- Graph providers (InProc, LangGraph, Sandbox) — unchanged
- Thread persistence in PostgreSQL — unchanged
- Client-side `assistant-ui` integration — POST still returns SSE via AI SDK Data Stream Protocol

**What changes:**

- `POST /api/v1/ai/chat` → starts workflow, subscribes to Redis Stream, returns SSE
- New `executeAndStreamActivity` → publishes events to Redis Stream as it pumps
- `RunEventRelay` → replaced by Redis Stream subscribe in SSE endpoints
- New `GET /api/v1/ai/runs/{runId}/stream` endpoint for reconnection
- New `RunStreamPort` + `RedisRunStreamAdapter` (hexagonal port/adapter)
- Docker compose: add Redis 7
- New dependency: `ioredis`

#### 5. RunStreamPort (Hexagonal Boundary)

```typescript
// src/ports/run-stream.port.ts
interface RunStreamPort {
  /** Publish a single event to the run's stream. */
  publish(runId: string, event: AiEvent): Promise<void>;

  /** Subscribe to a run's stream from a cursor. Yields {id, event} pairs.
   *  Terminates when a terminal event (done/error) is received. */
  subscribe(
    runId: string,
    fromId?: string
  ): AsyncIterable<{ id: string; event: AiEvent }>;

  /** Set TTL on a run's stream (called after terminal event). */
  expire(runId: string, ttlSeconds: number): Promise<void>;
}
```

Adapter: `src/adapters/server/ai/redis-run-stream.adapter.ts` — implements `RunStreamPort` using `ioredis` XADD/XREAD/XRANGE/EXPIRE.

**REDIS_IS_EPHEMERAL**: Redis holds only transient stream data. If Redis restarts mid-run, the activity detects publish failure and marks the run as errored. PostgreSQL remains the durable source of truth for all persisted state.

### Risks and Mitigations

| Risk                                                            | Mitigation                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Accidental bypass (someone calls executor directly "for speed") | Grep test + code review + dep-cruiser rule                               |
| Bad idempotency key derivation                                  | Strict key format validation; reject invalid keys                        |
| Workflow non-determinism                                        | Existing TEMPORAL_PATTERNS.md invariants apply                           |
| Redis unavailable mid-run                                       | Activity catches publish error → marks run errored. PG is durable truth. |
| Redis memory pressure from long streams                         | MAXLEN ~10000 per stream + EXPIRE 3600s after terminal                   |
| Stale streams from crashed runs                                 | Temporal workflow timeout → finalizeRunActivity cleans up Redis key      |
| SSE reconnect after Redis TTL expires                           | Return 410 Gone with final result from `graph_runs` table (PG fallback)  |

### File Pointers

| File                                                                 | Purpose                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------ |
| `services/scheduler-worker/src/workflows/graph-run.workflow.ts`      | GraphRunWorkflow (unified execution path)              |
| `services/scheduler-worker/src/activities/execute-graph.activity.ts` | executeAndStreamActivity (pumps + publishes to Redis)  |
| `src/ports/run-stream.port.ts`                                       | RunStreamPort interface (hexagonal boundary)           |
| `src/adapters/server/ai/redis-run-stream.adapter.ts`                 | Redis Streams adapter (XADD/XREAD/XRANGE)              |
| `src/app/api/v1/ai/chat/route.ts`                                    | API trigger (starts workflow → subscribes Redis → SSE) |
| `src/app/api/v1/ai/runs/[runId]/stream/route.ts`                     | Reconnection SSE endpoint                              |
| `src/features/ai/services/ai_runtime.ts`                             | AI runtime (workflow start + Redis subscribe)          |
| `packages/db-schema/src/scheduling.ts`                               | Schema: `graph_runs` table                             |
| `infra/compose/runtime/docker-compose.yml`                           | Redis 7 service definition                             |

## Acceptance Checks

**Automated:**

1. **API run is async and durable**
   - Request returns quickly with `{ runId, workflowId }`
   - Run continues after server restart

2. **Idempotency**
   - Same `Idempotency-Key` called twice → one workflow execution
   - Returns cached `runId` on duplicate

3. **Schedule parity**
   - Scheduled run uses same workflow
   - Produces same artifacts and billing records

4. **No inline execution**
   - Lint/grep test: API handler must not import `GraphExecutorPort`
   - Only workflow activities call execution layer

5. **Real-time streaming preserved**
   - Chat POST returns SSE stream with token-by-token delivery
   - Stream latency ≤50ms added vs current inline path
   - `assistant-ui` client works without changes

6. **Reconnection works**
   - Browser close → reopen → GET `/api/v1/ai/runs/{runId}/stream` replays from last position
   - Returns 410 Gone if Redis TTL expired (client falls back to thread history)

7. **Multiple concurrent runs**
   - Two simultaneous chat requests produce two independent SSE streams
   - Each billed correctly via existing decorator stack

8. **Billing safety under all conditions**
   - Activity pumps to completion even if all SSE subscribers disconnect
   - `usage_report` events never leak to Redis (consumed by decorator)

## Open Questions

_(none)_

## Related

- [Graph Execution](graph-execution.md) — Execution invariants, billing, P1 run persistence
- [scheduler.md](./scheduler.md) — Temporal architecture, internal API
- [temporal-patterns.md](./temporal-patterns.md) — Workflow determinism, activity idempotency
- [Project: Unified Graph Launch](../../work/projects/proj.unified-graph-launch.md)
