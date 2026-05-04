---
id: design.poly-hedge-followup-policy
type: design
status: active
created: 2026-05-04
updated: 2026-05-04
tags: [poly, copy-trading, hedge, rn1, swisstony, bet-sizer]
implements: task.0347
---

# Poly Hedge Follow-Up Policy

## Decision

Keep the as-built hedge gate for RN1 and swisstony:

```text
follow opposite-token BUY only when:
  target hedge cost basis >= $5
  target hedge / target primary cost basis >= 2%
  our mirror exposure >= max($5, market_floor * 5)
  proposed hedge <= 25% of our primary mirror exposure
  cumulative condition intent <= target mirror_max_usdc_per_trade
```

Do not add a second hedge-only pXX gate. The user's selected
`mirror_filter_percentile` remains the conviction gate for primary entries and
same-token layers. Hedge-specific gates are risk controls: they decide whether
the target's opposite-token leg is economically meaningful enough to mirror
with a market-min order.

## Why 2%

The key failure from `research.poly-mirror-divergence-2026-05-01` was not that
tiny fills are valuable by themselves. It was that tiny opposite-token fills can
complete a target's condition-level risk shape. RN1 bought a large NO position,
then added several tiny YES buys as the price fell. The old percentile-only
filter skipped the YES hedges and left Cogni holding an unhedged primary leg.

I re-sampled current public Data-API positions for the two copy targets on
2026-05-04 at `01:36Z`, using the first 500 active positions per wallet
(`sizeThreshold=0&limit=500`). For every binary condition with both tokens open,
I treated the larger cost-basis leg as primary and the smaller cost-basis leg as
the hedge.

| wallet    | active positions | hedged conditions | hedge >= $5 | >= 2% ratio | >= 5% ratio | useful ratio p10 | useful ratio p50 |
| --------- | ---------------: | ----------------: | ----------: | ----------: | ----------: | ---------------: | ---------------: |
| RN1       |              500 |                21 |          21 |          21 |          21 |           10.84% |           50.96% |
| swisstony |              500 |               154 |         150 |         141 |         125 |            3.95% |           26.09% |

Interpretation:

- RN1's current hedge legs are not subtle: every sampled useful hedge clears
  5%, and the lower tail starts around 10%.
- swisstony uses many more small protective legs. A 5% ratio would drop 25 of
  150 useful hedges. A 2% ratio keeps 141 of 150 useful hedges while still
  filtering the very smallest dust-like legs.
- The absolute `$5` floor matters more than the ratio for dust control. It
  removes non-economic legs before the ratio is evaluated.

So the threshold is:

```text
min_target_hedge_ratio = 0.02
min_target_hedge_usdc = 5
```

That matches the current `DEFAULT_POSITION_FOLLOWUP_POLICY` in
`nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts`.

## Prototype Surface

PR #1215 adds live-forward observed trader facts for RN1, swisstony, and active
Cogni wallets. This design builds on that by adding hedge-readiness fields to
the wallet-analysis benchmark response:

- `targetHedgedConditions`: active target conditions with exactly two open token
  legs;
- `targetHedgesPassingGate`: those whose smaller leg clears `$5` and `2%`;
- `lowestPassingHedgeRatio`: the smallest target hedge ratio currently passing
  the gate.

This is intentionally read-only and not currently rendered in the research UI.
It lets the API/read-model expose whether the policy would be active on the
saved target-position state before changing any CLOB execution behavior or
shipping user-facing hedge controls.

## Bet Sizing And Target Config

For hedging to be useful, active, and validateable on candidate-a:

1. Track RN1 and swisstony, not arbitrary unsnapshotted wallets. They are the
   two researched targets with position pXX snapshots and hedge-followup enabled.
2. Use `target_percentile_scaled` with `mirror_filter_percentile=75` for the
   default live setting. Drop to `50` only for a supervised soak where the goal
   is faster hedge/layer observation rather than conservative capital use.
3. Set `mirror_max_usdc_per_trade >= $5`. A lower value makes market floors and
   the hedge cap fight each other; most hedge follow-ups will skip before
   placement.
4. Ensure the tenant grant cap is not tighter than the target cap:
   `poly_wallet_grants.per_order_usdc_cap >= mirror_max_usdc_per_trade` and a
   daily cap high enough for several market-min follow-ups.
5. Leave `min_target_hedge_ratio=0.02`, `min_target_hedge_usdc=5`, and
   `max_hedge_fraction_of_position=0.25` until the research benchmark has at
   least one full day of observed target and Cogni wallet positions.

## Validation

exercise: On candidate-a, sign in with a funded and trading-ready Polymarket
wallet. Track RN1 and swisstony with `mirror_filter_percentile=75` and
`mirror_max_usdc_per_trade>=5`. Wait for `poly.trader.observe` to save position
snapshots, then request the wallet-analysis benchmark slice for
`/api/v1/poly/wallets/0x2005d16a84ceefa912d4e380cd32e7ff827875ea?include=benchmark`
and
`/api/v1/poly/wallets/0x204f72f35326db932158cba6adff0b9a1da95e14?include=benchmark`;
confirm `benchmark.hedgePolicy` reports the configured thresholds and nonzero
target hedge counts when either target has active two-leg conditions.

observability: Query Loki at the deployed SHA for
`event="poly.trader.observe"` wallet_ok events for RN1/swisstony and
`event="poly.mirror.decision"` with `position_branch="hedge"` or
`reason="target_position_below_threshold"`. A validated hedge prototype has the
benchmark API showing actionable hedge counts and Loki showing either a placed
hedge or an explicit threshold skip for a same-condition opposite-token fill.
