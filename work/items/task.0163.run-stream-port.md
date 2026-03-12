---
id: task.0163
type: task
primary_charter:
title: "RunStreamPort + RedisRunStreamAdapter: hexagonal streaming boundary"
state: Active
status: needs_implement
revision: 1
priority: 0
rank: 2
estimate: 2
summary: Create RunStreamPort interface and Redis Streams adapter for real-time event transport between Temporal activities and SSE endpoints
outcome: Publish/subscribe streaming of AiEvents via Redis Streams with cursor-based replay for reconnection
assignees: []
project: proj.unified-graph-launch
created: 2026-03-12
updated: 2026-03-13
labels:
  - ai-graphs
depends_on:
  - task.0162
branch: claude/unified-graph-launch-mmXvl
---

# RunStreamPort + RedisRunStreamAdapter

## Design

### Outcome

A hexagonal port/adapter pair that enables publishing `AiEvent` streams to Redis and subscribing to them with cursor-based replay. This is the bridge between Temporal activities (publishers) and SSE endpoints (subscribers).

### Approach

**Solution**: New `RunStreamPort` interface in `src/ports/` + `RedisRunStreamAdapter` in `src/adapters/server/ai/` using `ioredis` XADD/XREAD/XRANGE/EXPIRE commands.

**Reuses**: Existing hexagonal port/adapter pattern. Existing `AiEvent` type from `@cogni/ai-core`. `ioredis` dependency from task.0162. Creates and owns the Redis client connection used by the adapter.

**Rejected**: Custom WebSocket server — more complex, doesn't support replay. Temporal queries — not designed for high-throughput streaming (burns workflow history). PostgreSQL LISTEN/NOTIFY — not an append-log, no replay support.

### Interface

```typescript
// src/ports/run-stream.port.ts
interface RunStreamPort {
  /** Publish a single event to the run's stream. */
  publish(runId: string, event: AiEvent): Promise<void>;

  /** Subscribe to a run's stream from a cursor position.
   *  Yields {id, event} pairs. Terminates on done/error events.
   *  If fromId is provided, replays from that position first (XRANGE),
   *  then switches to live reads (XREAD BLOCK). */
  subscribe(
    runId: string,
    fromId?: string
  ): AsyncIterable<{ id: string; event: AiEvent }>;

  /** Set TTL on a run's stream (call after terminal event). */
  expire(runId: string, ttlSeconds: number): Promise<void>;
}
```

### Redis Commands Used

| Operation          | Redis Command                                   | Purpose                       |
| ------------------ | ----------------------------------------------- | ----------------------------- |
| Publish event      | `XADD run:{runId} MAXLEN ~10000 * data <json>`  | Append event to stream        |
| Live subscribe     | `XREAD BLOCK 5000 STREAMS run:{runId} <cursor>` | Block-wait for new events     |
| Replay (reconnect) | `XRANGE run:{runId} <fromId> +`                 | Read all events after cursor  |
| Set TTL            | `EXPIRE run:{runId} 3600`                       | Auto-cleanup after completion |

### Invariants

Per spec [unified-graph-launch.md §7-10](../../docs/spec/unified-graph-launch.md):

- `REDIS_IS_STREAM_PLANE` — only ephemeral stream data in Redis
- `PUMP_TO_COMPLETION_VIA_REDIS` — publisher pumps all events regardless of subscriber count
- `SSE_FROM_REDIS_NOT_MEMORY` — subscribers read from Redis, not in-process memory
- `STREAM_PUBLISH_IN_ACTIVITY` — port is called from Temporal activities, not workflows
- `ARCHITECTURE_ALIGNMENT` — port in `src/ports/`, adapter in `src/adapters/server/` (spec: architecture)

### Files

- Create: `src/ports/run-stream.port.ts` — RunStreamPort interface
- Create: `src/adapters/server/ai/redis-run-stream.adapter.ts` — Redis Streams implementation (owns its ioredis client creation)
- Create: `src/contracts/run-stream.contract.ts` — Zod schemas for stream entry format
- Modify: `src/ports/index.ts` — export RunStreamPort
- Modify: `src/adapters/server/index.ts` — export RedisRunStreamAdapter
- Modify: `src/bootstrap/container.ts` — register RunStreamPort (always Redis adapter)
- Test: `src/adapters/server/ai/__tests__/redis-run-stream.adapter.test.ts` — unit tests with mocked ioredis

## Plan

- [ ] **Checkpoint 1: Port + Contract + Exports**
  - Milestone: RunStreamPort interface + Zod contract + barrel exports
  - Invariants: ARCHITECTURE_ALIGNMENT
  - Todos:
    - [ ] Create `src/ports/run-stream.port.ts`
    - [ ] Create `src/contracts/run-stream.contract.ts` (Zod schema for stream entry)
    - [ ] Export RunStreamPort from `src/ports/index.ts`
  - Validation: `pnpm check` passes

- [ ] **Checkpoint 2: RedisRunStreamAdapter + Container Wiring**
  - Milestone: Adapter implements port, wired in container
  - Invariants: REDIS_IS_STREAM_PLANE, ARCHITECTURE_ALIGNMENT
  - Todos:
    - [ ] Create `src/adapters/server/ai/redis-run-stream.adapter.ts`
    - [ ] Export from `src/adapters/server/index.ts`
    - [ ] Wire in `src/bootstrap/container.ts`
  - Validation: `pnpm check` passes

- [ ] **Checkpoint 3: Unit Test**
  - Milestone: Unit test with mocked ioredis covers publish/subscribe/expire
  - Todos:
    - [ ] Create `src/adapters/server/ai/__tests__/redis-run-stream.adapter.test.ts`
  - Validation: `pnpm check && pnpm test src/adapters/server/ai/__tests__/redis-run-stream`

## Validation

**Command:**

```bash
pnpm check
pnpm test src/adapters/server/ai/__tests__/redis-run-stream
```

**Expected:** All lint, type, format checks pass. Unit tests pass with mocked Redis. Component tests pass with testcontainers Redis.

### Edge Cases

- **Redis unavailable**: `publish()` throws → activity catches, marks run errored
- **Stream doesn't exist on subscribe**: `XREAD` returns empty → subscriber waits or times out
- **MAXLEN exceeded**: `~10000` is approximate trim — Redis may keep slightly more entries
- **Subscriber disconnects mid-stream**: No effect on publisher (fire-and-forget pattern)
- **Multiple subscribers**: Each gets independent cursor — Redis Streams support this natively

## Review Feedback

### Revision 1 — Blocking Issues

1. **Duplicate event delivery on replay→live transition** (`redis-run-stream.adapter.ts:96-105`): After XRANGE replay yields entries (e.g. IDs 2-0, 3-0, 4-0), the XREAD cursor is set to `fromId` (e.g. "1-0") instead of the last replayed entry's ID. XREAD returns entries strictly after the cursor, so it re-delivers all replayed entries as duplicates. Fix: track last yielded entry ID during replay and use that as the XREAD cursor.

2. **Missing test for replay→live cursor handoff**: Add a test where XRANGE returns non-terminal entries, then XREAD follows — assert XREAD cursor equals the last replayed entry ID, not `fromId`.

### Suggestions (non-blocking)

- `run-stream.contract.ts` is orphaned — not imported anywhere. Either use for validation or remove.
- `adapters/server/ai/AGENTS.md` Public Surface + Files API don't list `redis-run-stream.adapter.ts`.
