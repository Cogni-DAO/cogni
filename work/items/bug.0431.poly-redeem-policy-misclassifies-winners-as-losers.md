---
id: bug.0431
type: bug
title: "Redeem policy misclassifies winning vanilla CTF positions as losers — $14.99 stranded on prod"
status: needs_implement
priority: 1
rank: 5
estimate: 3
summary: "Production observation 2026-04-29 ~08:25Z: funder `0x95e407…` holds 9.99 shares of Tampa Bay Rays (won, curPrice 1.0, currentValue $9.99, redeemable=true) and 5 shares of Oilers/Ducks Ducks side (won, curPrice 1.0, currentValue $5.00, redeemable=true). Both vanilla CTF (negative_risk=false). Both are sitting in `poly_redeem_jobs` with `status=skipped lifecycle_state=loser attempt_count=0` — the redeem policy classified them as losers and skipped them. The redeem-worker correctly redeemed 20 other historical conditions; it is the policy capability (task.0387 territory) that's misclassifying this subset. Net effect: $14.99 of real, claimable, on-chain pUSD/USDC.e collateral stranded indefinitely. Until this is fixed, every vanilla CTF win that the policy mis-judges is silently abandoned by the worker."
outcome: "The redeem policy correctly classifies a position as winner when the user holds the outcome that matches `payoutNumerators[outcomeIndex] > 0`. The two specific cases that triggered this bug (Tampa Bay Rays vs Cleveland Guardians, Oilers vs Ducks) classify as `winner`, not `loser`. A unit test on the policy fixture covers the exact `payoutNumerators` shape that triggered it. `lifecycle_state='loser'` rows where on-chain CTF balance > 0 for the held outcome are detectable as a metric and surface as `poly.ctf.redeem.policy.misclassified` for ops alarming."
spec_refs:
  - poly-position-exit
assignees: []
project: proj.poly-copy-trading
created: 2026-04-29
updated: 2026-04-29
labels: [poly, redeem, policy, ctf, silent-bleed, lost-money]
external_refs:
  - work/items/task.0387.poly-redeem-policy-capability-a.md
  - work/items/task.0388.poly-redeem-job-queue-capability-b.md
  - nodes/poly/app/src/features/redeem/resolve-redeem-decision.ts
---

# bug.0431 — Redeem policy misclassifies winners as losers

## Symptom

Production funder `0x95e407…`:

| condition_id  | market                                | outcome held     | on-chain                                         | DB redeem job                    |
| ------------- | ------------------------------------- | ---------------- | ------------------------------------------------ | -------------------------------- |
| `0x4eaf5295…` | Tampa Bay Rays vs Cleveland Guardians | "Tampa Bay Rays" | 9.99 shares, curPrice 1.0, redeemable, **$9.99** | `status=skipped lifecycle=loser` |
| `0xb0914421…` | Oilers vs Ducks                       | "Ducks"          | 5.00 shares, curPrice 1.0, redeemable, **$5.00** | `status=skipped lifecycle=loser` |

For each condition, the redeem subscriber observes the resolution and the policy makes two decisions (one per outcome). Loki shows the pattern:

```
poly.ctf.redeem.policy_decision  reason=losing_outcome   ← outcome we DON'T hold (correct skip)
poly.ctf.redeem.job_enqueued                              ← winning outcome got enqueued
poly.ctf.redeem.policy_decision                           ← winning outcome (no reason field — should mean "redeem")
```

Yet the resulting DB row lands as `lifecycle=loser status=skipped`. So either:

1. The "winning" decision result is being persisted with the wrong lifecycle_state (e.g. the second `policy_decision` log is misleading and the job actually gets stamped loser by a downstream step).
2. There are TWO policy_decision evaluations for the same condition — one for outcome 0, one for outcome 1 — and the LAST write wins, which is the loser side.

Either explanation is a real bug. 20 other conditions DID redeem successfully (`status=confirmed lifecycle=redeemed`), so the path works in general — this subset gets misclassified.

## Likely root cause

`resolve-redeem-decision.ts` reads `payoutNumerators(conditionId)` and decides per-outcome. The aggregate redeem job is per-condition, not per-outcome (unique constraint `(funder_address, condition_id)`). If the policy iterates outcomes and the LAST one wins the row state, then:

- For binary markets, last outcome iterated is outcome index 1.
- If outcome 1 lost (e.g. Tampa Bay won = outcome 0; Cleveland Guardians = outcome 1 lost), the row gets stamped from the loser perspective.
- For Oilers/Ducks: Ducks (outcome 1?) won; if outcome 0 (Oilers) was iterated last → loser stamp wins.

Or there's an outcome-index off-by-one inside `decision-to-enqueue-input.ts` / `resolve-redeem-decision.ts`. Investigation point #1.

## Recovery for the current incident

Two redeem jobs flipped manually back to `status=pending lifecycle=winner attempt_count=0` so the worker redispatches them. Result observed in Loki:

```logql
{env="production", service="app"} | json
  | event=~"poly.ctf.redeem.tx.*|poly.ctf.redeem.bleed_detected"
  | condition_id=~"0x4eaf5295.*|0xb0914421.*"
```

If those redeem to non-zero pUSD, the bug bites only at the policy decision; the worker dispatch + chain code are correct. If they bleed (`bleed_detected`), there's a second compounding bug (vintage / collateralToken — see bug.0428).

## Fix

1. **Reproduce the bug in a unit test** — fixture for `resolve-redeem-decision.ts` with the two specific `payoutNumerators` shapes that triggered it (binary, outcome 0 wins; binary, outcome 1 wins; user holds each outcome). Assert the right per-outcome `kind` (`redeem` vs `skip:losing_outcome`). Lock the contract.
2. **Trace the actual misclassification** — the unit test will show whether the bug is in:
   - `resolve-redeem-decision.ts` mapping `payoutNumerators[i]` → outcome wins/loses
   - `decision-to-enqueue-input.ts` collapsing per-outcome decisions into a single redeem-job lifecycle_state
   - The redeem subscriber's logic for which outcome's decision lands in the DB
3. **Add observability** — emit `poly.ctf.redeem.policy.misclassified` counter when the redeem subscriber processes the same condition twice with conflicting decisions, or when a row stamped `lifecycle=loser` later gets evidence of a non-zero CTF balance.

## Out of scope

- bug.0428's collateralToken hardcode — orthogonal. Even if the policy classified correctly, vanilla CTF V2 redeems would still hit bug.0428.
- The 1 abandoned row — separate audit.
- Reconciliation of the 48 currently-loser rows for hidden winners — once the test fixture is in place, write a backfill job that re-queries chain payouts for every `loser`-stamped row and re-classifies any with a non-zero CTF balance. Defer to a follow-up.

## Files to touch

- `nodes/poly/app/src/features/redeem/resolve-redeem-decision.ts` — primary logic location.
- `nodes/poly/app/src/features/redeem/decision-to-enqueue-input.ts` — per-outcome → per-job collapsing.
- `nodes/poly/app/src/features/redeem/redeem-subscriber.ts` — observation loop that calls the policy.
- New test file: `nodes/poly/app/tests/unit/features/redeem/policy-binary-classification.test.ts`.

## Validation

**exercise:** unit-test fixture using actual prod `payoutNumerators` for `0x4eaf5295…` and `0xb0914421…` (read on chain, hardcode in the test). Assert the held-outcome decision is `kind: "redeem"`, not `kind: "skip", reason: "losing_outcome"`.

**observability (post-fix, for incident detection):**

```logql
{env="candidate-a", service="app"} | json
  | event="poly.ctf.redeem.policy.misclassified"
```

Should be 0 in steady state.
