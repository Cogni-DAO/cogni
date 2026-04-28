---
id: task.0404
type: task
title: "Poly bet sizer v0 — `min_bet` SizingPolicy variant"
status: needs_merge
priority: 1
rank: 5
estimate: 2
summary: "Add a `{ kind: 'min_bet', max_usdc_per_trade }` variant to the existing `SizingPolicy` discriminated union. Use the market's `minUsdcNotional` as the bet size instead of the hardcoded `MIRROR_USDC = 1` constant. FCFS budget gating remains in `authorizeIntent` (CAPS_LIVE_IN_GRANT). No new port, no new schema, no UI."
outcome: "Bet size is sourced from the market's `minUsdcNotional` (clamped to share-floor) instead of the hardcoded `MIRROR_USDC = 1`. Markets where the min lands within the tenant's per-order grant cap place real orders. Markets above the variant's `max_usdc_per_trade` skip cleanly at `plan-mirror` (no ledger bloat) with the existing `below_market_min` reason. The `MIRROR_USDC` env-read constant is deleted."
spec_refs:
  - poly-copy-trade-phase1
  - poly-multi-tenant-auth
assignees: [derekg1729]
credit:
project: proj.poly-bet-sizer
branch: worktree-poly-bet-sizer
pr: https://github.com/Cogni-DAO/node-template/pull/1097
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-27
updated: 2026-04-27
review_notes: |
  Implementation reviewed 2026-04-27. APPROVE. Behavior is equivalent to the
  prior `fixed` variant (no regression); the v0 outcome of "places real
  min-bet orders on $2–$5 markets" only fully materializes after the
  operator's grant `perOrderUsdcCap` is bumped from $1 to $5 — track that as
  an out-of-band ops step in the closeout PR body.
labels: [poly, polymarket, copy-trading, sizing, policy]
external_refs:
  - nodes/poly/app/src/features/copy-trade/types.ts
  - nodes/poly/app/src/features/copy-trade/plan-mirror.ts
  - nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts
---

# task.0404 — Poly bet sizer v0

## Why this exists

`MIRROR_USDC = 1` is hardcoded at [`copy-trade-mirror.job.ts:56`](../../nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts) and is the only signal that decides bet size. Two failure modes today:

1. **Markets with `minUsdcNotional > MIRROR_MAX_USDC_PER_TRADE` silently skip.** The current `{ kind: "fixed" }` policy returns `below_market_min` when share-space math forces notional above `max_usdc_per_trade = 5`. Every fill on those markets is a no-op, even though the user's grant would allow it.
2. **Multi-target copy-trading is incoherent across markets.** A user copying 3 targets sees fills on cheap markets fire at $1 and fills on $10-min markets silently disappear. There's no single answer to "what is the user's min-bet on this market" — there's a constant `$1` that doesn't know about market floors.

v0 fixes both by sourcing the bet size from `minUsdcNotional` directly, via a new `SizingPolicy` variant. **FCFS** is the existing behaviour of `authorizeIntent` rejecting fills once `dailyUsdcCap` is consumed — we are not adding a budget allocator.

## Design

### Outcome

Every poly copy-trade order's `size_usdc` is the market's `minUsdcNotional` for tenants on the new `{ kind: "min_bet" }` policy. The `MIRROR_USDC` and `MIRROR_MAX_USDC_PER_TRADE` env-driven constants are deleted. FCFS gating is preserved by the existing grants layer.

### Approach

**Solution:** Add a new variant to the existing `SizingPolicy` discriminated union — the variant carries its own per-order ceiling so cap-exceeded fills skip at `plan-mirror` (cheap) rather than at `authorizeIntent` (after `INSERT_BEFORE_PLACE`, ledger-polluting):

```ts
export const MinBetSizingPolicySchema = z.object({
  kind: z.literal("min_bet"),
  /**
   * Hard ceiling. When the market's share-floor or `minUsdcNotional` forces
   * notional above this, skip with `below_market_min` BEFORE the ledger insert.
   * Set to match the tenant's `polyWalletGrants.perOrderUsdcCap` so cap-exceed
   * cases are not duplicated at the authorize boundary.
   */
  max_usdc_per_trade: z.number().positive(),
});
```

`applySizingPolicy("min_bet", price, minShares, minUsdcNotional)` math (mirrors the `fixed` variant's tail; only the desired-shares step changes):

```
if (minUsdcNotional === undefined) → skip "below_market_min"   // fail closed
sharesForUsdcFloor = minUsdcNotional / price
floorShares        = max(minShares ?? 0, sharesForUsdcFloor)
rawUsdc            = floorShares * price
size_usdc          = max(rawUsdc, minUsdcNotional)              // bug.0342 ε-clamp
if (size_usdc > max_usdc_per_trade) → skip "below_market_min"
return ok { size_usdc }
```

`nominalSizeUsdc(sizing)` in `mirror-pipeline.ts:40` (used by SELL-close `max_size_usdc` and the audit blob) gets a `case "min_bet": return sizing.max_usdc_per_trade` — for SELL it acts as the close-cap ceiling, for the audit blob it logs the configured ceiling. Both correct.

In bootstrap, swap to `{ kind: "min_bet", max_usdc_per_trade: 5 }` (matches today's effective `MIRROR_MAX_USDC_PER_TRADE = 5` and the operator wallet's $5/order grant cap, so the ceiling lands at `plan-mirror` and never at `authorize`). Delete `MIRROR_USDC` and `MIRROR_MAX_USDC_PER_TRADE` env reads + constants. The ceiling now lives in the policy variant where it belongs, not as a free-floating env knob.

**Reuses:**

- Existing `SizingPolicy` discriminated union — the seam already exists, the [`SIZING_POLICY_IS_DISCRIMINATED`](../../nodes/poly/app/src/features/copy-trade/types.ts) invariant explicitly directs new policies to be variants.
- Existing `applySizingPolicy` dispatcher — already does share-space math against `minUsdcNotional`.
- Existing `getMarketConstraints` adapter call — already wired into the mirror pipeline; surfaces `minUsdcNotional` per token.
- Existing `authorizeIntent` cap enforcement — handles FCFS naturally (per-order, daily, hourly caps on the grant row).

**Rejected:**

- **New `BetSizerPolicy` port (my own first draft).** Adding a port for a single pure-domain policy in one runtime violates Phase 3a — single runtime, no vendor SDK, pure domain logic stays in app code. It also would have re-implemented the existing `SizingPolicy` seam under a different name. Rejected as bespoke ceremony over reuse.
- **Move sizing to a shared package.** Same reason — only one runtime (poly app) consumes this. Promoting now is premature. The existing in-app discriminated union covers all known P1 policies (allocation %, sub-min handling) as additional variants.
- **Pass `grant.dailyRemainingUsdc` into the sizer for early-skip optimization.** Violates [`CAPS_LIVE_IN_GRANT`](../../nodes/poly/app/src/features/copy-trade/types.ts) — caps are enforced exclusively at `authorizeIntent`. The pure decision must not read cap state.
- **Delete the `fixed` variant.** Tempting but bad. Stack tests, fixtures, and dev/test configs use it. Keeping both variants is one extra `case` and zero migration risk.
- **Skip `max_usdc_per_trade` on `min_bet` and let `authorizeIntent` reject above-cap intents.** Considered. Rejected because every cap-rejected fill writes a `markError` + `placement_failed` decision row at [`mirror-pipeline.ts:445`](../../nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts) — that's `INSERT_BEFORE_PLACE` doing its job for real failures, but it pollutes the ledger with deterministic skips. Carrying the ceiling in the policy variant lets `plan-mirror` skip cleanly _before_ the insert, same as the `fixed` variant does today.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **CAPS_LIVE_IN_GRANT**: The `min_bet` variant must NOT read `poly_wallet_grants` state. Cap enforcement stays in `authorizeIntent`. (spec: poly-copy-trade-phase1, types.ts)
- [ ] **SIZING_POLICY_IS_DISCRIMINATED**: New policy is a variant on `SizingPolicy.kind`, not a flat field added to `MirrorTargetConfig`. (spec: types.ts)
- [ ] **PLAN_IS_PURE**: `applySizingPolicy("min_bet", ...)` is a pure function — no I/O, no env reads, same input → same output. (spec: plan-mirror.ts)
- [ ] **SHARE_SPACE_MATH**: `size_usdc / price >= minShares`. The `min_bet` branch must clamp to `max(minShares * price, minUsdcNotional)` if `minShares` exceeds the USDC floor. (spec: plan-mirror.ts, bug.0342)
- [ ] **MIRROR_REASON_BOUNDED**: New skip reason (if any) added to the bounded enum. v0 reuses `below_market_min`; no new reason needed. (spec: types.ts)
- [ ] **SIMPLE_SOLUTION**: One variant added; no new port, no new package, no new schema. (spec: architecture)
- [ ] **ARCHITECTURE_ALIGNMENT**: App-local pure-domain logic stays app-local per Phase 3a. (spec: packages-architecture)

### Files

- **Modify:** `nodes/poly/app/src/features/copy-trade/types.ts` — add `MinBetSizingPolicySchema`, extend `SizingPolicySchema` discriminated union.
- **Modify:** `nodes/poly/app/src/features/copy-trade/plan-mirror.ts` — extend `applySizingPolicy` switch with `case "min_bet"` (~12 lines mirroring the fixed variant's floor/clamp tail).
- **Modify:** `nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts` — extend `nominalSizeUsdc` switch with `case "min_bet": return sizing.max_usdc_per_trade`. (Required for exhaustiveness; without it the SELL path and audit blob break on the new variant.)
- **Modify:** `nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts` — swap config to `{ kind: "min_bet", max_usdc_per_trade: 5 }`; delete `MIRROR_USDC` + `MIRROR_MAX_USDC_PER_TRADE` constants and their env reads.
- **Modify:** existing test files under `nodes/poly/app/src/features/copy-trade/__tests__/` that build a sizing config — add new `min_bet` cases; leave existing `fixed` tests alone.
- **Test (new cases in existing `plan-mirror.test.ts`):** unit fixtures for `applySizingPolicy({ kind: "min_bet", max_usdc_per_trade }, ...)`:
  - `minUsdcNotional` undefined → skip `below_market_min` (fail closed)
  - `minUsdcNotional` defined and ≤ `max_usdc_per_trade` → returns `size_usdc = minUsdcNotional`
  - `minUsdcNotional > max_usdc_per_trade` → skip `below_market_min` (ceiling)
  - `minShares × price > minUsdcNotional` → returns `minShares × price` (share-floor wins)

## Validation

### exercise

- **Local unit:** `pnpm test nodes/poly/app/src/features/copy-trade/__tests__/plan-mirror.test.ts` — new fixture matrix for `min_bet` passes (4 cases above).
- **Local stack:** `pnpm test:stack:dev nodes/poly/app/src/features/copy-trade` — existing mirror-pipeline suite passes with the bootstrap swap.
- **Candidate-a:** with a configured target trading on a market where `1 < minUsdcNotional ≤ 5`, observe one real mirror tick that lands an order at the market's min (not at $1). On a market where `minUsdcNotional > 5`, the decision row is `skipped/below_market_min` (NOT `error/placement_failed`) — proves the ceiling lives in `plan-mirror`, not `authorize`.

### observability

- Existing `poly.copy-trade.decide` Pino log line — extend with `sizing_kind` field (`"fixed"` | `"min_bet"`) and `size_usdc`. No new log line.
- Loki query at the deployed SHA: `{node="poly"} |= "poly.copy-trade.decide" | json | sizing_kind="min_bet"` returns my self-validation tick.

## Review Checklist

- [ ] **Work Item:** `task.0404` linked in PR body
- [ ] **Spec:** `CAPS_LIVE_IN_GRANT` + `SIZING_POLICY_IS_DISCRIMINATED` + `PLAN_IS_PURE` + `SHARE_SPACE_MATH` upheld
- [ ] **Tests:** unit fixture matrix for `min_bet` variant
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
