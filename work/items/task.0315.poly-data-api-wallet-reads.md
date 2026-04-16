---
id: task.0315
type: task
title: "Polymarket Data-API read methods — leaderboard, activity, positions"
status: needs_design
priority: 2
estimate: 1
rank: 5
summary: "Extend the existing PolymarketAdapter with three read-only methods — listTopTraders, listUserActivity, listUserPositions — against the public Polymarket Data API. Zero new ports; zero new deps; rate-limit-aware; paves the way for wallet ranking (task.0316) and live tracking (task.0317)."
outcome: "PolymarketAdapter exposes leaderboard, per-user activity, and per-user position queries. Contract tests prove response parsing. Rate-limit handling matches the existing adapter's pattern. No ingestion or persistence in this task."
spec_refs:
  - monitoring-engine
assignees: derekg1729
project: proj.poly-prediction-bot
created: 2026-04-16
updated: 2026-04-16
labels: [poly, polymarket, follow-wallet, data-api]
external_refs:
  - docs/research/poly-copy-trading-wallets.md
---

# Polymarket Data-API Read Methods

> Research: [poly-copy-trading-wallets](../../docs/research/poly-copy-trading-wallets.md)
> Project: [proj.poly-prediction-bot](../projects/proj.poly-prediction-bot.md)
> Follows: [spike.0314](./spike.0314.poly-copy-trading-wallets.md)

## Context

Research spike.0314 identified the Polymarket Data API as the right first-hop source for wallet discovery and live tracking. The existing `@cogni/market-provider/adapters/polymarket` only hits the Gamma market-listing endpoints. This task adds the three read-only Data-API endpoints we need, and nothing else.

## Design

Add three methods to the Polymarket adapter behind the existing `MarketProviderPort` extension pattern (mirroring how market listing is exposed). No new port surface yet — these are adapter-local helpers consumed by tasks 0316 and 0317.

- `listTopTraders(opts: { window: '7d'|'30d'|'all', limit?: number })`
- `listUserActivity(wallet: string, opts?: { sinceTs?: number, limit?: number })`
- `listUserPositions(wallet: string)`

Return Zod-validated types. Respect the shared rate-limit budget the adapter already tracks. Fail closed on schema mismatch with a clear error.

## Invariants

- [ ] READ_ONLY: no write, no order-placing code added in this task
- [ ] CONTRACT_IS_SOT: return shapes defined in `src/contracts/*.contract.ts` via Zod, consumed via `z.infer`
- [ ] RATE_LIMIT_SHARED: new methods share the existing adapter rate-limit budget, not a parallel one
- [ ] NO_NEW_PORT: no new port surface — adapter-local methods only

## Validation

- [ ] Contract tests cover each new method's happy path + schema-mismatch failure
- [ ] Hits the live Data API in at least one smoke test (gated behind external-tests lane)
- [ ] Rate-limit budget still respected under added call volume
- [ ] `pnpm check` passes

## Out of Scope

- Persistence, scheduling, observation events (belongs to tasks 0316, 0317).
- CLOB WebSocket or chain-event listener.
- Any writeback to knowledge or awareness planes.
