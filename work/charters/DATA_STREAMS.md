---
id: chr.data-streams
type: charter
title: "Data Streams Scorecard"
state: Active
summary: Living tracker of data source maturity across the Cogni node network.
created: 2026-04-05
updated: 2026-04-05
---

# Data Streams Scorecard

> Living tracker of data source maturity across the Cogni node network.
> Updated as sources come online. See [data-streams spec](../../docs/spec/data-streams.md) for architecture.

## Goal

Track every data source from planned → fully observable. Each source progresses through adapter → Temporal ingestion → Redis live plane → SSE summary → UI card → trigger evaluation. The scorecard makes gaps visible.

## Projects

| Project               | Relationship                                     |
| --------------------- | ------------------------------------------------ |
| `proj.operator-plane` | Node streams transport layer, operator dashboard |

## Constraints

- Temporal activities write to Postgres but NOT to Redis streams yet (blocks all sources at 30%)
- No `IngestionSummaryEvent` type (blocks SSE visibility for ingested data)
- Market providers (Polymarket/Kalshi) have adapters but no Temporal workflow to schedule them

## Maturity Levels

| Level | Meaning                                                         |
| ----- | --------------------------------------------------------------- |
| 0%    | Planned — no code                                               |
| 10%   | Adapter exists but not registered or tested                     |
| 30%   | Adapter registered, Temporal activity collects data to Postgres |
| 50%   | Data flows to Redis live plane (`streams:{domain}:{source}`)    |
| 70%   | Summary published to `node:{nodeId}:events`, visible on SSE     |
| 90%   | Frontend card renders on dashboard, AI agent can read it        |
| 100%  | Trigger evaluation + selective Postgres persistence active      |

## Scorecard

### Ingestion Sources (external data → canonical pipeline)

| Source                | Domain            | Adapter               | Temporal                | Redis Stream | SSE Summary | UI Card | Triggers | Monitoring Agent | Maturity |
| --------------------- | ----------------- | --------------------- | ----------------------- | ------------ | ----------- | ------- | -------- | ---------------- | -------- |
| **GitHub (poll)**     | vcs               | ✅ PollAdapter        | ✅ CollectEpochWorkflow | ❌           | ❌          | ❌      | ❌       | ❌ none          | **30%**  |
| **GitHub (webhook)**  | vcs               | ✅ WebhookNormalizer  | n/a (real-time)         | ❌           | ❌          | ❌      | ❌       | ❌ none          | **30%**  |
| **Alchemy (webhook)** | on-chain          | ✅ WebhookNormalizer  | n/a                     | ❌           | ❌          | ❌      | ❌       | ❌ none          | **10%**  |
| **Polymarket**        | prediction-market | ✅ MarketProviderPort | ❌ no workflow          | ❌           | ❌          | ❌      | ❌       | ❌ none          | **10%**  |
| **Kalshi**            | prediction-market | ✅ MarketProviderPort | ❌ no workflow          | ❌           | ❌          | ❌      | ❌       | ❌ none          | **10%**  |
| **Grafana/Mimir**     | observability     | ✅ MetricsQueryPort   | ❌                      | ❌           | ❌          | ❌      | ❌       | ❌ none          | **10%**  |
| **Cross-node health** | operations        | ❌                    | ❌                      | ❌           | ❌          | ❌      | ❌       | ❌ none          | **0%**   |
| **Discord**           | community         | ❌                    | ❌                      | ❌           | ❌          | ❌      | ❌       | ❌ none          | **0%**   |
| **PostHog**           | analytics         | ❌                    | ❌                      | ❌           | ❌          | ❌      | ❌       | ❌ none          | **0%**   |

### Node-Local (process metrics — bootstrap exception)

| Source                           | Adapter        | Redis Stream              | SSE | UI Card              | Monitoring Agent | Top Triggers                   | Maturity |
| -------------------------------- | -------------- | ------------------------- | --- | -------------------- | ---------------- | ------------------------------ | -------- |
| **Process health** (heap/RSS/EL) | ✅ setInterval | ✅ `node:{nodeId}:events` | ✅  | ✅ ProcessHealthCard | ❌ none          | heap >80%, EL >100ms, RSS >1GB | **30%**  |

### Monitoring Agent Coverage

No AI agent currently monitors any data stream. The `Monitoring Agent` column tracks which LangGraph agent (if any) is responsible for watching each source and what trigger conditions it evaluates.

Target agents:

- **Operator brain** — should monitor process health across all nodes, CI pipeline status, deploy lifecycle
- **Poly brain** — should monitor market data freshness, cross-platform spread anomalies
- **Git manager** (planned) — should monitor CI status, PR review coverage

### Transport Infrastructure

| Component                            | Status         | Notes                                                     |
| ------------------------------------ | -------------- | --------------------------------------------------------- |
| `@cogni/node-streams` package        | ✅ Built       | Generic `NodeStreamPort<T>`, Redis adapter, SSE encoder   |
| SSE endpoint (`/api/v1/node/stream`) | ✅ Built       | Session auth, Last-Event-ID reconnection, all 4 nodes     |
| `useNodeStream()` React hook         | ✅ Built       | EventSource, auto-reconnect, latest-by-type map           |
| `StreamCard` + event content kit     | ✅ Built       | HealthEvent, CiStatus, Deploy, ProcessHealth renderers    |
| Temporal → Redis publish step        | ❌ Not wired   | Activities write to Postgres but NOT to Redis streams yet |
| `IngestionSummaryEvent` type         | ❌ Not defined | Needed for Temporal activities to publish summaries       |

## What's Blocking Progress

The biggest gap across all external sources is the same: **Temporal activities write to `ingestion_receipts` (Postgres) but do NOT write to Redis streams.** The `STREAM_THEN_EVALUATE` invariant from the spec says every poll writes to Redis first — this isn't implemented yet.

Once that step is added to the existing `collectFromSource` activity, every source that already has an adapter (GitHub, Polymarket, Kalshi, Alchemy) immediately jumps from 30% → 50%.

Adding the summary publish to `node:{nodeId}:events` after that takes them from 50% → 70%.

The frontend card for each source takes them from 70% → 90%.

## Next Steps (Priority Order)

1. **Wire Redis publish into `collectFromSource` activity** — affects all sources at once
2. **Add `IngestionSummaryEvent` type** — defines the summary shape for `node:{nodeId}:events`
3. **Create `MarketStreamWorkflow`** — Temporal workflow for Polymarket/Kalshi polling (currently only usable via AI tool, not scheduled)
4. **Add Grafana health polling adapter** — cross-node health probes via MetricsQueryPort
5. **Frontend cards per source** — `GitHubEventContent`, `MarketEventContent`, etc.

## Guide

See [Data Source Publisher Guide](../../docs/guides/data-source-publisher.md) for the plug-and-play checklist for adding a new data source.
