---
id: spec.unified-graph-launch
type: spec
title: Unified Graph Launch Design
status: draft
spec_state: proposed
trust: draft
summary: All graph execution flows through GraphRunWorkflow in Temporal — Redis Streams bridge real-time SSE streaming
read_when: Adding new graph trigger types, modifying execution paths, or implementing idempotency
implements: proj.unified-graph-launch
owner: cogni-dev
created: 2026-02-03
verified: 2026-03-19
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

8. **STREAM_PUBLISH_IN_EXECUTION_LAYER**: The execution layer (internal API route in `apps/operator`) publishes events to Redis as it drains the executor stream. The scheduler-worker activity triggers execution via HTTP but does not publish to Redis directly. This keeps the full execution stack (providers, decorators, factory) in `apps/operator` per `EXECUTION_VIA_SERVICE_API`.

9. **PUMP_TO_COMPLETION_VIA_REDIS**: The internal API route drains `AsyncIterable<AiEvent>` to completion and publishes each event to Redis, regardless of subscriber count. Same billing safety guarantee as today's `RunEventRelay`.

10. **SSE_FROM_REDIS_NOT_MEMORY**: SSE endpoints read from Redis Streams (not in-process memory). This enables cross-process streaming and reconnection.

11. **SINGLE_RUN_LEDGER**: One `graph_runs` table for all execution types (API, scheduled, webhook). Promoted from `schedule_runs` via rename + extend. No second run table. Idempotency stays in `execution_requests`, not in the run ledger.

## Schema

**Decision: Promote `schedule_runs` → `graph_runs` (single canonical run ledger)**

> Design review 2026-03-13: A single run table is the only defensible choice. Scheduled runs and API-triggered runs are the same entity with different provenance metadata. Splitting runs across two tables creates long-term product complexity and cross-table querying.

Rename `schedule_runs` to `graph_runs` and extend with trigger provenance columns:

| Column           | Type      | Notes                                                      |
| ---------------- | --------- | ---------------------------------------------------------- |
| `run_kind`       | text      | `user_immediate` \| `system_scheduled` \| `system_webhook` |
| `trigger_source` | text      | `api` \| `temporal_schedule` \| `webhook:{type}`           |
| `trigger_ref`    | text      | Upstream delivery ID / schedule ID                         |
| `requested_by`   | text      | User ID or `cogni_system`                                  |
| `graph_id`       | text      | Graph ID (e.g., `langgraph:poet`)                          |
| `schedule_id`    | uuid null | Nullable — only set for scheduled runs                     |

**Migration strategy:**

1. Rename table `schedule_runs` → `graph_runs`
2. Add new columns (`run_kind`, `trigger_source`, `trigger_ref`, `requested_by`, `graph_id`)
3. Make `schedule_id` nullable (API/webhook runs have no schedule)
4. Relax `schedule_slot_unique` constraint to `WHERE schedule_id IS NOT NULL`
5. Backfill existing rows: `run_kind = 'system_scheduled'`, `trigger_source = 'temporal_schedule'`

**Idempotency stays in `execution_requests`:** Idempotency is a request-layer concern, not a run-ledger concern. The run table represents execution state. `execution_requests` handles request deduplication. No `idempotency_key` column on `graph_runs`.

**Forbidden:**

- Second run table (no `graph_runs` alongside `schedule_runs` — one table only)
- `idempotency_key` on the run table (stays in `execution_requests`)
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
┌─ ORCHESTRATION (Temporal Worker = scheduler-worker) ─────────────────┐
│ GraphRunWorkflow                                                       │
│   1. Activity: validateGrantActivity(grantRef)                         │
│   2. Activity: createRunRecordActivity(runId, triggerContext)           │
│   3. Activity: executeGraphActivity(runId, graphId, input)             │
│      └─► POST /api/internal/graphs/{graphId}/runs (apps/operator)           │
│   4. Activity: finalizeRunActivity(runId, result)                      │
└────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ EXECUTION LAYER (apps/operator internal API) ────────────────────────────┐
│ POST /api/internal/graphs/{graphId}/runs                               │
│   • Validates grant (defense-in-depth)                                 │
│   • Calls GraphExecutorPort.runGraph()                                 │
│   • Drains stream, publishing each AiEvent to Redis Stream:            │
│     XADD run:{runId} MAXLEN ~10000 * data <json>                       │
│   • On done/error → XADD terminal event + EXPIRE key 3600s            │
│   • Billing via decorator stack (existing)                             │
│   • Returns { runId, traceId, ok, errorCode? }                         │
└────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─ STREAM PLANE (Redis) ────────────────────────────────────────────────┐
│ Key: run:{runId}                                                       │
│ Format: XADD run:{runId} MAXLEN ~10000 * data <json_payload>           │
│ Each entry gets a Redis-assigned stream ID (used as SSE Last-Event-ID) │
│ MAXLEN ~10000 per stream (safety cap)                                  │
│ EXPIRE 3600s after terminal event (auto-cleanup)                       │
└────────────────────────────────────────────────────────────────────────┘
```

**Execution host decision (2026-03-18):** The full `GraphExecutorPort` composition root (providers, decorators, factory) lives in `apps/operator`. The scheduler-worker remains a lean Temporal worker per `EXECUTION_VIA_SERVICE_API`. Redis publishing happens in the internal API route (execution layer), not in the Temporal activity (orchestration layer). This keeps the three-plane separation clean: Temporal orchestrates, apps/operator executes and publishes to Redis, Redis delivers to SSE endpoints.

**Why Redis Streams (not Pub/Sub):** Redis Pub/Sub is fire-and-forget (at-most-once). Streams are an append-log with cursor-based reads — supports replay from any position, enabling reconnection after browser close.

**Reconnection:** New `GET /api/v1/ai/runs/{runId}/stream` endpoint. Accepts `Last-Event-ID` header (SSE spec). Does `XRANGE` from that ID to catch up, then `XREAD BLOCK` for new events. Runs are reconnectable for as long as the Redis Stream exists (TTL ≤1h after completion).

**Multiple concurrent runs:** Each run has its own Redis Stream key. UI can open multiple SSE connections to different runIds simultaneously.

**Billing safety:** The internal API route drains `AsyncIterable<AiEvent>` to completion regardless of Redis subscriber count. `BillingGraphExecutorDecorator` intercepts `usage_report` events in the decorator stack before they reach the Redis publish loop. Same PUMP_TO_COMPLETION invariant as today's `RunEventRelay`.

**What stays the same:**

- `GraphExecutorPort` interface — unchanged
- Decorator stack (billing, observability, preflight) — unchanged
- `NamespaceGraphRouter` — unchanged
- Graph providers (InProc, LangGraph, Sandbox) — unchanged
- Thread persistence in PostgreSQL — unchanged
- Client-side `assistant-ui` integration — POST still returns SSE via AI SDK Data Stream Protocol

**What changes:**

- `POST /api/v1/ai/chat` → starts workflow, subscribes to Redis Stream, returns SSE
- `POST /api/internal/graphs/{graphId}/runs` → publishes events to Redis Stream as it drains the executor stream
- `RunEventRelay` → replaced by Redis Stream subscribe in SSE endpoints
- New `GET /api/v1/ai/runs/{runId}/stream` endpoint for reconnection
- New `RunStreamPort` + `RedisRunStreamAdapter` (hexagonal port/adapter)
- `GovernanceScheduledRunWorkflow` → replaced by `GraphRunWorkflow`
- Docker compose: add Redis 7
- New dependency: `ioredis`

#### 5. RunStreamPort (Hexagonal Boundary) — Implemented

```typescript
// src/ports/run-stream.port.ts
const RUN_STREAM_KEY_PREFIX = "run:";
const RUN_STREAM_MAXLEN = 10_000;
const RUN_STREAM_BLOCK_MS = 5_000;
const RUN_STREAM_DEFAULT_TTL_SECONDS = 3_600;

interface RunStreamEntry {
  id: string; // Redis stream ID (e.g. "1710000000000-0")
  event: AiEvent; // Deserialized event payload
}

interface RunStreamPort {
  /** Publish a single event to the run's stream. */
  publish(runId: string, event: AiEvent): Promise<void>;

  /** Subscribe to a run's stream from a cursor. Yields RunStreamEntry pairs.
   *  Terminates when a terminal event (done/error) is received.
   *  Phase 1: XRANGE replay from fromId (catch-up).
   *  Phase 2: XREAD BLOCK for live events (uses duplicated client). */
  subscribe(
    runId: string,
    signal: AbortSignal,
    fromId?: string
  ): AsyncIterable<RunStreamEntry>;

  /** Set TTL on a run's stream (called after terminal event). */
  expire(runId: string, ttlSeconds: number): Promise<void>;
}
```

**Adapter:** `src/adapters/server/ai/redis-run-stream.adapter.ts` — `RedisRunStreamAdapter` implements `RunStreamPort` using `ioredis` XADD/XREAD/XRANGE/EXPIRE. Wired in `src/bootstrap/container.ts` (always Redis, `lazyConnect: true`).

**Key implementation details:**

- **publish()**: `XADD run:{runId} MAXLEN ~10000 * data <json>` — events stored as JSON in a single `data` field
- **subscribe()**: Two-phase — Phase 1 replays via `XRANGE` (skips fromId entry, tracks cursor to last yielded ID), Phase 2 uses `XREAD COUNT 100 BLOCK 5000` on a `redis.duplicate()` client to avoid blocking the shared connection
- **Terminal events**: `done` and `error` event types signal stream completion — subscriber stops after yielding a terminal event
- **Cursor handoff**: After replay, XREAD cursor is the last replayed entry ID (not fromId), preventing duplicate delivery

**REDIS_IS_EPHEMERAL**: Redis holds only transient stream data. If Redis restarts mid-run, the activity detects publish failure and marks the run as errored. PostgreSQL remains the durable source of truth for all persisted state.

#### 6. Redis Infrastructure — Implemented

Redis 7 is available in all runtime stacks (dev, test, prod) via Docker Compose.

- **Image**: `redis:7-alpine` (pinned by digest for reproducibility)
- **Config**: `--save ""` (no RDB persistence), `--maxmemory 128mb`, `--maxmemory-policy noeviction`
- **Network**: `internal` (production), `cogni-edge` with port 6379 exposed (dev)
- **Healthcheck**: `redis-cli ping` with 10s interval
- **Env**: `REDIS_URL` (optional, defaults to `redis://localhost:6379`), validated via Zod in `server-env.ts`
- **Dependency**: `ioredis ^5.6.1` in `apps/operator/package.json` (ships own types)

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

**Implemented (task.0174, task.0175):**

| File                                                                | Purpose                                          |
| ------------------------------------------------------------------- | ------------------------------------------------ |
| `packages/graph-execution-core/src/run-stream.port.ts`              | RunStreamPort interface + stream constants       |
| `apps/operator/src/adapters/server/ai/redis-run-stream.adapter.ts`  | RedisRunStreamAdapter (XADD/XREAD/XRANGE/EXPIRE) |
| `apps/operator/src/bootstrap/container.ts`                          | Redis client + RunStreamPort wiring              |
| `apps/operator/src/shared/env/server-env.ts`                        | REDIS_URL env var (optional, Zod validated)      |
| `apps/operator/src/contracts/run-stream.contract.ts`                | Zod schema for stream entry wire format          |
| `infra/compose/runtime/docker-compose.yml`                          | Redis 7 service (production)                     |
| `infra/compose/runtime/docker-compose.dev.yml`                      | Redis 7 service (dev, port 6379 exposed)         |
| `apps/operator/tests/unit/adapters/server/ai/redis-run-stream.*.ts` | Unit tests with mocked ioredis (11 tests)        |

**Implemented (task.0176):**

| File                                                                | Purpose                                                               |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `packages/db-schema/src/scheduling.ts`                              | `graph_runs` table (promoted from `schedule_runs`), `GRAPH_RUN_KINDS` |
| `packages/scheduler-core/src/types.ts`                              | `GraphRun`, `GraphRunKind`, `GraphRunStatus` domain types             |
| `packages/scheduler-core/src/ports/schedule-run.port.ts`            | `GraphRunRepository` port interface                                   |
| `packages/db-client/src/adapters/drizzle-run.adapter.ts`            | `DrizzleGraphRunAdapter` (scheduled + non-scheduled paths)            |
| `services/scheduler-worker/src/activities/index.ts`                 | `createGraphRunActivity`, `updateGraphRunActivity` activities         |
| `services/scheduler-worker/src/workflows/scheduled-run.workflow.ts` | Passes trigger provenance to `graph_runs`                             |

**Implemented (task.0179):**

Scheduler-worker can now import shared execution contracts without violating `PACKAGES_NO_SRC_IMPORTS`. The shared package keeps billing and tracing out of the public graph execution surface. The app runtime now composes per-run wrappers in bootstrap so launchers stop building scoped executors, while ALS remains for tenant-scoped provider behavior that is still outside the shared contract.

| Package                             | Receives                                                                                                                      | Notes                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `@cogni/ai-core`                    | `Message`, `MessageRole`, `MessageToolCall`                                                                                   | Canonical LLM message type — moved from app-layer chat model |
| `@cogni/graph-execution-core` (new) | `GraphExecutorPort`, `GraphRunRequest`, `GraphRunResult`, `GraphFinal`, `ExecutionContext`, `RunStreamPort`, `RunStreamEntry` | Run lifecycle contracts; depends only on `ai-core`           |

**Key design decision:** `GraphRunRequest` carries only execution input (`runId`, `graphId`, `messages`, `model`, optional `stateKey`/`toolIds`/`responseFormat`). Trigger provenance belongs on workflow input and the `graph_runs` ledger, not on the shared executor contract. `ExecutionContext` carries only per-run metadata (`actorUserId`, `sessionId`, `maskContent`, `requestId`).

**Implemented (task.0182):**

| File                                                           | Purpose                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/operator/src/app/api/v1/ai/runs/[runId]/stream/route.ts` | SSE reconnection endpoint — Last-Event-ID replay from Redis Stream |
| `apps/operator/src/contracts/runs.stream.v1.contract.ts`       | Path parameter validation (runId UUID)                             |

**Planned (future tasks):**

| File                                                                | Purpose                                                                     | Task      |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------- |
| `services/scheduler-worker/src/workflows/graph-run.workflow.ts`     | GraphRunWorkflow (replaces GovernanceScheduledRunWorkflow)                  | task.0176 |
| `apps/operator/src/app/api/internal/graphs/[graphId]/runs/route.ts` | Add Redis Stream publishing as stream drains (PUMP_TO_COMPLETION_VIA_REDIS) | task.0176 |
| `apps/operator/src/app/api/v1/ai/chat/route.ts`                     | API trigger (starts workflow → subscribes Redis → SSE)                      | task.0177 |
| `apps/operator/src/features/ai/services/ai_runtime.ts`              | AI runtime (workflow start + Redis subscribe)                               | task.0177 |

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
