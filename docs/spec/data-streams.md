---
id: data-streams-spec
type: spec
title: "Data Streams: Redis Live Plane + Durable Persistence Policy"
status: draft
spec_state: proposed
trust: draft
summary: Three-tier data architecture for continuous awareness. Redis Streams for ephemeral live fan-out and threshold evaluation. Postgres for durable significant observations and AI decision artifacts. External backends own raw telemetry.
read_when: Adding a data source adapter, building live UI feeds, designing persistence policy for observations, or understanding how raw data becomes durable awareness.
implements:
owner: derekg1729
created: 2026-04-01
verified:
tags: [data-streams, redis, temporal, awareness, architecture]
---

# Data Streams: Redis Live Plane + Durable Persistence Policy

> Raw data streams through Redis. Significant observations persist to Postgres. External backends own the firehose.

### Key References

|                       |                                                                              |                                           |
| --------------------- | ---------------------------------------------------------------------------- | ----------------------------------------- |
| **Awareness Spec**    | [AI Awareness & Decision Plane](./monitoring-engine.md)                      | Record types, decision layers, invariants |
| **Ingestion Core**    | [ingestion-core](../../packages/ingestion-core/)                             | PollAdapter, cursor model, ID helpers     |
| **Redis Infra**       | cogni-template task.0174                                                     | Redis 7, ioredis, REDIS_URL config        |
| **Temporal Patterns** | temporal-patterns-spec (cogni-template)                                      | Workflow/Activity boundaries              |
| **First Domain**      | [task.0227](../../work/items/task.0227.poly-mvp-agent-workflows-and-taps.md) | Polymarket domain pack                    |

## Goal

Define the three-tier data architecture that connects edge adapters (Polymarket, Kalshi, Grafana, etc.) to the AI decision plane without mirroring firehoses into Postgres. Redis is the live plane — everything streams through it. Postgres stores only what matters. External backends keep the raw truth.

## Design

### Three Tiers

```
┌─────────────────────────────────────────────────────────────┐
│  TIER 1: EXTERNAL BACKENDS (own raw telemetry)              │
│  Polymarket API, Kalshi API, Grafana/Mimir, PostHog         │
│  ↑ source_ref pointers allow drill-back for investigation   │
└──────────────────────────┬──────────────────────────────────┘
                           │
              PollAdapter.collect() — Temporal scheduled activity
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  TIER 2: REDIS STREAMS (ephemeral live plane)               │
│                                                             │
│  streams:{domain}:{source}   — all snapshots, every poll    │
│    MAXLEN ~2000, auto-trimmed                               │
│    Frontend SSE tails this for live UI                       │
│    Trigger evaluation reads sliding window from here         │
│                                                             │
│  triggers:{domain}           — threshold crossings          │
│    MAXLEN ~500                                              │
│    UI highlights, notifications                             │
│                                                             │
│  signals:{domain}            — AI conclusions               │
│    Fan-out from DB INSERT trigger                           │
│    UI brain feed                                            │
└──────────────────────────┬──────────────────────────────────┘
                           │
              Persistence policy (selective)
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  TIER 3: POSTGRES (durable awareness + decisions)           │
│                                                             │
│  observation_events  — significant observations only        │
│    Threshold crossings, notable state changes               │
│    Sparse checkpoints (1/hour rollup per entity)            │
│    NOT every poll sample                                    │
│                                                             │
│  analysis_runs       — when and why AI was invoked          │
│  analysis_signals    — AI conclusions with action levels    │
│  analysis_outcomes   — ground truth for calibration         │
│  base_rates          — historical frequencies               │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow — Temporal MarketStreamWorkflow

```
Temporal Scheduled Workflow (every 30s)
  │
  │  Activity: poll adapters
  │  ├─ PolymarketAdapter.listMarkets()
  │  └─ KalshiAdapter.listMarkets()
  │
  │  Activity: write to Redis stream
  │  └─ XADD streams:prediction-market:polymarket {serialized NormalizedMarket[]}
  │     XADD streams:prediction-market:kalshi    {serialized NormalizedMarket[]}
  │
  │  Workflow code (deterministic, replay-safe):
  │  ├─ Read last N entries from Redis stream (via Activity)
  │  ├─ Evaluate triggers (pure functions from poly-core/triggers.ts)
  │  │   - checkPriceMove(current, oneHourAgo) → TriggerCheck | null
  │  │   - checkVolumeSpike(current, avg24h)   → TriggerCheck | null
  │  │   - checkCrossPlatformSpread(poly, kalshi) → TriggerCheck | null
  │  └─ Budget gate: prioritizeTriggers(candidates, budget, activeRuns)
  │
  │  IF triggers fire:
  │  ├─ Activity: write ObservationEvent to Postgres (significant only)
  │  ├─ Activity: XADD triggers:prediction-market {trigger details}
  │  └─ Signal to start AnalysisRunWorkflow (child workflow)
  │
  │  IF no triggers:
  │  └─ Data lives only in Redis. No DB write. No cost.
  │
  │  Periodic (every hour):
  │  └─ Activity: write sparse checkpoint to observation_events
  │     (1 snapshot per entity per hour — baseline for long-term context)
```

### Persistence Policy

Not all data deserves Postgres. The policy is:

| Data                                                   | Persisted? | Where                       | Why                                            |
| ------------------------------------------------------ | ---------- | --------------------------- | ---------------------------------------------- |
| Every 30s market snapshot                              | No         | Redis only (MAXLEN trimmed) | Firehose noise — 1.4M rows/day for 500 markets |
| Threshold crossing (price >5%, volume >2x, spread >3%) | Yes        | `observation_events`        | Significant state change worth remembering     |
| Hourly checkpoint (1 per entity per hour)              | Yes        | `observation_events`        | Sparse baseline for calibration context        |
| AI analysis run                                        | Yes        | `analysis_runs`             | When and why tokens were spent                 |
| AI signal                                              | Yes        | `analysis_signals`          | What the AI concluded                          |
| Entity resolution                                      | Yes        | `analysis_outcomes`         | Ground truth for calibration                   |

**Why sparse checkpoints?** If you persist only trigger crossings, you lose the "what was normal before this became interesting?" context. One checkpoint per entity per hour gives ~12K rows/day (500 entities × 24h) instead of 1.4M — a 100x reduction that preserves enough history for calibration and debugging.

### Redis Stream Keys

| Key Pattern                 | Content                                     | MAXLEN | Consumers                        |
| --------------------------- | ------------------------------------------- | ------ | -------------------------------- |
| `streams:{domain}:{source}` | Serialized NormalizedMarket per poll        | ~2000  | SSE endpoint, trigger evaluation |
| `triggers:{domain}`         | Trigger crossings with entity + detail      | ~500   | SSE endpoint, UI alerts          |
| `signals:{domain}`          | AI signal summaries (fanned from DB INSERT) | ~200   | SSE endpoint, brain feed         |

Example keys for prediction markets:

- `streams:prediction-market:polymarket`
- `streams:prediction-market:kalshi`
- `triggers:prediction-market`
- `signals:prediction-market`

### SSE Endpoint

`GET /api/v1/poly/stream` — Server-Sent Events endpoint

1. On connect: replay last N entries from Redis stream (immediate data)
2. Then: tail Redis stream via `XREAD BLOCK` for live updates
3. Client reconnects with `Last-Event-ID` for resumption

Event types:

```
event: snapshot
data: {"provider":"polymarket","markets":[...]}

event: trigger
data: {"type":"price_move","entityId":"...","detail":"8.2% in 1h"}

event: signal
data: {"id":"signal:...","finding":"...","actionLevel":"alert"}
```

### Frontend: Sorted by Decision Point

The SSE consumer maintains a local market map. Markets are sorted by `resolvesAt` ascending (soonest first). When a trigger fires, that market is visually highlighted.

```typescript
// Simplified frontend state
const [markets, setMarkets] = useState<Map<string, NormalizedMarket>>();

// On SSE snapshot event:
for (const m of event.markets) {
  markets.set(m.id, m);
}

// Render sorted by resolvesAt:
const sorted = [...markets.values()]
  .filter((m) => m.active)
  .sort(
    (a, b) =>
      new Date(a.resolvesAt).getTime() - new Date(b.resolvesAt).getTime()
  );
```

### Trigger Evaluation Window

Triggers need historical context (e.g., "price 1 hour ago" for price move detection). This comes from the Redis stream, not the DB:

```typescript
// Activity: read sliding window from Redis
async function getEntityHistory(
  redis: Redis,
  streamKey: string,
  entityId: string,
  windowMs: number
): Promise<NormalizedMarket[]> {
  const since = Date.now() - windowMs;
  const entries = await redis.xrange(streamKey, String(since), "+");
  return entries.map(parseMarketFromEntry).filter((m) => m.id === entityId);
}
```

For a 30s poll interval and MAXLEN 2000, the stream holds ~16 hours of history per source — more than enough for 1h price moves and 24h volume averages.

## Invariants

| Rule                   | Constraint                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| REDIS_IS_STREAM_PLANE  | Redis holds only ephemeral stream data. Postgres is durable truth. (from task.0174)                                                            |
| STREAM_THEN_EVALUATE   | Every poll writes to Redis first, then evaluates triggers. Never skip the stream write.                                                        |
| SIGNIFICANT_ONLY_TO_DB | Only threshold crossings and sparse checkpoints write to `observation_events`. Raw poll samples never persist.                                 |
| SPARSE_CHECKPOINTS     | One checkpoint per entity per hour persisted to `observation_events`. Provides calibration baseline without firehose cost.                     |
| TRIGGERS_ARE_PURE      | Trigger evaluation functions are deterministic pure functions. They run in Temporal Workflow code (replay-safe).                               |
| REDIS_MAXLEN_ENFORCED  | All XADD calls include MAXLEN to prevent unbounded growth. Exact values per stream key documented above.                                       |
| SSE_RESUME_SAFE        | SSE endpoint supports `Last-Event-ID` for reconnection. Clients never miss events during brief disconnects.                                    |
| TEMPORAL_OWNS_IO       | All Redis reads/writes and DB writes happen in Temporal Activities. Trigger evaluation is in Workflow code.                                    |
| SOURCE_REF_ALWAYS      | Every Redis stream entry and every persisted observation includes a `source_ref` pointer to the external backend for drill-back investigation. |

## Relationship to Awareness Spec

This spec refines the persistence model from [AI Awareness & Decision Plane](./monitoring-engine.md):

- The awareness spec defines the record types (`ObservationEvent`, `ActivityEvent`), the decision layers (triggers → analysis → signals → outcomes), and the invariants (append-only, idempotent, budget-gated).
- **This spec** defines where data lives at each stage (Redis vs Postgres), the persistence policy (what gets promoted from stream to DB), and the live transport (Redis Streams → SSE).

The awareness spec's invariant `OBSERVATION_APPEND_ONLY` still holds — but now `observation_events` contains significant observations and checkpoints, not the raw firehose. The raw firehose lives in Redis (ephemeral, MAXLEN-trimmed).

## Infrastructure Dependencies

| Dependency        | Status                              | Source                                               |
| ----------------- | ----------------------------------- | ---------------------------------------------------- |
| Redis 7           | Exists in operator repo (task.0174) | Needs upstream merge to this node                    |
| ioredis           | Exists in operator repo             | Needs upstream merge                                 |
| REDIS_URL env var | Exists in operator repo             | Needs upstream merge                                 |
| Temporal          | Running in dev stack                | Available                                            |
| TimescaleDB       | Optional                            | `observation_events` works as plain table without it |

## Non-Goals

- WebSocket push (SSE is sufficient for v1; WebSocket is an upgrade path)
- Cross-node stream federation (single-node MVP)
- Stream replay beyond MAXLEN window (use Postgres for historical queries)
- Real-time order execution triggered by streams (Run phase, not Walk)

## Open Questions

- [ ] Should sparse checkpoints use a separate `checkpoint_events` table or the same `observation_events` with a flag?
- [ ] MAXLEN values need load testing — 2000 entries per source at 30s intervals ≈ 16h. Is that enough sliding window?
- [ ] Should the SSE endpoint live in `apps/poly` or `apps/web`? (Currently leaning `apps/poly` since that's the prediction market UI.)
- [ ] Redis persistence policy: `--save ""` (pure ephemeral) or `--save 60 1000` (periodic RDB for crash recovery)? Leaning ephemeral — the data repopulates on next poll cycle.
