---
id: bug.0405
type: bug
title: "Polymarket BUY GTC partial-fills land below min_order_size — produces structurally unsellable dust"
status: needs_implement
priority: 1
rank: 5
estimate: 2
summary: "Mirror BUYs go to Polymarket CLOB as `OrderType.GTC` limit orders. The sizing policy (`applySizingPolicy`) correctly clamps the *intent* size up to the market floor, but GTC matches against whatever depth is at the inside ask *right now* and rests the remainder. The matched portion settles to our wallet *with no min_order_size check on the matched amount* — Polymarket only enforces the floor on order placement, not on partial-fill matched amounts. When depth is thin (most Polymarket markets outside the top ~50), the matched amount lands below `min_order_size`. The resting remainder either fails to fill (price moved) or auto-cancels (sub-min stub). Result: a position below the market floor on chain, neither sellable (preflight rejects sub-min) nor redeemable until market resolution. Today's two stranded positions on the user's tenant (`4.88` + `2.20` shares) are exactly this shape."
outcome: 'After this PR, every mirror BUY uses `OrderType.FOK` (Fill-Or-Kill) by default — atomic-or-nothing relative to the floor, enforced by the exchange. No partial fills, no sub-min settlements, no new dust on chain. Mirror divergence (FOK fails on thin books → no position taken) is acceptable: the *next* signal recovers, and divergence is recoverable while dust isn''t. The choice surfaces as a per-target `executionMode: "fok" | "gtc"` dial on `MirrorTargetConfig` (default `"fok"`) and is exposed in the policy control panel alongside the sizing policy. Existing dust is left to redeem at market resolution via task.0412 (free, automatic, winning-side only — losing-side is a write-off).'
spec_refs:
  - poly-copy-trade-phase1
  - poly-positions
assignees: [derekg1729]
project: proj.poly-copy-trading
branch: fix/poly-clob-sell-fak-dust
created: 2026-04-28
updated: 2026-05-04
deploy_verified: false
labels: [poly, polymarket, clob, buy, fok, gtc, dust, copy-trading, bet-sizer]
external_refs:
  - work/items/bug.0342.poly-clob-dynamic-min-order-size.md
  - work/items/task.0404.poly-bet-sizer-v0.md
  - work/items/task.0412.poly-redeem-multi-tenant-fanout.md
---

# bug.0405 — BUY GTC partial-fills below floor produce unsellable dust

## 2026-05-04 Update — still critical, but not the dashboard-total bug

Do not use this bug as the explanation for the `$900+` wallet summary vs much
smaller Open table mismatch. That production issue is now tracked as
[task.5007](./task.5007.poly-tenant-current-position-reconciler.md): dashboard
routes were reading current exposure from `poly_copy_trade_fills` instead of the
DB current-position inventory in `poly_trader_current_positions`.

The newest production evidence does still support this bug's core execution
concern:

- Tiny displayed values like `$0.02` are usually **current value after price
  collapse**, not necessarily sub-min order placement.
- Separately, structurally small share balances can still be produced by
  `mirror_limit`/GTC partial fills because the exchange enforces market floors
  on order placement, not on every matched slice.
- The active spec now explicitly documents the tradeoff in
  `docs/spec/poly-copy-trade-phase1.md`: `FILL_NEVER_BELOW_FLOOR` is enforced
  for `placement === "market_fok"` and deliberately relaxed for
  `placement === "limit"` with TTL/cancel/redeem mitigations.
- Therefore the stale part of this bug is the old implication that "flip every
  mirror BUY to FOK" is an uncontested one-line fix. The real current decision
  is policy-level: default FOK to avoid new dust, or keep limit/GTC for follow
  rate while explicitly accepting dust risk and relying on cancellation/redeem.

Before implementing this bug, re-read:

- `docs/spec/poly-copy-trade-phase1.md` — execution-primitive floor section.
- `docs/design/poly-bet-sizer-v1.md` — current `mirror_limit` default and
  target-position pXX sizing.
- `docs/design/poly-hedge-followup-policy.md` — hedge gates and why opposite
  followups exist.
- `.context/poly-dashboard-positions-reconciler-handoff.md` — production
  current-position evidence, to avoid conflating read-model mismatch with
  placement dust.

> Surfaced 2026-04-28 during candidate-a validation of [task.0412](task.0412.poly-redeem-multi-tenant-fanout.md). Derek's tenant `0x9A9e…160A` held two stranded positions (`4.88` and `2.20` shares, both below `min_order_size = 5`) on open markets that the close button could not exit:
>
> ```
> PolymarketClobAdapter.sellPositionAtMarket: share balance below market floor (gotShares=4.88, minShares=5, tokenId=98988…)
> PolymarketClobAdapter.sellPositionAtMarket: share balance below market floor (gotShares=2.1978, minShares=5, tokenId=10816…)
> ```

## Root cause — the structural invariant we're missing

**A fill must never land below `min_order_size`.** Today, intent size respects the floor but execution doesn't.

`packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts:309` sends BUY orders as `OrderType.GTC`. GTC means: place a limit at price X, match against whatever ask-side depth exists at-or-below X right now, rest the remainder as a resting bid until it fills, expires, or is cancelled.

| Layer                                                        | Floor check?                                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `applySizingPolicy` (intent)                                 | ✅ Clamps `intent.size_usdc` up to `floor = max(minShares × price, minUsdcNotional)`. Correct.                                       |
| Polymarket CLOB on order placement                           | ✅ Rejects sub-min orders (returns `{}`; `bug.0342`'s symptom).                                                                      |
| **Polymarket CLOB on the matched portion of a partial fill** | ❌ **No floor enforcement.** Whatever the orderbook actually had at our price settles to us, even if that amount is below the floor. |

The third row is the bug. GTC turns a "5-share intent" into "whatever matched now + a sub-min resting stub." When the matched amount is below `min_order_size`, we hold dust the moment settlement clears. The resting remainder is also sub-min and either:

- **(a)** fails to fill because the inside ask moved up after our match
- **(b)** is auto-cancelled by Polymarket because it's a sub-min order
- **(c)** sits indefinitely if the market is dead

In all three cases, the matched-but-sub-min portion stays in our wallet permanently. SELL preflight then rejects every exit attempt (sub-min). Redemption only recovers it on market resolution, and only if we're on the winning side.

**Why depth pre-check doesn't fix this:** the orderbook moves between check and submit. TOCTOU. You can verify depth at moment N and still partial-fill at moment N+1. Don't bother.

## Fix — push the floor invariant into the execution primitive

**`OrderType.FOK` on BUY.** Atomic-or-nothing. The exchange itself enforces "fill the entire intent at the limit price, or fill nothing." No partial fills, no sub-min settlements, no new dust ever.

The trade-off is real but worth taking:

- **FOK fails on thin books** → mirror skips this signal → mirror diverges from target.
- **Divergence is recoverable.** The next observed fill from the target re-enters the pipeline. We trade "follow the target perfectly" for "never accumulate stranded dust," and the loss from the former is bounded by the next-signal latency.

The opposite (`gtc`) stays available for callers who explicitly want best-effort matching — paper mode, agent-driven trades, or operators who know the orderbook. It's not the default.

## Where the dial lives — slotting into task.0404 (bet sizer)

`MirrorTargetConfig.sizing` already carries the per-target sizing policy (`fixed | min_bet`). `executionMode` is **orthogonal to sizing** — it controls how the sized intent reaches CLOB, regardless of whether the size came from `fixed` or `min_bet`. So it's a sibling of `sizing` on `MirrorTargetConfig`, not nested inside the policy variants.

```ts
// nodes/poly/app/src/features/copy-trade/types.ts (sketch)
export const ExecutionModeSchema = z.enum(["fok", "gtc"]);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const MirrorTargetConfigSchema = z.object({
  // ... existing fields ...
  sizing: SizingPolicySchema,
  /** How the sized intent is sent to CLOB. Default `"fok"` — atomic-or-nothing,
   *  prevents sub-floor partial fills (bug.0405). `"gtc"` allows resting limit
   *  orders that may partial-fill; only use when the caller is willing to
   *  accept dust risk in exchange for follow-rate guarantees. */
  executionMode: ExecutionModeSchema.default("fok"),
});
```

The dial is per-target, same scope as `sizing`. A user can have aggressive FOK on high-conviction targets and GTC on opportunistic ones, etc.

## Ship plan — 2 PRs

This bug ships in two stages to reduce review burden and unblock the bleeding fast.

### PR-A — Stop the bleeding (this PR)

Hardcode FOK on the unified `placeOrder` path in the Polymarket CLOB adapter. No DB, no API, no UI. ~50 LoC + tests + spec. Branch: `fix/poly-clob-sell-fak-dust`.

Scope:

- `packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts:309` — `OrderType.GTC` → `OrderType.FOK` (applies to both BUY and SELL through this path; mirror-emitted orders use this).
- Map the CLOB's "no-match" rejection (`success=false`, empty body — same shape as the bug.0342 sub-min reject) to a typed `fok_no_match` reason in `classifyClobFailure` so the coordinator can skip cleanly without retry.
- Manual close (`sellPositionAtMarket` → `OrderType.FAK`) **stays as FAK** — different intent: a user clicking Close wants partial-exit-better-than-no-exit, even at dust risk. FAK is the right default there.
- `nodes/poly/app/src/features/copy-trade/mirror-coordinator.ts` (or wherever placement results are processed) — ensure `fok_no_match` results in `placement_failed reason=fok_no_match` with no retry, distinct from real errors.
- `docs/spec/poly-copy-trade-phase1.md` — add the structural invariant `FILL_NEVER_BELOW_FLOOR: a matched fill amount must always be ≥ market min_order_size, enforced at the execution primitive (FOK)`.
- Tests:
  - Unit: adapter places FOK on BUY/SELL via `placeOrder`.
  - Unit: FOK rejection classifies as `fok_no_match`.
  - Component (if cheap): copy-trade fills row stamps `placement_failed reason=fok_no_match` on a fake-CLOB no-match scenario.

### PR-B — Operator dial (follow-up, separate branch)

`executionMode` field on `MirrorTargetConfig`, DB column, API, UI control in `PolicyControls.tsx`. Default is `"fok"` (matches PR-A's hardcode); existing rows backfill to `"fok"` AT THE SAME TIME the UI ships, so operators can opt back to `"gtc"` if they want best-effort matching with explicit dust-acceptance.

Out of PR-A scope. Filed as `task.NNNN.poly-execution-mode-dial-bet-sizer-panel` once PR-A is in main.

## Files to touch (PR-A)

**Adapter — flip BUY/SELL on `placeOrder` to FOK:**

- `packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts:309`
  - `createAndPostOrder(..., OrderType.GTC, ...)` → `createAndPostOrder(..., OrderType.FOK, ...)`.
  - The existing intent-side `min_order_size` preflight stays — FOK still needs it because the exchange floor is checked at placement.
  - Manual close path (`sellPositionAtMarket`, line 420) keeps `OrderType.FAK` as default — see Ship plan above.
  - In `classifyClobFailure` (~line 925): when `success === false` AND no `placedOrderId` AND error pattern matches FOK no-match (empty body or "not enough" reason), emit `error_code: "fok_no_match"` distinct from `below_min_order_size`.

**Coordinator — `fok_no_match` is a clean skip, not a retry:**

- `nodes/poly/app/src/features/copy-trade/mirror-coordinator.ts` (or wherever rejection results are processed)
  - Map `error_code: "fok_no_match"` to `placement_failed reason=fok_no_match` on the fill row. Emit `poly.mirror.skipped event` log at info-level.

**Spec — land the invariant:**

- `docs/spec/poly-copy-trade-phase1.md` — add `FILL_NEVER_BELOW_FLOOR` invariant to the phase-1 invariant list with a one-paragraph rationale + link to bug.0405.

**Tests:**

- Unit: `packages/market-provider/tests/.../polymarket.clob.adapter.test.ts` — `placeOrder` constructs the CLOB call with `OrderType.FOK` for both BUY and SELL.
- Unit: `classifyClobFailure` returns `error_code: "fok_no_match"` on the no-match shape.
- Component: extend the existing copy-trade fills test with a fake-CLOB no-match scenario; assert the fills row stamps `placement_failed reason=fok_no_match` and no retry happens on the next tick.

## Out of scope (PR-A)

- **Operator dial UI + DB column.** Deferred to PR-B as described in Ship plan above. PR-A's hardcoded FOK is the right default; PR-B exposes it as toggleable.
- **Manual close (`sellPositionAtMarket` → FAK).** Different intent semantics; user clicking Close prefers partial-exit-with-dust over no-exit. Keeping FAK there is intentional, not an oversight.
- **Existing stranded dust cleanup.** Wait for market resolution; the redeem pipeline (PR #1106) recovers winning-side dust automatically. Losing-side is a write-off.
- **Depth pre-check.** TOCTOU; the exchange-side FOK invariant supersedes any client-side depth analysis.
- **Dashboard "stranded — awaiting resolution" affordance.** Real UX gap, downstream of source fix. File `task.NNNN.poly-dashboard-stranded-dust-affordance` after PR-A lands.
- **bug.0329 (neg-risk SELL empty reject).** Different failure mode, different bug.

## Validation

**exercise:**

On candidate-a, with a tenant configured for `executionMode: "fok"` (the default after this lands):

1. Trigger a mirror BUY for a market with thin orderbook depth at the inside ask (e.g. via a target wallet that just opened a niche market).
2. Confirm Loki shows either:
   - Full match: `event="poly.clob.place" side="BUY" status="filled" filled_size_usdc≈intent.size_usdc`, OR
   - Skip: `event="poly.mirror.skipped" reason="fok_no_match"`
3. Confirm `GET /api/v1/poly/wallet/positions` for the tenant shows ONLY positions with `size ≥ min_order_size` for the market in question. No sub-min entries appear.
4. Toggle the same target to `executionMode: "gtc"` via the policy panel; observe a subsequent BUY uses GTC and may produce a sub-min position (expected; this is the explicit opt-in).

**observability:**

```logql
# Should trend to zero at the deployed SHA
{env="candidate-a",service="app"} | json
  | reason=~".*share balance below market floor.*"

# New skip reason from FOK no-match — appears on thin-book scenarios
{env="candidate-a",service="app"} | json
  | event="poly.mirror.skipped"
  | reason="fok_no_match"

# Existing successful BUY events should now ALL have filled_size_usdc within
# epsilon of intent.size_usdc — partial-fill log signature disappears
{env="candidate-a",service="app"} | json
  | event="poly.clob.place" | side="BUY" | phase="ok"
```
