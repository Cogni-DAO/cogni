---
id: bug.0428
type: bug
title: "Redeem worker hardcodes USDC.e collateralToken — V2 vanilla CTF positions silently bleed or yield wrong token"
status: needs_triage
priority: 1
rank: 5
estimate: 3
summary: "`nodes/poly/app/src/features/redeem/redeem-worker.ts:259` passes `POLYGON_USDC_E` as the `collateralToken` arg to `ConditionalTokens.redeemPositions(...)` for **every** vanilla-CTF redeem, regardless of whether the position was V1-minted (USDC.e collateral) or V2-minted (pUSD collateral). On V2 vanilla-CTF, this either reverts or silently burns nothing → bleed_detected. NegRisk redeems route through `NegRiskAdapter.redeemPositions(conditionId, amounts)` which doesn't take a collateralToken and pays out in whatever the adapter knows about (pUSD on V2), so neg-risk markets are unaffected. The bug only bites vanilla CTF V2 positions. Effect compounds: when this is fixed, V2 vanilla CTF positions correctly redeem to pUSD — closing the trade-to-trade currency cycle for new positions and reducing the surface that task.0429's auto-wrap loop has to clean up."
outcome: "Vanilla-CTF redeems pass the correct `collateralToken` based on the position's V1-vs-V2 vintage. V1 positions continue redeeming USDC.e (legacy expected behavior; user routes through task.0429 auto-wrap). V2 positions redeem to pUSD directly — no airlock round-trip needed for new positions. `poly.ctf.redeem.bleed_detected` rate drops on environments holding V2 vanilla CTF positions. Per-redeem-job audit fields capture which collateralToken was used."
spec_refs:
  - poly-collateral-currency
assignees: []
project: proj.poly-copy-trading
created: 2026-04-29
updated: 2026-04-29
labels: [poly, redeem, ctf, v2, currency, silent-bleed]
external_refs:
  - work/items/task.0429.poly-auto-wrap-usdce-to-pusd.md
  - docs/spec/poly-collateral-currency.md
  - nodes/poly/app/src/features/redeem/redeem-worker.ts
---

# bug.0428 — V2 vanilla CTF redeems use wrong collateralToken

## Symptom

`nodes/poly/app/src/features/redeem/redeem-worker.ts:255-269`:

```ts
if (args.kind === "ctf") {
  txHash = await this.deps.walletClient.writeContract({
    address: POLYGON_CONDITIONAL_TOKENS,
    abi: polymarketCtfRedeemAbi,
    functionName: "redeemPositions",
    args: [
      POLYGON_USDC_E,                                                       // ← hardcoded
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      job.conditionId,
      args.indexSets,
    ],
    ...
  });
}
```

`ConditionalTokens.redeemPositions(collateralToken, parentCollectionId, conditionId, indexSets)` burns the caller's CTF tokens for the given (collateralToken, parentCollectionId, conditionId) collection and pays out in `collateralToken`. The token must match what was used to MINT the position:

- V1 positions (pre-2026-04-28): minted by splitting USDC.e → CTF tokens. Redeem with collateralToken=USDC.e ✓.
- V2 positions (post-cutover): minted by splitting pUSD → CTF tokens. Redeem with collateralToken=USDC.e burns no balance and yields no payout. Effect surfaces as the existing `bleed_detected` invariant in `redeem-worker.ts:442` ("REDEEM_REQUIRES_BURN_OBSERVATION: no payout + balance>0").

NegRisk markets are unaffected — they route through `NegRiskAdapter.redeemPositions(conditionId, amounts)` (line 269-275) which doesn't take collateralToken; the adapter pays out in whatever it's been provisioned with (pUSD on V2).

## Why it hasn't bitten harder yet

- Production held legacy V1 CTF positions that were redeeming correctly to USDC.e.
- New V2 vanilla-CTF positions get opened by mirror BUYs, but most fail at FOK (96% rejection per task.0427 design data). When they DO fill, they sit unresolved until the market settles — most observed copy-trade markets are neg-risk, not vanilla CTF.
- So we have very few V2-vanilla-CTF resolved positions in the system to redeem yet. The bug is dormant. It will surface as soon as a tenant holds a vanilla-CTF V2 position to resolution.

## Fix

`redeem-worker.ts` needs to know the position's vintage. Options to evaluate during implementation:

- **(A) Look up vintage from the conditionId / market metadata.** If we can determine "this market resolved post-V2-cutover-block-N → must redeem with pUSD," we use a deterministic block-number cutover. Cleanest if available.
- **(B) Read `attributes.collateral_token` from the redeem-job row** if the upstream coordinator captures it at job-creation. Probably the right answer; the redeem job is created when we observe a position the user holds, and at that moment we know what token the position was minted against (from the trade ledger or chain query).
- **(C) Try-pUSD-first fallback to USDC.e.** Cheapest to implement, costs an extra failed simulation per redeem when wrong-guessing. Discouraged: silent fallbacks mask real bugs.

Lean toward (B). Capture `collateral_token` at redeem-job-create time; use it on dispatch.

Also surface in observability:

| field                            | required when | source                              |
| -------------------------------- | ------------- | ----------------------------------- |
| `collateral_token_used`          | always        | the arg passed to `redeemPositions` |
| `collateral_token_inferred_from` | always        | "ledger" / "chain" / "default"      |

## Out of scope

- The auto-wrap loop closing the V1-legacy + deposit cycle. That's task.0429.
- NegRisk adapter changes. Already correct.
- Backfilling failed-redeem jobs from before the fix. Separate cleanup spec if needed.

## How to start (next-dev orientation)

Worktree at `/Users/derek/dev/cogni-template-worktrees/feat-poly-auto-wrap-usdce-to-pusd` is bootstrapped. Same branch as task.0429 — these two ship together because they both close the wallet-currency cycle (V2 redeems pay out pUSD; auto-wrap handles the V1-legacy + deposit residue).

Suggested first commit:

1. **Capture vintage at job-create time.** Find where `poly_redeem_jobs` rows get inserted (likely `redeem-subscriber.ts` or a redeem-coordinator equivalent). At insert time we already know whether the position is V1 or V2 — either from the trade ledger row or from a chain query. Add a `collateral_token` column to the redeem-job row.
2. **Use it at dispatch.** Replace the hardcoded `POLYGON_USDC_E` at `nodes/poly/app/src/features/redeem/redeem-worker.ts:259` with the value from the job row.
3. **Audit log fields.** Add `collateral_token_used` + `collateral_token_inferred_from` to the `poly.ctf.redeem.tx.confirmed` event payload.

Test path: existing `nodes/poly/app/tests/component/redeem/...` integration tests + a unit test asserting V1-vintage → USDC.e and V2-vintage → pUSD.

## Validation

**exercise:** on candidate-a, hold a V2 vanilla-CTF position to settlement (or simulate via a fixture). Observe redeem fires with `collateral_token_used = pUSD` and pUSD balance increases by the position payout.

**observability:**

```logql
{env="candidate-a", service="app"} | json
  | event="poly.ctf.redeem.tx.confirmed"
  | collateral_token_used="0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB"
```

Should fire whenever a V2 vanilla-CTF position resolves and we redeem it.
