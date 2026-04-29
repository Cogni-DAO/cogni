---
id: task.0424
type: task
title: "Poly bet sizer — per-(tenant, market) position cap (reuse `max_usdc_per_trade` for v0)"
status: needs_review
revision: 1
priority: 1
rank: 5
estimate: 2
summary: "Extend the existing `SizingPolicy` cap from `per-trade` to `per-(tenant, market) position`. Today `max_usdc_per_trade` only bounds a single fill's notional. High-frequency targets that ladder into the same market produce many sub-cap fills that compound — observed on production 2026-04-29: target 0x204f… laddered into market `9d79544c2682` 7+ times, each mirrored fill ≤$3.05, cumulative position $21.35 from a $5/trade cap. v0 reuses the same `max_usdc_per_trade` field as the position ceiling (one knob, applied to both bounds) so we don't need a new field, schema, or grant change. Splits into separate per-trade vs per-position knobs only if a real target ever needs that distinction."
outcome: "Before placing a mirror BUY, `plan-mirror` reads cumulative filled notional for `(billing_account_id, market_id)` and skips with `position_cap_reached` if `existing + intent_usdc > max_usdc_per_trade`. Skip is logged as `poly.mirror.decision outcome=skipped reason=position_cap_reached` and does NOT write a ledger row (same shape as `below_market_min`). Cumulative read is the sum of `poly_copy_trade_orders.size_usdc` where `outcome=ok` for that (tenant, market) — no on-chain query, no extra port. SELL is unaffected (closes are bounded by held shares, not the cap)."
spec_refs:
  - poly-copy-trade-phase1
  - poly-multi-tenant-auth
assignees: []
project: proj.poly-bet-sizer
created: 2026-04-29
updated: 2026-04-29
deploy_verified: false
labels: [poly, copy-trading, sizing, policy, position-cap]
external_refs:
  - work/items/task.0404.poly-bet-sizer-v0.md
  - work/items/bug.0426.poly-mirror-poll-redecision-spam.md
  - nodes/poly/app/src/features/copy-trade/plan-mirror.ts
  - nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts
---

# task.0424 — Per-position cap on the bet sizer

## Why

Production observation 2026-04-29 (after V2 cutover, candidate operator funder was $100):

| market         | mirrored fills | cumulative filled |
| -------------- | -------------: | ----------------: |
| `9d79544c2682` |              7 |        **$21.35** |
| `542da4b33d86` |              3 |             $9.00 |
| `a7a23784dbba` |              3 |             $6.75 |

Per-trade cap is $5. Every individual fill respected it. But the cap is **per-fill**, not **per-(tenant, market)**. When a target ladders into one market 7 times, we mirror 7 fills, all sub-cap, summing to >4× the per-trade ceiling on a single market. Account total exposure ballooned beyond what a $5 "max risk per copied fill" ever implied to the user.

The user's mental model of "$5 max" is the position bound, not the fill bound. Fix the policy to match the model.

## Scope

**One field, one check, one log.**

In `applySizingPolicy` (or directly in `plan-mirror.ts` BUY branch — pick whichever has cleaner deps to the orders table), before returning a sized intent:

1. Read `SUM(size_usdc)` from `poly_copy_trade_orders` where `billing_account_id = tenant`, `market_id = intent.market_id`, `outcome = 'ok'`, `revoked_at IS NULL` (or whatever the project's "this fill counts" predicate is — match what `INSERT_BEFORE_PLACE` already uses for COID lookups so the bounds are consistent).
2. If `existing + intent.size_usdc > sizing.max_usdc_per_trade` → return skip `{ reason: "position_cap_reached", existing_usdc: existing }`.
3. Otherwise unchanged.

**Reuses the existing `max_usdc_per_trade` field.** v0 uses one knob for both bounds. A real target that justifies splitting (e.g. one where a $5 trade in a $20 position is genuinely the right policy) is the trigger to add a second field.

**No new port, no new schema, no grant change, no UI.**

## Out of scope

- A separate `max_usdc_per_position` field. Add it later only if a target's behavior justifies the complexity.
- Reading on-chain pUSD position size. The DB-tracked filled total is authoritative for our bookkeeping; on-chain drift is a different bug.
- Backfilling the cap against existing positions. v0 only constrains forward.
- SELL bounds (already constrained by held shares).
- Time-windowed caps ("$5 per 24h per market"). Different shape, defer.

## Files to touch

- `nodes/poly/app/src/features/copy-trade/plan-mirror.ts` — add the cumulative-notional read + cap check before returning the sized intent. New `position_cap_reached` skip reason.
- `nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts` — extend the decision-log enum if `reason` is typed.
- `packages/poly-copy-trade-store/src/port/...` (or wherever `poly_copy_trade_orders` reads live) — add a cumulative-notional reader if not already there. One query, indexed by `(billing_account_id, market_id)`.
- Tests: extend `plan-mirror.test.ts` with fixtures for first-fill-under-cap (place), Nth-fill-tips-over-cap (skip), Nth-fill-still-under-cap (place).

## Validation

**exercise:** point a tenant at a known high-frequency target (or replay), let one market accumulate near-cap, observe the next mirror intent skip with `position_cap_reached` instead of placing.

**observability:**

```logql
{env="candidate-a", service="app"} | json
  | event="poly.mirror.decision"
  | reason="position_cap_reached"
```

Should fire once per attempted-but-capped fill, with `existing_usdc + intent_usdc > max_usdc_per_trade`.

## Revision 1 — addressed

- **Renamed `cumulativeFilledForMarket` → `cumulativeIntentForMarket`.** Field on `RuntimeState` renamed to `cumulative_intent_usdc_for_market`. Docstring on the port now states explicitly: "intent, not filled" and explains the v0 rationale (FOK-heavy regime, ~14% fill rate, switching to filled-based would let no-match attempts keep firing through the cap; revisit post task.0427).
- **Gated cumulative DB read on `!already_placed_ids.includes(client_order_id)`** in `mirror-pipeline.ts`. Duplicate fills no longer trigger a redundant query.
- **Added boundary-equality fixture** in `plan-mirror-sizing-fixed.test.ts` (cumulative + size = cap exactly → places).
- **Added min_bet variant fixture** in `plan-mirror-sizing-min-bet.test.ts`.
- **Added direct unit test** for `FakeOrderLedger.cumulativeIntentForMarket`: empty / sums non-failed rows / excludes failed status / excludes wrong market / excludes wrong tenant / fail-closed Infinity.

Test count: 53 → 61 across copy-trade + trading. All passing.

## Review Feedback (revision 1)

PR #1131 review surfaced a blocker plus several non-blocking suggestions. The blocker is the only thing required before re-review.

**BLOCKER — function name vs behavior mismatch.** `OrderLedger.cumulativeFilledForMarket` is named "Filled" and the doc claims "committed exposure", but the SQL sums `attributes->>'size_usdc'` (intent), not `attributes->>'filled_size_usdc'` (actual fill). In the current FOK-heavy regime this matters: a `pending` row holds intent $5 for ~30s before the reconciler stamps `canceled`, so cumulative inflates well past actual on-chain exposure during that window. Pick one and ship it explicitly:

- **Option A — keep intent-based, rename + document.** Rename to `cumulativeIntentForMarket`. Add a docstring sentence: "v0 sums intent because filled would let FOK no-matches keep firing through the cap; revisit when FOK miss-rate drops post-task.0427." Update the `RuntimeState.cumulative_filled_usdc_for_market` field name to match (`cumulative_intent_usdc_for_market`).
- **Option B — switch to filled.** Read `(attributes->>'filled_size_usdc')::numeric`, narrow status set to `('filled', 'partial')`, keep the `cumulativeFilled…` name. Note: this means a tenant on a busy target could re-attempt many times before any of them fills enough to trip the cap.

Lean toward A unless the implementer disagrees — better matches "don't keep placing intents past the cap", which is what surfaced this work in the first place.

**Non-blocking suggestions (consider but not required):**

- `mirror-pipeline.ts:224-228` — gate the cumulative DB read on `!snapshot.already_placed_ids.includes(client_order_id)` so duplicate fills don't trigger a redundant query. Bug.0426 (same PR) drops the duplicate-fill rate ~10×, so the impact is muted post-merge — but the structural fix is to do cheap checks first.
- Add a boundary-equality test (`cumulative + size === max_usdc_per_trade` exactly should place).
- Add one min_bet-variant fixture in `plan-mirror-sizing-min-bet.test.ts` exercising the cap.
- Add a direct unit test for `FakeOrderLedger.cumulativeFilledForMarket` covering tenant + market + status filter.
- Long-term: expression index on `attributes->>'market_id'` for multi-tenant scale-up. Out of scope for v0.
