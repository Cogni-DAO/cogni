---
id: proj.poly-bet-sizer
type: project
primary_charter:
title: "Poly — Per-User Per-Target Intelligent Bet Sizer"
state: Active
priority: 1
estimate: 3
summary: "A policy+sizer gate between the mirror decision and trade placement that decides per-bet size given a user's small balance, multiple copy-targets, and market minimums. v0 = min-bet, first-come-first-serve under existing grants. vNext = per-target % allocation, sub-min handling, and a single UI surface that also exposes the existing grants policy."
outcome: "Every poly copy-trade order flows through a `BetSizerPolicy` port. v0 returns the market's min USDC notional and lets the existing grants caps act as the FCFS budget gate. vNext lets a user configure per-copy-target allocation %, sub-min behaviour, and grants caps from one settings UI. The sizer is the only place that can answer 'how much should this user bet on this fill?' — no other code path computes a size."
assignees: derekg1729
created: 2026-04-27
updated: 2026-04-27
labels: [poly, polymarket, copy-trading, sizing, policy, multi-tenant]
---

# Poly — Per-User Per-Target Intelligent Bet Sizer

> Spun out of [proj.poly-copy-trading](proj.poly-copy-trading.md) Phase 3 on 2026-04-27. That project owns the placement path, custody, and grants. This project owns the **decision** of how much to bet — the gate that sits between "target traded" and "we submit an order".

## Goal

Users copy-trade wallets with $1M+ portfolios while holding $5–$50 themselves, and may copy 2–5 targets at once. We need a single, replaceable policy+sizer seam that answers _"given this user, this target, this fill, this market min, and this remaining budget — how much (if anything) do we bet?"_ Today this answer is hardcoded as `MIRROR_USDC = 1` in [`copy-trade-mirror.job.ts:56`](../../nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts) and there is no per-target-per-user allocation. This project introduces the gate and walks the policy from "always min-bet, FCFS" to "user-configured allocation".

## Roadmap

### Crawl (P0) — `min_bet` SizingPolicy variant

**Goal:** Add a `{ kind: "min_bet" }` variant to the existing `SizingPolicy` discriminated union (the seam already exists per the `SIZING_POLICY_IS_DISCRIMINATED` invariant). Use the market's `minUsdcNotional` as the bet size instead of the hardcoded `MIRROR_USDC = 1` constant. FCFS budget gating remains in `authorizeIntent` (`CAPS_LIVE_IN_GRANT`). No new port, no new schema, no UI. ~30 LOC.

| Deliverable                                                                          | Status    | Est | Work Item |
| ------------------------------------------------------------------------------------ | --------- | --- | --------- |
| `min_bet` variant on `SizingPolicy` + bootstrap swap + delete `MIRROR_USDC` constant | In Review | 2   | task.0404 |

### Walk (P1) — per-target allocation + sub-min policy + UI

**Goal:** Persist per-`(user, copy-target)` allocation (e.g. "target X = 40% of my poly trading budget, target Y = 60%") and resolve the sub-min case (target's bet size lands below market min — skip? round up to min if budget allows? combine with next fill?). Surface all of this — _and the existing grants caps that today have no UI_ — in one settings page. Schema lift, contract lift, dashboard form.

| Deliverable                                                                                                  | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------------------------------------ | ----------- | --- | -------------------- |
| Per-target allocation schema + contract + sizer impl (`AllocationSizer`)                                     | Not Started | 3   | (create at P1 start) |
| Sub-min policy knob (skip vs round-up-to-min) wired into the sizer                                           | Not Started | 1   | (create at P1 start) |
| Single settings UI surfacing allocation %, sub-min policy, **and existing grants caps** (per-order/daily/hr) | Not Started | 3   | (create at P1 start) |

### Run (P2+) — extensibility hooks (NOT pre-built)

**Goal:** Reserved for policies that earn their place by user demand. Examples that might land here, none of which we build speculatively: target-confidence weighting, per-market caps, drawdown-aware sizing, time-decay weighting, hot-streak amplifiers, per-category exposure caps. The Walk-phase port shape needs to make these landable without rewriting the seam — that is the only Run-phase requirement we hold ourselves to today.

| Deliverable                                      | Status      | Est | Work Item |
| ------------------------------------------------ | ----------- | --- | --------- |
| (deliberately empty — created on real user pull) | Not Started | —   | —         |

## Constraints

- **The sizer is the only place that computes a size.** Once v0 lands, no other code path may set `size_usdc`. Drift here re-introduces the bug we are fixing.
- **The sizer does not bypass `authorizeIntent`.** Grants remain the authoritative cap layer. The sizer is upstream of authorize — it can return `≤` the grant cap, never `>`.
- **No new tables in v0.** v0 reads market constraints + existing grant row only. Persisted per-target allocation is a P1 schema change, not a P0 stopgap.
- **No UI in v0.** A settings page that surfaces sizing _and_ grants is one P1 deliverable, not two — they share the only settings surface a user has.
- **MVP-stage discipline.** One dev, near-zero users. Ship the dumb v0 against real candidate-a fills before designing the allocation math.

## Dependencies

- [x] `polyWalletGrants` table + `authorizeIntent` cap enforcement — task.0318 Phase B3
- [x] `polyCopyTradeTargets` per-user-per-target rows + RLS — task.0318 Phase A
- [x] `getMarketConstraints(tokenId) → { minShares, minUsdcNotional }` — bug.0342
- [x] `applySizingPolicy()` in `plan-mirror.ts` — task.0315
- [ ] task.0347 (per-tenant preferences + sizing config) — **superset of P1 here.** Resolution: this project _is_ the focused successor to task.0347's sizing slice. P1 here delivers what task.0347 promised for sizing + caps; task.0347 retains the orthogonal funding/balance work or gets retired.

## As-Built Specs

- (none yet — created when v0 lands)

## Design Notes

- **Why extend `SizingPolicy`, not introduce a new port.** The discriminated union in `nodes/poly/app/src/features/copy-trade/types.ts` is already the policy seam, and its `SIZING_POLICY_IS_DISCRIMINATED` invariant explicitly says "future policies add variants, never flat fields." A new `BetSizerPolicy` port would re-implement the same seam under a different name. v0 is a textbook variant addition (~30 LOC). P1 allocation logic is another variant. P2+ is more variants.

- **Why the gate stays inside `applySizingPolicy`, not one level up.** The `CAPS_LIVE_IN_GRANT` invariant requires that grant state is read only at `authorizeIntent`. A "policy gate one level up with access to the user's grant" would have violated that. Keeping all sizing logic inside the pure `applySizingPolicy` switch preserves `PLAN_IS_PURE` and `CAPS_LIVE_IN_GRANT` — the policy decides what size, the grant decides whether to allow.

- **FCFS is not a feature, it is the absence of allocation.** v0's "first-come-first-serve" is whatever order fills arrive in a mirror tick — whichever fill `authorizeIntent` can fit under the daily cap places, the rest skip. We do not need a budget allocator in v0. We do need the P1 allocation impl to be explicit that it _replaces_ FCFS, not layers on top of it.

- **Surfacing existing grants in the same UI is the point.** Grants today are caps with no editor. Allocation % is a knob with no schema. Building two settings pages would be a tell that we treated them as different problems. They are one problem: "the user wants to control how their money gets bet."
