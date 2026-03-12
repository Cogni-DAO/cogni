---
id: task.0163
type: task
primary_charter:
title: "RunStreamPort + RedisRunStreamAdapter: hexagonal streaming boundary"
state: Active
status: needs_implement
priority: 0
rank: 2
estimate: 2
summary: Create RunStreamPort interface and Redis Streams adapter for real-time event transport between Temporal activities and SSE endpoints
outcome: Publish/subscribe streaming of AiEvents via Redis Streams with cursor-based replay for reconnection
assignees: []
project: proj.unified-graph-launch
created: 2026-03-12
updated: 2026-03-12
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

**Reuses**: Existing hexagonal port/adapter pattern. Existing `AiEvent` type from `@cogni/ai-core`. Existing `ioredis` client from task.0162.

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

- [ ] REDIS_IS_STREAM_PLANE: Only ephemeral stream data in Redis (spec: unified-graph-launch)
- [ ] PUMP_TO_COMPLETION_VIA_REDIS: Publisher pumps all events regardless of subscriber count (spec: unified-graph-launch)
- [ ] SSE_FROM_REDIS_NOT_MEMORY: Subscribers read from Redis, not in-process memory (spec: unified-graph-launch)
- [ ] ARCHITECTURE_ALIGNMENT: Port in `src/ports/`, adapter in `src/adapters/server/` (spec: architecture)
- [ ] STREAM_PUBLISH_IN_ACTIVITY: Port is called from Temporal activities, not workflows (spec: unified-graph-launch)

### Files

- Create: `src/ports/run-stream.port.ts` — RunStreamPort interface
- Create: `src/adapters/server/ai/redis-run-stream.adapter.ts` — Redis Streams implementation
- Create: `src/contracts/run-stream.contract.ts` — Zod schemas for stream entry format
- Modify: `src/ports/index.ts` — export RunStreamPort
- Modify: `src/adapters/server/index.ts` — export RedisRunStreamAdapter
- Modify: `src/bootstrap/container.ts` — register RunStreamPort with Redis adapter
- Test: `src/adapters/server/ai/__tests__/redis-run-stream.adapter.test.ts` — unit tests with Redis mock
- Test: `src/adapters/server/ai/__tests__/redis-run-stream.adapter.component.test.ts` — component test with testcontainers Redis

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
