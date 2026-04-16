---
id: spike.0318
type: spike
title: "Validate copy-signal edge vs market baseline (2-week instrumentation)"
status: needs_design
priority: 2
estimate: 2
rank: 5
summary: "Run the Tier-1 roster + Tier-2 poller live for ≥2 weeks and measure whether copy-signals (pre-slippage) have statistically significant edge vs market baseline. Hard gate for anything downstream — paper trading, execution adapter, real money. If pre-slippage edge < plausible slippage curve, the Run-phase 'Follow-a-wallet' plan does not ship."
outcome: "A signed-off decision record in docs/research/ that either greenlights Phase 3 (paper trading + execution adapter) or kills it with evidence. Includes latency histogram, per-category edge numbers, and a slippage model calibrated against real book depth."
spec_refs:
assignees: derekg1729
project: proj.poly-prediction-bot
blocked_by: task.0317
created: 2026-04-16
updated: 2026-04-16
labels: [poly, polymarket, follow-wallet, edge-validation, spike]
external_refs:
  - docs/research/poly-copy-trading-wallets.md
---

# Copy-Signal Edge Validation

> Research: [poly-copy-trading-wallets](../../docs/research/poly-copy-trading-wallets.md)
> Project: [proj.poly-prediction-bot](../projects/proj.poly-prediction-bot.md)
> Follows: [spike.0314](./spike.0314.poly-copy-trading-wallets.md), [task.0317](./task.0317.poly-wallet-live-poller.md)

## Context

The research doc flags slippage as the fatal risk of naive copy-trading. This spike is the gate: we instrument a live paper-observation run, compare realized wallet PnL against what a ≥30-second-delayed mirror would have achieved at the live book, and decide whether to proceed.

## Hypotheses to test

1. **Pre-slippage edge exists.** Mirror trades at tracked-wallet prices earn positive expected return net of Polymarket fees over N≥100 signals.
2. **Slippage is bounded.** The realistic slippage curve (mirror order arrives ≥30 s after fill) does not eat all of hypothesis 1's edge.
3. **Category matters.** Edge concentration is heterogeneous — some categories (sports, crypto) may carry the signal while others (politics near resolution) are dead on arrival.

## Measurements

- Per-signal latency: `ObservationEvent.observed_at - fill_ts`.
- Per-signal hypothetical mirror fill price at the mid of the live book at `observed_at + 5 s`.
- Per-signal realized market outcome + time-to-resolution.
- Per-category aggregates: hit rate, mean PnL, Sharpe, max drawdown.
- Significance: bootstrap CI on mean PnL per category; reject null only if 95 % CI excludes zero net of fees and slippage.

## Deliverables

- [ ] Instrumentation script (one-shot, lives under `nodes/poly/scripts/`)
- [ ] Raw dataset exported to `work/research-datasets/` (gitignored; summary committed)
- [ ] Decision doc in `docs/research/poly-copy-signal-edge.md` — green/red with evidence
- [ ] Recommendation for the next step: (a) ship paper-trading mirror, (b) iterate on ranking, or (c) shelve

## Exit Criteria

Spike is `done` when the decision doc lands and either:

- **Green:** ≥1 category passes hypothesis 1 + 2 and a paper-trading mirror task is created, or
- **Red:** all categories fail; `proj.poly-prediction-bot` Run phase removes the Follow-a-wallet deliverable or reframes it.

## Validation

- [ ] ≥2 weeks of live data captured across the Tier-1 roster
- [ ] Per-category bootstrap CIs computed and written up
- [ ] Decision doc `docs/research/poly-copy-signal-edge.md` merged
- [ ] Follow-up items created (paper-trading mirror, or Run-phase scope change)
- [ ] `pnpm check:docs` passes

## Out of Scope

- Building the mirror executor (follow-up if green)
- Real-money execution (legal + further research)
- Proxy-wallet architecture (separate spike)
