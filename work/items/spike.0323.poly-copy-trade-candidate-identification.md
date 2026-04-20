---
id: spike.0323
type: spike
title: "Research: Polymarket copy-trade candidate identification"
status: done
priority: 2
estimate: 1
rank: 5
summary: "Given the architecture spike (0314) is done and task.0315 shipped a one-shot trade tool, identify 2-3 concrete Polymarket wallets worth copy-trading. Requires (a) establishing which market niches admit persistent edge, (b) screening leaderboard wallets by trade frequency / specialization / recency / realized ROI proxies, (c) honest reporting on what can and cannot be verified from the public Data API alone."
outcome: "Research doc at docs/research/polymarket-copy-trade-candidates.md with: market-niche edge scorecard (web-cited), wallet funnel methodology + results, 2-3 named candidate wallets with per-wallet scorecards, explicit open questions on edge-verification, and one or more follow-up task/spike items."
spec_refs:
assignees: derekg1729
credit:
project: proj.poly-copy-trading
branch: worktree-poly-top-wallet-v0
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-18
updated: 2026-04-18
labels: [poly, polymarket, copy-trading, follow-wallet, research, spike]
external_refs:
  - docs/research/polymarket-copy-trade-candidates.md
  - docs/research/fixtures/poly-wallet-metrics.json
  - scripts/experiments/top-wallet-metrics.ts
  - scripts/experiments/top-wallet-recent-trades.ts
  - work/items/spike.0314.poly-copy-trading-wallets.md
  - work/items/task.0315.poly-copy-trade-prototype.md
  - work/items/task.0322.poly-copy-trade-phase4-design-prep.md
---

# Research: Polymarket Copy-Trade Candidate Identification

> Research doc: [polymarket-copy-trade-candidates](../../docs/research/polymarket-copy-trade-candidates.md)
> Project: [proj.poly-prediction-bot](../projects/proj.poly-prediction-bot.md)
> Prior spike: [spike.0314 poly-copy-trading-wallets](./spike.0314.poly-copy-trading-wallets.md) — architecture & pipeline
> Prototype: [task.0315 poly-copy-trade-prototype](./task.0315.poly-copy-trade-prototype.md) — auth + one-shot trade tool

## Question

spike.0314 decided _how_ to copy-trade (Data API → observation → paper-mirror). task.0315 proved we can _place_ a trade. The missing piece: **which 2-3 wallets do we actually mirror for v0 paper trading?** A good candidate (a) trades frequently enough to produce signal, (b) operates in a Polymarket niche where edge is structurally possible (sharps vs. square, insider flow, analytical asymmetry), (c) has fast-resolving markets so capital turns over, and (d) has a realized-ROI track record that looks like skill, not a lucky whale bet.

## Summary of Findings

See the full research doc. Key decisions:

- **Category scope for v0: sports-only (including esports).** Crypto bucket markets are uncopyable (sub-block latency arb); geopolitics / celebrity-event markets are insider-flagged (Harvard 2026-03 paper) and carry regulatory tail risk; elections are thesis-trader territory, not flow-trader.
- **Three recommended candidates** with confidence=medium:
  1. `bossoskil1` (`0xa5ea13a8…`) — esports specialist, +$1.4M round-trip across 28 markets (strongest "skill not luck" signal).
  2. `0x36257cb6…` (anon) — NBA specialist, 15.2% leaderboard ROI, cleanest profile.
  3. `CarlosMC` (`0x777d9f00…`) — multi-sport diversifier.
- **Binding limitation**: true edge verification (entry-price vs. implied probability, resolution outcomes) requires cross-referencing `gamma-api.polymarket.com/markets`. Opens follow-up spike.0324.
- **Explicit avoids named**: `JPMorgan101` (BTC bucket latency-arb bot, uncopyable), `denizz` (Iran ceasefire wallet, insider-flagged category), `avenger` (outlier $2k-volume lottery win).

## Deliverables

- [x] `docs/research/polymarket-copy-trade-candidates.md` — market-niche scorecard, wallet funnel, top 3 scorecards, proposed layout
- [x] JSON fixture of raw wallet metrics at `docs/research/fixtures/poly-wallet-metrics.json`
- [x] Collection script at `scripts/experiments/top-wallet-metrics.ts` (re-runnable)
- [x] v0 read-only probe at `scripts/experiments/top-wallet-recent-trades.ts`
- [x] Follow-up items created (see below)
- [x] This spike marked `done`

## Follow-ups

None filed. Three next-step directions are captured as prose in the research doc's "Follow-up work" section — resolution-outcome verification, observation emitter, paper-mirror harness — in rough priority order. They become work items only if/when we commit to the feature. No preemptive decomposition.

## Validation

- [x] Research doc published and lint-clean (`pnpm check:docs`)
- [x] Recommendation names 3 wallet addresses with justified scorecards
- [x] Open questions section explicitly calls out what resolution-cross-referencing would change

## Out of Scope

- Live paper-trading integration (separate task)
- On-chain real-money mirroring (Phase 3 of the project roadmap)
- Resolution-timestamp cross-referencing against gamma-api (follow-up task if research proves it's the binding constraint)
