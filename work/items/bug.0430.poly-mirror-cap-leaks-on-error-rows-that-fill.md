---
id: bug.0430
type: bug
title: "Per-position cap leaks because `error` ledger rows can actually fill on chain — `cumulativeIntentForMarket` reads $0 while wallet holds $25"
status: needs_review
priority: 1
rank: 5
estimate: 3
summary: "task.0424's `cumulativeIntentForMarket` excludes rows where `status='error'` from the per-(tenant, market) cap math. Production observation 2026-04-29 ~08:20Z: ledger has 45 `error` rows for `Shymkent 2` ($98.30 total intent, $0 in any `pending|open|filled|partial` row), but the funder's wallet on chain holds 31.65 shares of Andrej Nedic at avgPrice $0.6667 ≈ **$21 actually paid**, plus 13.13 shares of Mathys Erhard at $0.32 ≈ $4.20. ~$25 of CTF tokens minted by orders the API call returned errors for. Most likely path: the bug.0421 reclassifier (FOK success-with-zero-fill → fok_no_match) reclassified some real fills as no-match, OR placement timed out at the API boundary while the order matched on the book. Either way: the cap excludes `error` → reads $0 → unbounded placement on the same market. The Shymkent2 position is 4× over the $5/trade cap because of this."
outcome: "Per-(tenant, market) cap math correctly accounts for committed exposure including rows that *might* have filled despite an error stamp. Either: (a) include `error` rows when summing intent (pessimistic — assumes any errored order *might* have matched), or (b) the reconciler verifies on-chain CTF balance vs ledger and corrects mis-stamped rows before the cap reads them. Whichever path is chosen, the case `45 error rows on a market + on-chain CTF balance > 0 ⇒ cap evaluates the on-chain reality, not the misleading ledger` must be tested. Validation: replay a fixture where a placement throws but the chain mints CTF; assert next placement returns `position_cap_reached`."
spec_refs:
  - poly-copy-trade-phase1
  - poly-multi-tenant-auth
assignees: []
project: proj.poly-bet-sizer
created: 2026-04-29
updated: 2026-04-29
labels: [poly, copy-trading, sizing, cap, ledger-truth, silent-bleed]
external_refs:
  - work/items/task.0424.poly-bet-sizer-per-position-cap.md
  - work/items/bug.0421.poly-clob-fok-success-zero-fill.md
  - https://github.com/Cogni-DAO/node-template/pull/1131
  - nodes/poly/app/src/features/trading/order-ledger.ts
  - nodes/poly/app/src/features/copy-trade/plan-mirror.ts
---

# bug.0430 — Cap leaks because error rows can actually fill

## Symptom

Production funder `0x95e407…`, market `0x0674d9d1…` (Shymkent 2: Mathys Erhard vs Andrej Nedic):

| layer                                                                   |                                                                                                                               finding |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------: | ------ | -------- | ----- |
| `poly_copy_trade_fills` rows for this `(billing_account_id, market_id)` |                                                                       **45 rows, all `status=error`, $98.30 total intent, $0 filled** |
| `poly_copy_trade_fills` rows in `pending                                |                                                                                                                                  open | filled | partial` | **0** |
| `cumulativeIntentForMarket` math                                        |                                                                                                 reads **$0** ← cap thinks no exposure |
| `data-api/positions` for funder                                         | 31.65 shares Andrej Nedic @ $0.6667 = **~$21 paid**; 13.13 shares Mathys Erhard @ $0.32 = **~$4.20 paid** ⇒ **$25 actually invested** |
| `max_usdc_per_trade` config                                             |                                                                                                                                    $5 |

Position is 4× over the per-trade cap because the cap can't see committed exposure that's stamped `error`.

## Why this happens

`cumulativeIntentForMarket` (added in PR #1131 / task.0424) sums `attributes.size_usdc` from rows in status `pending | open | filled | partial`. It deliberately excludes `canceled | error`.

The intent at v0 was: "errors mean the placement didn't happen on chain, don't count them against the cap." That assumption fails because of two known paths:

1. **bug.0421's reclassifier** — `FOK success-with-zero-fill` cases where the CLOB returned a success envelope with `filled_size = 0` are reclassified to `fok_no_match`, which (depending on how the executor re-stamps) may end up as `error` in the ledger. If the order ACTUALLY matched on the book between the API submit and our zero-fill response (rare but possible — book moves faster than the response), our ledger says "error didn't fill" but chain says "we hold the CTF token."
2. **Network-timeout at the API boundary** — `walletClient.writeContract` throws after the tx was already broadcast and matched. We catch the throw and stamp the row `error`. Order is on chain, ledger doesn't know.

Either way, the cap math reads zero exposure on a market where the wallet holds real positions, and approves more placements.

## Recent failure window

In the 30 minutes before 08:20Z (post-wrap, pUSD healthy), 9 successive placements on the Shymkent2 market returned `error placement_failed` but together summed to $27.30 of intent. That matches the on-chain $25 paid (avgPrice math) within rounding. Read: those 9 placements all filled on chain even though the ledger says they errored.

## Severity escalation observed live

Following the 08:10:46Z wrap, **$47.07 of pUSD was the post-wrap balance**. Over the next ~25 minutes, the mirror placed continually against active copy-trade targets. By 08:37Z, **pUSD had drained to $0.60** — a **$46.40 spend** — yet the ledger shows only **$1.35 of `status=filled` rows** in that window. **~$45 of "error" rows actually filled on chain and consumed pUSD without the app's knowledge.** This is not a cap-bypass-once edge case — it is the steady-state behavior of the current cap implementation under any production target. Until this is fixed, copy trading must be considered structurally unsafe to leave running. Production copy-trade kill switch was flipped to `enabled=false` at 08:42Z to stop the bleed.

## Fix options

### (A) Pessimistic: include `error` in `cumulativeIntentForMarket`

Treat any errored placement as "might have filled, can't prove otherwise." Cap is now strictly more conservative.

- **Pro:** trivial — single SQL change. Works immediately.
- **Pro:** safer for live money.
- **Con:** in the 96% rejection regime (per task.0427), most errors really didn't fill. The cap will block legitimate retries. Could push tenants into perpetual cap-blocked state on hot markets.
- **Mitigation:** pair with the reconciler that subtracts intent off the cap once we _prove_ a row didn't fill (e.g. observed `fok_no_match` confirmed by on-chain absence).

### (B) Reconciler-driven: cross-check on-chain CTF balance before the cap reads

When a row gets stamped `error`, schedule a `verify_on_chain` job. The verifier reads CTF balanceOf(funder, asset) and:

- balance > 0 → flip the row from `error` → `partial` or a new `error_filled_silently` status. Cap counts it.
- balance == 0 → leave row at `error`. Cap ignores it.

- **Pro:** correct in both directions.
- **Con:** more code; adds an RPC dependency; lag between error-stamp and reconciler verification (cap is loose during that window).

### (C) Synchronous: at error-stamp time, immediately read CTF balance before promoting

Before stamping `error`, do a single chain read for the asset's balance. If non-zero, stamp `error_filled_silently` (or `partial` with filled_size_usdc inferred). Cap counts it.

- **Pro:** no race.
- **Con:** synchronous chain read on every error path is slow; rate-limit-sensitive.

Lean toward **(A) for v0** as the immediate hard fix (one-line change to the cap SQL), then **(B) as the durable fix** that ships alongside task.0429's auto-wrap (same observability backplane). Both can ship sequentially — the v0 fix is shippable today and the (B) fix follow-up later.

## Out of scope

- The bug.0421 reclassifier's behavior on its own (separate concern; this bug just notes that bug.0421 + the cap exclusion compound).
- General reconciler design across all features — only the redeem and order-ledger layers need it.
- Backfilling historical error rows — forward-only.

## Files to touch

- `nodes/poly/app/src/features/trading/order-ledger.ts` — modify `cumulativeIntentForMarket`. Option (A): change `inArray(polyCopyTradeFills.status, ['pending','open','filled','partial'])` → `notInArray(polyCopyTradeFills.status, ['canceled'])` so error and pending and filled all count. (Or just remove the `canceled` rows.)
- `nodes/poly/app/src/adapters/test/trading/fake-order-ledger.ts` — same logic update on the fake.
- `nodes/poly/app/tests/unit/features/trading/order-ledger-cumulative-intent.test.ts` — update fixtures to expect error rows IN the sum.
- `nodes/poly/app/tests/unit/features/copy-trade/plan-mirror-sizing-fixed.test.ts` — add a regression: a market with 5 error rows of $1 each + new $1 intent on a $5 cap → `position_cap_reached`.

## Validation

**exercise:** on candidate-a, induce an `error` row (mock the CLOB submit to throw after broadcast) on a target's BUY. Verify the next BUY on the same market with `cumulative + intent > cap` returns `position_cap_reached` even though the previous attempt was `error`.

**observability:**

```logql
{env="candidate-a", service="app"} | json
  | event="poly.mirror.decision"
  | reason="position_cap_reached"
```

Should fire on the second placement.
