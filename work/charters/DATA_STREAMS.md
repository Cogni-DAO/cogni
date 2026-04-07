---
id: chr.data-streams
type: charter
title: "Data Streams Scorecard"
state: Active
summary: Living tracker of data source maturity across the Cogni node network.
created: 2026-04-05
updated: 2026-04-06
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

- Temporal activities write to Postgres but NOT to Redis streams yet (blocks poll-based sources at 20%)
- No `IngestionSummaryEvent` type (blocks SSE visibility for ingested data)
- Market providers (Polymarket/Kalshi) have adapters but no Temporal workflow to schedule them
- No `core__node_stream_read` AI tool yet (task.0297) — blocks agent access to all streams
- No agent actively monitors any stream — max maturity is 50% until agent read tool + monitoring wired

## Maturity Levels

| Level | Meaning                                                             |
| ----- | ------------------------------------------------------------------- |
| 0%    | Planned — no code                                                   |
| 10%   | Adapter exists but not registered or tested                         |
| 20%   | Adapter registered, Temporal activity collects data to Postgres     |
| 30%   | Data flows to Redis live plane (`streams:{domain}:{source}`)        |
| 40%   | Summary published to `node:{nodeId}:events`, visible on SSE         |
| 50%   | Frontend card renders on dashboard                                  |
| 60%   | AI agent has read tool access (`core__node_stream_read`)            |
| 80%   | Agent actively monitors the stream (LangGraph agent watches events) |
| 100%  | Auto-triggers fire on threshold conditions (like Grafana alerts)    |

## Scorecard

### Ingestion Sources (external data → canonical pipeline)

| Source                | Domain            | Adapter               | Temporal                | Redis Stream | SSE Summary | UI Card | Agent Read | Agent Monitor | Auto-Triggers | Maturity |
| --------------------- | ----------------- | --------------------- | ----------------------- | ------------ | ----------- | ------- | ---------- | ------------- | ------------- | -------- |
| **GitHub (poll)**     | vcs               | ✅ PollAdapter        | ✅ CollectEpochWorkflow | ❌           | ❌          | ❌      | ❌         | ❌ none       | ❌            | **20%**  |
| **GitHub (webhook)**  | vcs               | ✅ WebhookNormalizer  | n/a (real-time)         | ✅           | ✅          | ✅      | ❌         | ❌ none       | ❌            | **50%**  |
| **Alchemy (webhook)** | on-chain          | ✅ WebhookNormalizer  | n/a                     | ❌           | ❌          | ❌      | ❌         | ❌ none       | ❌            | **10%**  |
| **Polymarket**        | prediction-market | ✅ MarketProviderPort | ❌ no workflow          | ❌           | ❌          | ❌      | ❌         | ❌ none       | ❌            | **10%**  |
| **Kalshi**            | prediction-market | ✅ MarketProviderPort | ❌ no workflow          | ❌           | ❌          | ❌      | ❌         | ❌ none       | ❌            | **10%**  |
| **Grafana/Mimir**     | observability     | ✅ MetricsQueryPort   | ❌                      | ❌           | ❌          | ❌      | ❌         | ❌ none       | ❌            | **10%**  |
| **Cross-node health** | operations        | ❌                    | ❌                      | ❌           | ❌          | ❌      | ❌         | ❌ none       | ❌            | **0%**   |
| **Discord**           | community         | ❌                    | ❌                      | ❌           | ❌          | ❌      | ❌         | ❌ none       | ❌            | **0%**   |
| **PostHog**           | analytics         | ❌                    | ❌                      | ❌           | ❌          | ❌      | ❌         | ❌ none       | ❌            | **0%**   |

**Note:** GitHub (webhook) now includes `workflow_run` → `CiStatusEvent` wiring. CI status events will flow once the GitHub App has the **Workflow run** subscription enabled (admin config change). Maturity unchanged until live.

### Core Data Streams (node AI activity aggregation)

| Source                 | Domain   | Adapter                    | DB Storage         | API                 | UI Card          | Monitoring Agent | Maturity | Blockers                                                           |
| ---------------------- | -------- | -------------------------- | ------------------ | ------------------- | ---------------- | ---------------- | -------- | ------------------------------------------------------------------ |
| **LiteLLM billing**    | ai-usage | ❌ cogni_callbacks.py DEAD | ✅ charge_receipts | ✅ /api/v1/activity | ✅ ActivityChart | ❌ none          | **10%**  | **bug.0297**: double-pathed URL, callback crashes everywhere       |
| **Codex BYO-AI**       | ai-usage | ✅ CodexLlmAdapter         | ✅ charge_receipts | ✅ /api/v1/activity | ✅ ActivityChart | ❌ none          | **40%**  | No cost tracking (by design — BYO), no token breakdown, no latency |
| **Sandbox (OpenClaw)** | ai-usage | ✅ ProxyBillingEntry       | ✅ charge_receipts | ✅ /api/v1/activity | ✅ ActivityChart | ❌ none          | **30%**  | Only works in dev stack, not deployed                              |

### Node-Local (process metrics — bootstrap exception)

| Source                           | Adapter        | Redis Stream              | SSE | UI Card              | Agent Read | Agent Monitor | Auto-Triggers                     | Maturity |
| -------------------------------- | -------------- | ------------------------- | --- | -------------------- | ---------- | ------------- | --------------------------------- | -------- |
| **Process health** (heap/RSS/EL) | ✅ setInterval | ✅ `node:{nodeId}:events` | ✅  | ✅ ProcessHealthCard | ❌         | ❌ none       | ❌ heap >80%, EL >100ms (planned) | **50%**  |

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

Two bottlenecks gate all sources:

1. **Poll-based sources stuck at 20%** — Temporal activities write to `ingestion_receipts` (Postgres) but NOT to Redis streams. The `STREAM_THEN_EVALUATE` invariant says every poll writes to Redis first — not implemented yet. Fixing `collectFromSource` unblocks GitHub (poll), Polymarket, Kalshi, and Grafana simultaneously.

2. **All sources capped at 50%** — No AI agent can read streams yet. `core__node_stream_read` (task.0297) is the read tool that gives agents access. Without it, no agent monitoring or auto-triggers are possible.

## Next Steps (Priority Order)

1. **Build `core__node_stream_read` tool** (task.0297) — gives AI agents stream access, unblocks 60%+
2. **Wire Redis publish into `collectFromSource` activity** — unblocks poll-based sources to 30%+
3. **Add `IngestionSummaryEvent` type** — summary shape for `node:{nodeId}:events`
4. **Wire git-manager to monitor VCS stream** — first agent actively monitoring a stream (→ 80%)
5. **Create `MarketStreamWorkflow`** — Temporal workflow for Polymarket/Kalshi polling
6. **Add auto-trigger evaluation** — threshold-based alerts (heap >80%, CI failure, etc.) → 100%

## Guide

See [Data Source Publisher Guide](../../docs/guides/data-source-publisher.md) for the plug-and-play checklist for adding a new data source.
