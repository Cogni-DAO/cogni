---
id: design.poly-bet-sizer-v1
type: design
status: active
created: 2026-05-02
updated: 2026-05-03
tags: [poly, copy-trading, bet-sizer, rn1, swisstony]
implements: task.5005
---

# Poly Bet-Sizer v1

## One Screen

This doc describes the current hardcoded copy-target sizing policy and the
critical correction after PR #1203: **pXX must mean target position size, not
individual order size.** Individual target orders are only triggers. The
decision to create or add to a mirror position should be based on the target's
current condition/token position and our current mirror position.

## Current As-Built State

Position-aware mirror sizing is hardcoded for the two researched target wallets:

| Wallet                                       | Label     | p50 |  p75 |  p90 |    p95 |    p99 |
| -------------------------------------------- | --------- | --: | ---: | ---: | -----: | -----: |
| `0x2005d16a84ceefa912d4e380cd32e7ff827875ea` | RN1       | $40 | $200 | $733 | $1,811 | $5,659 |
| `0x204f72f35326db932158cba6adff0b9a1da95e14` | swisstony | $31 | $146 | $665 | $1,394 | $4,809 |

Snapshot source in code:
`nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts`
`TOP_TARGET_SIZE_SNAPSHOTS`.

Snapshot metadata: current token-position cost-basis distribution from
Polymarket Data API `/positions?sizeThreshold=0`, captured at
`2026-05-03T02:34Z`.

As-built behavior:

- Curated target wallets use `target_percentile_scaled`.
- `mirror_filter_percentile` defaults to `75`, and `50` is a real configured
  threshold for the curated wallets.
- `mirror_max_usdc_per_trade` defaults to `$5`.
- `placement.kind` defaults to `mirror_limit`.
- `position_followup` is enabled for these snapshot-backed wallets.
- New-entry, layer, and hedge BUY branches all evaluate the target's current
  condition/token position cost basis against the table above.
- Hedge threshold calibration is documented in
  [`design.poly-hedge-followup-policy`](poly-hedge-followup-policy.md). The
  as-built default remains `min_target_hedge_ratio=0.02` and
  `min_target_hedge_usdc=$5`.

The exact source-of-truth values are in:

- `nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts`
- `nodes/poly/app/src/features/copy-trade/plan-mirror.ts`
- `nodes/poly/app/src/features/copy-trade/types.ts`

## Correct MVP Policy: One pXX, Position-Sized

## Mental Model

```text
target position size

  below selected pXX        selected pXX                     p99+
  ------------------|-----------------------------|------------->
        SKIP              mirror market min bet       mirror max bet
                           \_____________________/
                              scales linearly
```

Example with `p75` selected and `$5.00` max:

```text
target position below p75      -> skip
target position exactly p75    -> place market minimum
target position halfway p75 to p99 -> place halfway between min and $5.00
target position p99 or larger      -> place $5.00, subject to grant caps
```

For MVP, there should not be separate order-pXX and position-pXX controls.
There is one user-facing percentile selector, and it selects the threshold on
the target's current condition/token position size.

Individual order size should only decide whether there is a new trigger to
evaluate. It should not be the conviction gate.

Use token-position cost basis when comparing against
`TargetConditionPositionView.tokens[].cost_usdc`. Use condition-total thresholds
only if the planner explicitly compares total condition exposure across both
tokens.

## Formula

For the corrected MVP, snapshot-backed wallets should still use
`target_percentile_scaled`, but `target_usdc` must be the target's current
condition/token position cost basis, not the current target order notional:

```text
threshold = snapshot[pXX]
max_target = snapshot[p99]
floor = market minimum bet for this market

if target_position_usdc is unavailable:
  skip below_target_percentile

if target_position_usdc < threshold:
  skip below_target_percentile

ratio = clamp((target_position_usdc - threshold) / (max_target - threshold), 0, 1)
mirror_usdc = floor + (user_max_usdc - floor) * ratio
mirror_usdc = apply market floors, then clamp to user_max_usdc
```

Branch choice:

```text
if no mirror position on condition:
  branch = new_entry
elif target token == our_token_id:
  branch = layer
elif target token == opposite_token_id:
  branch = hedge
else:
  skip
```

All branches use the same target-position pXX gate. Layer/hedge additionally
require our mirror exposure to be large enough that the market floor is not a
chunky over-adjustment.

If the market minimum is already above the user max, the plan skips as
`below_market_min`.

## User Controls

Both controls are stored per active copied target:

| Control                     | Meaning                            | Default |
| --------------------------- | ---------------------------------- | ------- |
| `mirror_filter_percentile`  | Which pXX threshold starts copying | `75`    |
| `mirror_max_usdc_per_trade` | Mirror size at p99 and above       | `5.00`  |

These are persisted on `poly_copy_trade_targets`. The distribution itself is
not in the database today; only the user's selected pXX and max bet are.

Wallets without a saved snapshot use explicit `min_bet` sizing. They do not
silently pretend to have percentile sizing.

## Boundaries

- Wallet detection does not decide sizing.
- Websocket/Data-API normalization does not decide sizing.
- Collateral wrapping does not decide sizing.
- The CLOB adapter only executes an already planned order.
- `planMirrorFromFill()` is the pure decision point.
- `authorizeIntent()` remains the downstream grant/cap enforcement point.

## Code Pointers

- Snapshot distributions and bootstrap policy:
  `nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts`
- Sizing math:
  `nodes/poly/app/src/features/copy-trade/plan-mirror.ts`
- Policy types/schema:
  `nodes/poly/app/src/features/copy-trade/types.ts`
- DB columns:
  `nodes/poly/packages/db-schema/src/copy-trade.ts`
- DB migration:
  `nodes/poly/app/src/adapters/server/db/migrations/0038_poly_copy_trade_target_policy.sql`
- API contract:
  `nodes/poly/packages/node-contracts/src/poly.copy-trade.targets.v1.contract.ts`
- API routes:
  `nodes/poly/app/src/app/api/v1/poly/copy-trade/targets/route.ts`
  `nodes/poly/app/src/app/api/v1/poly/copy-trade/targets/[id]/route.ts`
- Money page controls:
  `nodes/poly/app/src/components/kit/policy/TargetCopyPolicyControls.tsx`
  `nodes/poly/app/src/app/(app)/credits/PolicyPanel.tsx`
