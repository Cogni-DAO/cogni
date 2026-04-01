---
id: task.0227
type: task
title: "Cogni Poly — Polymarket domain pack"
status: done
priority: 1
rank: 1
estimate: 5
summary: Polymarket domain pack — adapters, thresholds, scoring, LangGraph prompt, and API routes plugged into the AI awareness & decision plane.
outcome: Working prediction market monitoring on the Cogni Poly node using the monitoring-engine spec as backbone.
spec_refs:
  - task.0226
  - monitoring-engine-spec
assignees: derekg1729
credit:
project: proj.poly-prediction-bot
branch: feat/poly-data-pipeline
pr: https://github.com/Cogni-DAO/cogni-resy-helper/pull/13
reviewer:
revision: 5
blocked_by:
deploy_verified: false
created: 2026-03-30
updated: 2026-04-01
labels: [poly, prediction-markets, ai, langgraph]
external_refs:
---

# Cogni Poly — Polymarket Domain Pack

> First domain pack on top of the [AI Awareness & Decision Plane](../../docs/spec/monitoring-engine.md).
> The spec defines the generic pipeline (ObservationEvent → triggers → analysis → signals → outcomes).
> This work item plugs in Polymarket-specific adapters, thresholds, prompts, and scoring.

## What This Domain Pack Provides

| Slot              | Polymarket Implementation                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| Edge adapters     | `polymarket` PollAdapter (Gamma API + CLOB), `kalshi` PollAdapter (Trading API)                      |
| Record type       | `ObservationEvent` with `values: { probabilityBps, spreadBps, volumeUsd, bidDepthUsd, askDepthUsd }` |
| Source pointers   | Market URL, CLOB orderbook endpoint, Kalshi ticker page                                              |
| Derived features  | 1h OHLC, 24h change, volume moving average, cross-platform spread (domain-specific views)            |
| Trigger functions | Price move >5%/1h, Volume spike >2x/24h, Cross-platform spread >3%                                   |
| Enrichment        | GDELT news (free, no auth), Metaculus expert forecasts, base rates from DB                           |
| LLM prompt        | Calibrated market analyst (base rate → news update → fair probability → thesis)                      |
| Scoring           | `scoreEdge()`: \|fair - market\| > 500bps, liquidity-discounted confidence > 50%                     |
| Action routing    | Observe (log), Alert (>70% confidence), Recommend (>85% confidence + >8% edge)                       |
| Resolution        | Market resolves → outcome recorded → calibration update                                              |
| Base rate seeds   | economics, politics, climate, tech, crypto event frequencies                                         |

## Package: `packages/poly-core/`

Pure domain types + math for prediction markets. No I/O. Depends on `ingestion-core` (for `ObservationEvent` type).

**Schemas:**

- `NormalizedMarket` — extends `ObservationEvent` with prediction-market-specific fields (probabilityBps, outcomes, resolvesAt, platform)
- `RawAssessment` — LLM structured output (fairProbabilityPct, confidencePct, thesis, sourcesUsed)
- `MarketSignal` — domain-specific signal payload (probability, direction, edgeBps)
- API response schemas matching existing frontend mock types (BrainFeed.tsx, MarketCards.tsx, AgentStream.tsx)

**Pure functions:**

- `normalizePolymarketMarket()` / `normalizeKalshiMarket()` — raw API response → NormalizedMarket
- `checkPriceMove()` / `checkVolumeSpike()` / `checkCrossPlatformSpread()` — trigger thresholds
- `scoreEdge()` — assessment + market → signal (with liquidity discount) or null
- `lookupBaseRate()` — category matching against base rates table

## Data Adapters

Live in `apps/poly/src/adapters/` (I/O — app code, not packages). Implement `PollAdapter` from `ingestion-core`.

### Polymarket

Source: Gamma API (public, no auth) + CLOB API (public reads).

| Stream    | Endpoint            | Cursor       | Interval |
| --------- | ------------------- | ------------ | -------- |
| markets   | `GET gamma/markets` | `updatedAt`  | 5 min    |
| prices    | `GET clob/price`    | — (snapshot) | 60 sec   |
| orderbook | `GET clob/book`     | — (snapshot) | 60 sec   |

Gotchas: `outcomePrices` is a JSON string. Prices are 0.0–1.0. Cap at 2 req/sec.

### Kalshi

Source: Trading API (public reads, no auth for market data).

| Stream       | Endpoint                 | Cursor            | Interval |
| ------------ | ------------------------ | ----------------- | -------- |
| markets      | `GET /markets`           | `cursor` (opaque) | 5 min    |
| prices       | `GET /markets` (bid/ask) | — (snapshot)      | 60 sec   |
| candlesticks | `GET /candlesticks`      | `end_ts`          | 15 min   |

Gotchas: Values in cents (0–100). Rate limit 20/sec. Demo env at `demo.kalshi.com`.

## LangGraph: `poly-synth`

In `packages/langgraph-graphs/src/graphs/poly-synth/`. NOT in `LANGGRAPH_CATALOG` (not a message-based chat agent). Follows `pr-review` pattern: `createReactAgent` + structured output, no tools.

**System prompt:** Calibrated market analyst. For each market, receives base rate, 24h price history, news context, expert forecast, cross-platform price. Produces fair probability estimate + confidence + thesis. Explicitly debiased: "assess independently first, do NOT anchor to market price."

**Structured output:** `{ assessments: RawAssessment[] }`. Batches of 5 markets per LLM call.

## Temporal Wiring

Plugs domain activities into the generic workflows from the spec:

- **Data stream config:** entityPollInterval 5min, snapshotPollInterval 60sec, budget { maxConcurrentRuns: 2, maxLlmCallsPerHour: 12 }
- **Trigger evaluation:** uses poly-core pure functions (checkPriceMove, checkVolumeSpike, checkCrossPlatformSpread)
- **Analysis activities:** polyLoadContext (DB read), polyEnrichRefs (GDELT + Metaculus + base rates), polySynthesize (poly-synth graph), polyPersistSignals (DB write)
- **Debounce:** workflowId `prediction-market-analysis:{5minBucket}`
- **Scheduled fallback:** every 2 hours, `overlap: SKIP`

## API Endpoints

All in `apps/poly/src/app/api/v1/poly/`. Public, no auth.

| Route                | Returns                | Source                                                            |
| -------------------- | ---------------------- | ----------------------------------------------------------------- |
| `GET /brain/status`  | `BrainStatusResponse`  | Latest `analysis_runs` + aggregates for domain=prediction-market  |
| `GET /brain/signals` | `BrainSignalsResponse` | `analysis_signals` for domain=prediction-market, cursor-paginated |
| `GET /brain/stream`  | SSE `StreamEvent`      | Redis Streams → SSE (stretch)                                     |
| `GET /markets`       | `MarketsResponse`      | `observation_events` latest per entityId + derived 24h change     |

## Base Rate Seeds

Seeded via migration into `base_rates` table (domain = "prediction-market"):

| category_key                    | freq | n   | source                    |
| ------------------------------- | ---- | --- | ------------------------- |
| `economics:fed_rate_cut`        | 0.35 | 120 | FOMC 1990-2025            |
| `politics:incumbent_reelection` | 0.67 | 15  | US presidential 1960-2024 |
| `climate:cat5_hurricane_us`     | 0.08 | 50  | NHC 1975-2025             |
| `tech:product_release_on_time`  | 0.40 | 30  | Major tech releases       |
| `crypto:btc_above_threshold`    | 0.45 | 20  | BTC yearly targets        |

---

## Implementation Order

| Phase  | What                                                                     | Depends On     |
| ------ | ------------------------------------------------------------------------ | -------------- |
| **P0** | Extend `ingestion-core` with `ObservationEvent` + extend `CollectResult` | Nothing        |
| **P1** | Add `observation_events` + analysis tables to `db-schema`                | Nothing        |
| **P2** | `packages/poly-core` — schemas, normalizers, thresholds, scoreEdge       | P0             |
| **P3** | Data adapters (Polymarket + Kalshi PollAdapters)                         | P2             |
| **P4** | `poly-synth` LangGraph graph                                             | P2             |
| **P5** | Temporal activities + workflow config                                    | P1, P2, P3, P4 |
| **P6** | API routes (status, signals, markets)                                    | P1, P2         |
| **P7** | Frontend wiring (replace mocks)                                          | P6             |
| **P8** | SSE stream (stretch)                                                     | P5, P6         |

P0 + P1 parallelizable. P3 + P4 parallelizable.

---

## Validation

- [ ] `ingestion-core` exports `ObservationEvent` type (`pnpm packages:build`)
- [ ] `observation_events` table created via migration (TimescaleDB hypertable when available)
- [ ] `packages/poly-core` builds with all schemas and pure functions
- [ ] Polymarket adapter polls ≥100 markets
- [ ] Kalshi adapter polls ≥50 markets
- [ ] Price snapshots accumulate in `observation_events` every 60 sec
- [ ] 24h change computed from real observation data
- [ ] Threshold triggers fire on >5% price move (unit test)
- [ ] Temporal debounce: duplicate start within 5-min window rejected
- [ ] `poly-synth` graph returns valid `RawAssessment[]`
- [ ] `scoreEdge` filters <5% edge and <50% confidence (unit test)
- [ ] Action levels: observe < 70% conf, alert 70-85%, recommend 85%+
- [ ] All Activities idempotent (signal IDs deterministic)
- [ ] API endpoints return valid responses
- [ ] Landing page renders real data
- [ ] `pnpm check` passes

## Handoff

- [task.0227.handoff.md](../handoffs/task.0227.handoff.md)
