---
id: spike.0314
type: spike
title: "Research: copy-trading existing Polymarket wallets from the poly node"
status: done
priority: 2
estimate: 1
rank: 5
summary: "Survey the data sources, OSS libraries, signal pipeline, and regulatory/architectural constraints for letting the poly node identify, rank, track, and (eventually) mirror top Polymarket wallets. Output a research doc + proposed layout plugging into proj.poly-prediction-bot's Run-phase 'Follow-a-wallet' deliverable."
outcome: "Research doc shipped at docs/research/poly-copy-trading-wallets.md with a recommended three-tier pipeline (Data-API discovery → activity poller → ObservationEvent → paper-trading mirror), an OSS survey, rejected alternatives, and a follow-up task/spike sequence."
spec_refs:
assignees: derekg1729
credit:
project: proj.poly-prediction-bot
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-16
updated: 2026-04-17
labels: [poly, polymarket, copy-trading, follow-wallet, research, spike]
external_refs:
  - docs/research/poly-copy-trading-wallets.md
---

# Research: Copy-Trading Polymarket Wallets

> Research doc: [poly-copy-trading-wallets](../../docs/research/poly-copy-trading-wallets.md)
> Project: [proj.poly-prediction-bot](../projects/proj.poly-prediction-bot.md) (Run phase — "Follow-a-wallet")
> Related: [task.0311 poly knowledge syntropy seed](./task.0311.poly-knowledge-syntropy-seed.md), [poly strategy knowledge ingestion MCP](../../docs/research/poly-strategy-knowledge-ingestion-mcp.md)

## Question

How does the poly node go from read-only market access to **tracking and mirroring successful Polymarket wallets** without running a bespoke chain indexer, violating third-party ToS, or cross-wiring the awareness and knowledge planes? What is the minimum signal-pipeline shape that makes paper-trading and eventual real execution low-risk to add later?

## Summary of Findings

See the research doc for full detail. Key decisions:

- **Data source:** Polymarket Data API (`/leaderboard`, `/activity`, `/positions`) as the primary live feed; Goldsky subgraph for backfill/discovery only. Reject third-party analytics scraping. Reject running a Polygon block-listener until Data-API latency is proven inadequate.
- **Execution libraries:** `@polymarket/clob-client` (MIT) + `@polymarket/order-utils` behind a future `OrderExecutionPort`. Not wired in this research.
- **Signal shape:** Reuse the shipped awareness plane. Add one new primitive: `ObservationEvent(kind=polymarket_wallet_trade)`. Feed the existing `poly-synth` analysis graph. Promote validated patterns into `knowledge_poly` via the task.0311 bridge.
- **Fatal risk:** Slippage. Naive copy-trading loses to slippage. A 2-week edge-validation spike is a hard gate before any mirror execution ships.
- **Legal:** US-user mirroring is out; DAO-treasury-scale execution needs counsel; paper trading has no such gate.

## Deliverables

- [x] `docs/research/poly-copy-trading-wallets.md` — full research doc with options, recommendation, open questions, and proposed layout.
- [x] Follow-up items created (see below).
- [x] This spike marked `done`.

## Follow-ups

See the **Proposed Layout** section in the research doc for the full sequence. Items created:

1. `task.0315` — Polymarket Data-API read methods (`listTopTraders`, `listUserActivity`, `listUserPositions`).
2. `task.0316` — Wallet-ranking batch job + `poly_tracked_wallets` awareness table.
3. `task.0317` — Live wallet poller → `ObservationEvent(kind=polymarket_wallet_trade)`.
4. `spike.0318` — Signal-edge validation (≥2 weeks, pre-slippage vs market baseline). **Gate for mirror execution.**

Deferred until the edge-validation spike lands: paper-trading mirror, execution adapter spike, knowledge-plane write-back task.

## Validation

- [x] Research doc published at `docs/research/poly-copy-trading-wallets.md`
- [x] Options, recommendation, open questions, and proposed layout captured
- [x] Follow-up items created: task.0315, task.0316, task.0317, spike.0318
- [x] `pnpm check:docs` passes

## Out of Scope

- Chain indexer (deferred behind Data-API latency).
- CLOB WebSocket placement-level signal (top-tier, not MVP).
- On-chain real-money trading (Phase 3; gated on edge validation + legal).
- Kalshi follow-a-wallet (different legal and data world).
- UI for the tracked-wallet roster (chat-tool surface is enough for v0).
