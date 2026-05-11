---
id: poly-mirror-position-model-2026-05-11
type: research
title: "Research: Position-Aware Mirror Copy-Trading — Redesign Driven by Target Dominance + VWAP"
status: draft
trust: draft
summary: "Redesigns the mirror planner's branch logic so position direction, sizing, and entry/hedge decisions are driven by target's actual portfolio state (per-condition dominant side, side fraction, VWAP) rather than by our existing position. Closes bug.5048 (Chelsea/Nott-Forest wrong-side) and prevents the class of failure where primary-side placement failures cause us to open on target's minority side."
read_when: "Editing planMirrorFromFill branch logic, target_position consumption, sizing-policy interaction with target side weights, or VWAP gates."
owner: derekg1729
created: 2026-05-11
implements: bug.5048
tags: [poly, copy-trade, position-model, vwap, design]
---

# Position-Aware Mirror Copy-Trading — Redesign

## TL;DR

The mirror planner today decides what to do based on **our** position (`layer` = same side as our existing mirror, `hedge` = opposite side, else `new_entry`). This is backwards. Our position is downstream — it can be empty, undersized, or wrong-side. Branch detection must be driven by **target's** dominant side first, then routed by our position.

Four invariants this redesign delivers:

1. **TARGET_DOMINANCE_DRIVES_BRANCH** — branch detection is computed from target's side fractions, then routed by our position. Never the inverse.
2. **NEVER_PAY_ABOVE_TARGET_VWAP** — we refuse to place at a price more than `vwap_tolerance` above target's VWAP on the fill's token. No chasing.
3. **NO_SELL_IN_MIRROR** — we never SELL. Only BUY + REDEEM, mirroring target behavior. Mirroring target's own hedging is the only rebalance mechanism.
4. **OPTION_C_TOLERATES_MULTI_TARGET** — `MirrorPositionView` aggregates fills across all targets on the same condition, so our wallet may already hold the non-dominant side from another target's mirror activity. When the current target's dominant fill arrives and our cross-target wallet holds the minority side, the planner ignores the wrong-side leg for routing purposes and opens the dominant-side parallel leg. The wallet eventually holds whatever blend of sides the combined target activity drives. Every such event emits a WARN log + counter so the multi-target dynamic is observable.

## Problem statement (Chelsea/Nott-Forest, bug.5048)

Target (swisstony) was 95.6% OVER / 4.4% UNDER on a binary condition. Our 6 primary OVER placements ended `canceled` (limit went stale as price ran up) and 22 follow-up OVER attempts erred (`insufficient_balance`). Target then fired a hedge-side UNDER fill. Our planner: `position.our_token_id` undefined → `applyPositionFollowupPolicy` returned `undefined` → fell through to `new_entry` → `target_percentile_scaled` checked target's UNDER cost ($1,059) against `min_target_usdc` ($146), passed, placed UNDER. Once the first UNDER mirror filled, `our_token_id` pinned to UNDER → subsequent UNDER fills routed as `layer_scale_in` → accumulated 41.28 sh @ vwap 0.367.

The bug is not the sizing math. It is the absence of any predicate that asks "is this fill on target's dominant side?"

## Position model

### Target awareness (per condition)

Already in `state.target_position` (`TargetConditionPositionView`):

```ts
{
  condition_id: string,
  tokens: Array<{
    token_id: string,
    size_shares: number,
    cost_usdc: number,
    current_value_usdc: number,
  }>
}
```

Derived signals the planner needs:

- `total_cost = Σ token.cost_usdc`
- `side_fraction[token_id] = token.cost_usdc / total_cost`
- `vwap[token_id] = token.cost_usdc / token.size_shares` (when `size_shares > 0`)
- "**Minority**" = `side_fraction[token_id] < config.min_target_side_fraction` (single-threshold model)
- "**Dominant**" = NOT minority

A market where both binary tokens are above the threshold (e.g. 70/30 with threshold 0.20) means both sides are "dominant" — neither is minority. The planner routes per the table below; minority-skip simply does not fire.

Future v3:

- Target portfolio bankroll across all conditions
- Per-condition cap = `our_bankroll × target_total_cost(condition) / target_bankroll`

### Our awareness (per condition)

Already in `state.position` (`MirrorPositionView`):

```ts
{
  condition_id: string,
  our_token_id?: string,
  our_qty_shares: number,
  our_vwap_usdc?: number,
  opposite_token_id?: string,
  opposite_qty_shares: number,
}
```

Computed in `aggregatePositionRows()` from `poly_copy_trade_fills`.

### Sizing — unchanged

`target_percentile_scaled` already scales bets `min_bet → max_usdc_per_trade` based on where target's cost on this token falls between `statistic.min_target_usdc` (pXX, default 80) and `max_target_usdc` (p100). The UI exposes this directly. **No sizing redesign needed.** Only branch SELECTION changes.

### Gate inheritance per branch (verbatim from current `applyPositionFollowupPolicy`)

Deleting `applyPositionFollowupPolicy` removes the function but not the gates it enforces. Each new branch inherits a defined subset; existing tests in `plan-mirror-position-followups.test.ts` must pass **unmodified** post-refactor, which is the parity assertion.

| Branch               | Gates carried forward                                                                                                                                                                       | Sizing entry                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `new_entry_dominant` | none from `position_followup`; uses `applySizingPolicy` against `config.sizing` (`target_percentile_scaled` percentile floor + market floor + per-position cap)                             | `applySizingPolicy(config.sizing, price, targetTokenCost, ...)` — identical to today's new_entry path                                                                                                                    |
| `layer_dominant`     | `min_mirror_position_usdc`, `market_floor_multiple` (via `effectiveMinPositionUsdc`), `max_layer_fraction_of_position`, `targetThreshold = config.sizing.statistic.min_target_usdc`         | `applyFollowupSizing` with `maxFollowupUsdc = mirrorExposureUsdc × max_layer_fraction_of_position` — identical to today's layer path                                                                                     |
| `hedge`              | `min_mirror_position_usdc`, `market_floor_multiple`, `max_hedge_fraction_of_position`, `min_target_hedge_usdc`, `min_target_hedge_ratio`, target-hedge delta calculation, `targetThreshold` | `applyFollowupSizing` with `maxFollowupUsdc = mirrorExposureUsdc × max_hedge_fraction_of_position` and `desiredSizeUsdc = (mirrorExposureUsdc × targetHedgeRatio) − existingHedgeUsdc` — identical to today's hedge path |

Implementation form: extract the layer-branch body and the hedge-branch body of today's `applyPositionFollowupPolicy` into two named functions (`sizeLayerDominant`, `sizeHedge`) that take the same inputs and return the same `SizingResult`. The new `decideMirrorBranch` calls them after the target-dominance check routes to the correct branch. Pure mechanical extraction — no logic change.

**Parity test plan:** after the refactor, every existing `plan-mirror-position-followups.test.ts` case must pass with the test file unchanged. If any test needs an edit, that's a regression and must be reverted.

## Branch decision table

Routing is computed from target's side classification (minority vs dominant) and our position state on the condition.

| target side of this fill                        | our position state          | branch                                                        | action                                                                                                                                                       |
| ----------------------------------------------- | --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| dominant                                        | no mirror on this condition | `new_entry_dominant`                                          | place (existing percentile-scaled sizing)                                                                                                                    |
| dominant                                        | mirror on dominant          | `layer_dominant`                                              | place (existing layer sizing)                                                                                                                                |
| dominant                                        | mirror on minority (WRONG)  | `new_entry_dominant` + `wrong_side_holding_detected=true` log | place dominant-side leg, ignoring our wrong-side leg for routing (option C). Wrong-side residue holds to redemption. **See SINGLE_TARGET_ASSUMPTION below.** |
| minority                                        | mirror on dominant          | `hedge`                                                       | place (existing hedge ratio sizing)                                                                                                                          |
| minority                                        | no mirror on this condition | `target_dominant_other_side`                                  | **skip** (Chelsea case)                                                                                                                                      |
| minority                                        | mirror on minority (WRONG)  | `target_dominant_other_side`                                  | **skip** — don't accumulate more on minority                                                                                                                 |
| neither side is minority (both above threshold) | any                         | route as if "dominant" per above                              | existing behavior preserved                                                                                                                                  |

### OPTION_C_TOLERATES_MULTI_TARGET (row 3 detail)

`buildMirrorTargetConfig` already runs for multiple target wallets (RN1, swisstony, …) against a single tenant wallet. `aggregatePositionRows` groups by `market_id` only, so `MirrorPositionView.our_token_id` reflects the cross-target accumulation, not per-target attribution.

Steady-state expectation: row 3 fires whenever target A's mirror activity put us on side X, then target B's dominant fill arrives on side Y. Under option C we treat the existing X leg as **inventory drag** (we ignore it for routing the new fill) and open a parallel Y leg as `new_entry_dominant`. The wallet thereafter holds both X (from A) and Y (from B). Subsequent fills route normally:

- A's continued dominant-X fills → `layer_dominant` (our_token_id resolves to whichever side has more shares overall, but the option-C decision rule is "ignore the wrong-side leg vs the **current** target's dominance," not "vs our overall position")
- B's hedge-Y fills → `hedge`
- B's dominant-Y fills → `layer_dominant`
- Cross-condition resolution clears asymmetries via REDEEM at market close

What option C does **not** handle: contradictory targets on the same condition (A dominant OVER, B dominant UNDER, simultaneous). Both will fire row 3 in alternation, opening both legs in parallel. The combined wallet exposure reflects the union of target strategies. This is the correct behavior under the no-SELL invariant — we cannot unwind one to satisfy the other; we just track both. v3 (cross-target coherence) is when this gets a designed policy. For v1, surface this state via the WARN log + counter and operator decides whether to disable one of the conflicting targets.

Row 3 detection emits both:

- WARN log line with `wrong_side_holding_detected: true, our_minority_token_id, target_dominant_token_id, target_side_fraction`
- Counter `poly_mirror_wrong_side_holding_total{target_id, condition_id}` (bounded cardinality; alertable at any non-zero rate)

## VWAP awareness — v1 gate

Before placing on any branch, compute target's VWAP on the fill's token:

```
target_vwap = target_position.token[fill.tokenId].cost_usdc / size_shares
```

If `fill.price > target_vwap + config.vwap_tolerance`, skip with reason `vwap_floor_breach`. Default `vwap_tolerance = 0.005` (0.5pp on the 0-1 price scale).

Rules:

- Gate fires on every branch that would otherwise place: `new_entry_dominant`, `layer_dominant`, `hedge`.
- Tolerance is **asymmetric** — only the upward bound is gated. We are happy to enter below target_vwap.
- Fail-open: when `target_position` is unavailable, the matching token row is missing, or `size_shares ≤ 0`, the gate does not fire (matches the convention for missing optional inputs).
- Tolerance covers tick-grid rounding + ladder slippage. Tunable per-target.

VWAP-aware **sizing** (scale size down as price approaches `target_vwap + tolerance`) is **v2**, not v1. v1 is a binary gate.

## Skip-reason precedence (decision ordering)

The post-refactor planner evaluates predicates in this order; the **first matching skip wins** and is what lands on the decision-row `reason`. Order matters because dashboards and metrics group by `reason`.

1. `already_placed` — idempotency, earliest.
2. `market_past_end_date` — liveness.
3. `price_outside_clob_bounds` — tick-grid normalization (skip before any state read).
4. **Target-dominance routing** — produces either a `target_dominant_other_side` skip OR a place-branch selection (`new_entry_dominant` / `layer_dominant` / `hedge`).
5. **VWAP gate** — runs ONLY on place-bound branches; produces `vwap_floor_breach` skip OR continues.
6. **Sizing** — produces `below_target_percentile` / `below_market_min` / `position_cap_reached` / `target_position_below_threshold` / `followup_position_too_small` / `followup_not_needed` skips OR a `size_usdc` to place.
7. **`already_resting`** — fast-path dedup check in the pipeline (post-plan, pre-insert). Unchanged.

This guarantees: if a fill would be sized-skipped anyway, the metric reads `below_target_percentile` (not `target_dominant_other_side`) only when target dominance ALSO did not flag it. A fill that's both minority-side AND under-percentile reads `target_dominant_other_side` (the more specific/upstream reason). This is consistent with current convention where the earliest matching predicate wins.

## TODOs

### v1 — bug.5048 fix (this PR)

1. Helper `analyzeTargetDominance(target_position, min_target_side_fraction, fill_token_id)` returning `{ fill_token_fraction, dominant_token_id, fill_is_minority, balanced }`.
2. Helper `targetVwapForToken(target_position, token_id)` returning `number | undefined`.
3. Mechanical extraction (no logic change): pull the layer-branch and hedge-branch bodies out of `applyPositionFollowupPolicy` into two named pure functions `sizeLayerDominant(input, minShares, minUsdcNotional)` and `sizeHedge(input, minShares, minUsdcNotional)`, each returning `SizingResult`. Existing position_followup gates are preserved verbatim inside these functions (see "Gate inheritance per branch" table above).
4. Replace branch detection in `planMirrorFromFill`:
   - Delete `applyPositionFollowupPolicy` (our-position-first detection).
   - New function `decideMirrorBranch(input)` returns one of `{ kind: "skip", reason }` or `{ kind: "place", branch: "new_entry" | "layer" | "hedge", wrong_side_holding_detected?: boolean }`.
   - Routing calls `sizeLayerDominant` / `sizeHedge` / `applySizingPolicy` per branch.
5. VWAP gate applied uniformly on every place-bound branch, AFTER `decideMirrorBranch` selects a place-branch, BEFORE the branch's sizing function runs (see "Skip-reason precedence" section).
6. New MirrorReasons: `target_dominant_other_side`, `vwap_floor_breach`.
   - **Not** added as a MirrorReason: `wrong_side_holding`. It's a log/decision-blob field + dedicated metric.
7. New metric: `poly_mirror_wrong_side_holding_total{target_id, condition_id}` — counter incremented inside the pipeline when `decideMirrorBranch` returns `wrong_side_holding_detected: true`. Bounded cardinality (low natural rate); alertable.
8. Config additions to `MirrorTargetConfigSchema` (flat fields, matching `position_followup` convention):
   - `min_target_side_fraction?: z.number().min(0).max(1).optional()` — default 0.20 in `buildMirrorTargetConfig`. Undefined ⇒ dominance gate disabled (legacy behavior; tests stay green).
   - `vwap_tolerance?: z.number().min(0).max(1).optional()` — default 0.005 in `buildMirrorTargetConfig`. Undefined ⇒ VWAP gate disabled.
9. Decision-log fields added to `buildDecisionLogFields` in `mirror-pipeline.ts`:
   - `target_dominant_token_id`
   - `target_side_fraction` (fraction on the fill's token)
   - `min_target_side_fraction` (configured)
   - `target_vwap_for_fill_token`
   - `vwap_tolerance` (configured)
   - `intended_branch` ∈ `{new_entry_dominant, layer_dominant, hedge, skip}` (which row of the table fired)
   - `wrong_side_holding_detected: boolean` (true only on row 3)
10. Pipeline `needsTargetPosition` — extend to return true when either `min_target_side_fraction` or `vwap_tolerance` is set.
11. Unit tests `plan-mirror-target-dominance.test.ts`: cover all 7 rows + balanced fall-through + VWAP gate fires + VWAP fails-open + threshold-disabled fail-open + skip-precedence ordering (dominant-skip beats sizing-skip when both apply).
12. **Parity check**: `plan-mirror-position-followups.test.ts` passes UNMODIFIED post-refactor. If any case needs editing, that's a regression — revert and re-do the extraction.
13. Pipeline-level tests in `mirror-pipeline.test.ts`: one happy-path test per new place-branch (`new_entry_dominant`, `layer_dominant`, `hedge`); one per new skip reason; asserts decision-log fields land in the intent JSONB end-to-end; one test verifies `wrong_side_holding_total` counter increments on row 3.
14. Spec `docs/spec/poly-copy-trade-execution.md` updates:
    - Rewrite "How follow-ons reduce to predicates" section with the branch table.
    - Add invariants `TARGET_DOMINANCE_DRIVES_BRANCH`, `NEVER_PAY_ABOVE_TARGET_VWAP`, `NO_SELL_IN_MIRROR`, `OPTION_C_TOLERATES_MULTI_TARGET`.
    - Document the skip-reason precedence ordering.
15. **UI follow-up (NOT v1):** new config knobs (`min_target_side_fraction`, `vwap_tolerance`) are deploy-tuned for v1; not exposed in the targets UI. File a follow-up issue if/when they need user-tunable surfaces.

### v2 — Persistence + VWAP-aware sizing (separate PR)

1. `poly_target_condition_snapshots` table — persist target per-condition state so we are not Data-API-dependent on every fill.
2. VWAP-aware sizing — scale size down as price approaches `target_vwap + tolerance`, instead of binary gate.
3. Persisted per-target config (today: code defaults; persistence deferred per task.0347).

### v3 — Portfolio coherence (separate PR)

1. Target portfolio bankroll tracking → cross-condition cap allocation: `our_condition_cap = our_bankroll × target_condition_weight / target_bankroll`.
2. Cross-target coherence if mirroring N targets is ever introduced (violates SINGLE_TARGET_ASSUMPTION; design at that time).

## Out of scope (permanently)

- **Active SELL** — Cogni does not SELL. Only BUY + REDEEM. Mirrors target behavior.
- **Mixed Cogni-own-trade + mirror** — violates SINGLE_TARGET_ASSUMPTION. If introduced, the row-3 wrong-side branch needs re-design.

## Reference incidents

- **bug.5048** — Chelsea/Nott-Forest 95/5 wrong-side. Primary case study; v1 fix targets this directly.
- **bug.5046, bug.5047** — placement_failed rates. Out of scope here but adjacent: the dominance gate exists partly because primary-side placement failures are common, and the planner must not opportunistically open on the minority side when the primary path is failing.
