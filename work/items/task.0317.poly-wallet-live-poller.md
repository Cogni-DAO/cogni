---
id: task.0317
type: task
title: "Live wallet poller → ObservationEvent(kind=polymarket_wallet_trade)"
status: needs_design
priority: 2
estimate: 2
rank: 5
summary: "Temporal workflow polls each tracked wallet's Polymarket /activity endpoint every 30 s, emits an ObservationEvent(kind=polymarket_wallet_trade) on each new fill, idempotent on (wallet, fill_id). Feeds the existing poly-synth analysis graph via the same awareness-plane pipe already shipped for market observations."
outcome: "Each wallet in poly_tracked_wallets generates an ObservationEvent on every fresh trade within ≤60 s of the fill. Idempotency guarantees no duplicate events on re-runs. No new analysis code — poly-synth consumes the new kind alongside existing observations."
spec_refs:
  - monitoring-engine
  - data-streams
assignees: derekg1729
project: proj.poly-prediction-bot
blocked_by: task.0316
created: 2026-04-16
updated: 2026-04-16
labels: [poly, polymarket, follow-wallet, awareness, temporal]
external_refs:
  - docs/research/poly-copy-trading-wallets.md
---

# Live Wallet Poller → ObservationEvent

> Research: [poly-copy-trading-wallets](../../docs/research/poly-copy-trading-wallets.md)
> Project: [proj.poly-prediction-bot](../projects/proj.poly-prediction-bot.md)
> Follows: [spike.0314](./spike.0314.poly-copy-trading-wallets.md), [task.0315](./task.0315.poly-data-api-wallet-reads.md), [task.0316](./task.0316.poly-wallet-ranking-batch.md)

## Context

Tier 2 of the three-tier pipeline in the research doc. Once a roster exists (task.0316), we need a live feed that turns new Polymarket fills on those wallets into `ObservationEvent` rows that the existing `poly-synth` analysis graph already knows how to consume.

Fill-only is acceptable for v0 — placement-level signal via CLOB WebSocket is a later top-tier feature flagged in the research doc.

## Design

### New observation kind

`ObservationEvent.kind = 'polymarket_wallet_trade'` with payload:

```
{
  wallet: string,
  fill_id: string,
  market_id: string,
  outcome: string,        // YES | NO | multi-outcome label
  price: number,
  size_usd: number,
  side: 'buy' | 'sell',
  filled_at: ISO8601,
  source_category: string // from poly_tracked_wallets
}
```

Dedup key: `(wallet, fill_id)` — unique index.

### Workflow

Temporal parent workflow iterates the roster on a 30-second cadence; per-wallet child activity pulls `listUserActivity(wallet, sinceTs=lastSeen)` and emits `ObservationEvent` rows for new fills. Per-wallet `lastSeen` cursor persists in Postgres so restarts don't miss fills.

Respect the shared adapter rate-limit budget from task.0315 — the poller backs off on 429.

### Consumption

`poly-synth` already reads from `ObservationEvent` and produces `analysis_signal` rows. No graph changes required in this task; the new `kind` flows through by virtue of being a new observation value.

## Invariants

- [ ] FILL_IDEMPOTENCY: unique `(wallet, fill_id)` index — replays never double-emit
- [ ] AWARENESS_ONLY: no writes to `knowledge_poly` in this task
- [ ] RATE_LIMIT_SHARED: poller participates in the existing adapter rate-limit budget
- [ ] NO_EXECUTION: observation pipeline only — no order placement
- [ ] CURSOR_PERSISTED: per-wallet `lastSeen` survives worker restart

## Validation

- [ ] Polling a wallet with a new fill emits exactly one `ObservationEvent` per `(wallet, fill_id)` across restarts
- [ ] `poly-synth` consumes the new kind end-to-end in a stack test
- [ ] Worker restart preserves per-wallet `lastSeen` cursor
- [ ] 429 back-off exercised in a unit test
- [ ] `pnpm check` passes

## Out of Scope

- Edge-validation measurement → spike.0318
- Paper-trading mirror → follow-up task after spike.0318
- CLOB WebSocket placement-level signal
- Knowledge-plane writeback
