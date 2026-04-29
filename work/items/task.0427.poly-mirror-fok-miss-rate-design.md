---
id: task.0427
type: task
title: "Poly mirror — design pass on FOK miss rate / CLOB pressure (limit vs market vs price-aware FOK)"
status: needs_design
priority: 2
rank: 15
estimate: 5
summary: "Design spike. Production observation 2026-04-29: of 2566 real placement attempts in 1h, only 92 reached `placed ok` and only 13 actually filled — a **96% rejection / 14:1 attempt-to-fill ratio**. We submit FOK market orders at the worst price the CLOB will accept; targets place limit orders at chosen prices; we never see their price intent (only their fills via data-api), so our FOK throws at scrub price and the spread usually moves past us. Beyond the bookkeeping cost (bug.0426), this is real **CLOB API pressure** — Polymarket may rate-limit, soft-throttle, or block us if we keep firing high-volume orders that mostly fail. Need a design pass on whether to switch to limit orders, FOK at observed-fill-price, FOK at midpoint, hybrid, or something else. Output: a design doc + decision, not code."
outcome: "A short design doc (or `/design` lifecycle output) lands on this task with: (a) measured miss rate per strategy in a backtest or staging replay, (b) decision on placement strategy with rationale, (c) explicit rate-limit headroom analysis (current observed CLOB request rate vs Polymarket's documented limits, vs our risk threshold), (d) follow-up implementation task(s) filed. Decision is reviewed and approved before any implementation lands. Out of scope: the implementation itself."
spec_refs:
  - poly-copy-trade-phase1
assignees: []
project: proj.poly-copy-trading
created: 2026-04-29
updated: 2026-04-29
labels: [poly, copy-trading, clob, rate-limit, design, mirror-pipeline]
external_refs:
  - work/items/bug.0405.poly-clob-sell-fak-generates-dust.md
  - work/items/bug.0426.poly-mirror-poll-redecision-spam.md
  - packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts
  - nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts
---

# task.0427 — Mirror FOK miss rate design pass

## Why

Production data 2026-04-29 (1h window, single tenant, 2 active targets, post-V2 cutover):

| stage                          | count |   notes |
| ------------------------------ | ----: | ------: |
| real placement attempts        |  2566 |      —  |
| `placed ok` (CLOB accepted)    |    92 |   ~3.6% |
| actually filled (size > 0)     |    13 |  ~0.5% |

**~96% of orders are rejected pre-acceptance.** Of the ones the CLOB accepts, ~86% return zero fill (FOK no-match — ladder cleared before our turn). End-to-end attempt-to-fill ratio is 14:1.

Two costs:

1. **Position divergence** — bug.0405's design accepts dust by using FOK to avoid open-order baggage, but the cost is we mirror almost none of the target's trades, so position shape diverges hard from theirs. Already documented as a tradeoff there ("divergence is recoverable; dust isn't").
2. **CLOB API pressure** — *new concern*. We're submitting ~40 orders/min on a single tenant. Polymarket may rate-limit, soft-throttle, or block us if we keep this up at scale. With one tenant + two targets we're at 40/min; the planned shared-poller (task.0332) and additional tenants multiply that linearly.

bug.0426 reduces redundant *internal* decision work, not actual CLOB calls. This task is the actual CLOB-call problem.

## Why this is a design spike, not a fix

There is no clear right answer. Each option trades off differently:

| Option                                   | Miss rate | Open-order risk           | Position match | API pressure      |
| ---------------------------------------- | --------- | ------------------------- | -------------- | ----------------- |
| **A. Status quo (FOK at scrub price)**   | ~96%      | None                      | Bad            | Bad               |
| **B. FOK at target's observed fill price** | Lower (?) | None                      | Better         | Better            |
| **C. FOK at midpoint / mark-price**      | Medium    | None                      | Medium         | Medium            |
| **D. Limit order at target's fill price** | Low miss; fills async | Open-order baggage (dust risk per bug.0405) | Best | Lowest |
| **E. Hybrid: try FOK first, fall back to limit if miss** | Best in theory | Some open-order risk      | Best           | Worst — 2× calls per fill |

Each needs measurement, not just argument. The `/design` lifecycle is the right shape.

## Scope of the spike

1. **Measure ground-truth miss rate per strategy.** Either via a staging replay (record real target fills for ~1 day, replay them through each strategy in a sandboxed CLOB context) or a backtest against historical book snapshots. Pick the cheapest path that yields signal.
2. **Quantify CLOB rate-limit headroom.** Read Polymarket's documented limits if they exist; otherwise observe error responses for `429` / `503` / `rate_limit_exceeded` shapes in our own logs. State the tenant-count / target-count where each strategy hits the ceiling.
3. **Decide & document.** Pick a strategy. Write a 1–2 page design doc capturing: the chosen strategy, the measured numbers backing the choice, rejected alternatives with rationale, and the open-order-management plan if D or E is chosen (because that re-opens bug.0405's dust concern).
4. **File implementation tasks.** Whatever the design lands on becomes one or more sub-tasks. Don't implement here.

## Out of scope

- Implementing the chosen strategy (file as a separate task).
- Per-position cap (task.0424) — orthogonal, separate concern.
- Poll cursor (bug.0426) — orthogonal, separate concern.
- Phase-4 CLOB websocket migration (task.0322) — does not change the placement-strategy question, only the polling shape.
- Re-opening the FOK-vs-limit decision in bug.0405 (which was about dust, not miss rate) — this task can supersede it if the design lands on D, but bug.0405 stays as the dust-management contract until then.

## Validation

This is a design task. "Validation" is design-doc landing + Derek-approved decision recorded on the task before any implementation kicks off.

## Hand-offs

- If the design picks D (limit orders), the open-order management strategy needs to address bug.0405's invariants — likely a TTL on resting orders + a cancel-on-stale path. Capture that in the spawn-task.
- If the design picks B (FOK at target fill price), confirm we have the target's per-fill price in our existing data-api response shape (we should — `/trades` returns price per fill).
