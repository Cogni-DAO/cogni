---
id: bug.0433
type: bug
title: "Poly redeem-worker won't unstick `lifecycle_state=loser` rows that bug.0431's race wrote — Derek's 50 winning positions on candidate-a stranded"
status: needs_triage
priority: 1
rank: 5
estimate: 3
created: 2026-04-30
updated: 2026-04-30
summary: "bug.0431 (#1139) fixed the future enqueue order so the winner-side row claim wins the race. It does NOT recover rows the buggy classifier already wrote. On candidate-a (sha cc7e709e5), Derek's wallet (`billing_account_id=777dedd4-b49e-443f-a1e7-23c2e77468ef`, funder `0x9A9e7276b3C4d6E7c9a866EB6FEB8CFaB82C160A`) has ~50 condition rows in `poly_redeem_jobs` with `status='skipped'`, `lifecycle_state='loser'`, `collateral_token=USDC.e`, `already_existed=true`. The subscriber re-observes resolution + emits `policy_decision: skip / losing_outcome` every reboot but `onConflictDoNothing` keeps the terminal-loser row in place. Net: he holds the WINNING outcome on chain, the redeem-worker never claims, no `redeemPositions` tx ever fires, no cash returns to the funder. Wallet is at 0 USDC.e + 0 pUSD because every winner is stuck in CTF tokens."
outcome: "On candidate-a + preview + (eventually) production, every `poly_redeem_jobs` row stamped `lifecycle_state='loser'` by the pre-bug.0431 classifier is re-decided against the on-chain payout vector + the user's actual CTF balance. Rows whose user holds the winning side flip to `pending/winner` so the worker claims and submits `redeemPositions`. Genuine losers stay terminal. Derek's 50 stranded positions on candidate-a unstick within one tick of the sweep. After the sweep, no manual SQL is ever needed — the subscriber's idempotent enqueue path detects the loser-row mismatch on re-observation and self-heals on subsequent runs without operator action."
assignees: []
spec_refs:
  - poly-collateral-currency
  - poly-trader-wallet-port
project: proj.poly-copy-trading
deploy_verified: false
labels: [poly, redeem, recovery, bug.0431-followup, stranded-funds]
external_refs:
  - work/items/bug.0431.poly-redeem-policy-misclassifies-winners-as-losers.md
  - work/items/task.0429.poly-auto-wrap-usdce-to-pusd.md
  - https://github.com/Cogni-DAO/node-template/pull/1139
---

# bug.0433 — Redeem-worker recovery sweep for stale `lifecycle_state=loser` rows

## Why this exists (production incident)

On candidate-a (sha `cc7e709e5`, post task.0429 deploy), Derek's wallet shows: 50 condition resolutions observed → every single one decided `policy_decision: { kind: "skip", reason: "losing_outcome" }` → every row already in DB with `lifecycle_state=loser, status=skipped, already_existed=true`.

But Derek confirmed: **all 50 positions are GREEN (winners) on the live Polymarket UI.** The on-chain payout vector says he holds the winning side. The classifier currently says "loser" because the row in `poly_redeem_jobs` was stamped that way pre-bug.0431-fix and `onConflictDoNothing` won't promote it.

Net effect: he is permanently locked out of his own winnings on candidate-a. Auto-wrap (task.0429) has nothing to wrap because no USDC.e ever returns to the funder.

## Root cause

bug.0431 (#1139, merged 2026-04-30) reorders enqueue candidates so the WINNER-side row enqueue claims `(funder, condition_id)` first. It applies to NEW enqueues only.

Existing rows are terminal:

```
status='skipped', lifecycle_state='loser', already_existed=true
```

Subscriber's idempotent path on re-observation:

1. `policy_decision({ kind: 'skip', reason: 'losing_outcome' })` (or `market_not_resolved`)
2. `enqueue(...).onConflictDoNothing()` — silent no-op because the unique key already has a row
3. No state transition, no claim by worker, no `redeemPositions` tx

## Repro

On candidate-a:

```logql
{env="candidate-a", namespace="cogni-candidate-a", service="app"}
  |= "poly.ctf.redeem.job_enqueued"
  |= "777dedd4-b49e-443f-a1e7-23c2e77468ef"
  | json
  | line_format "{{.condition_id}} status={{.status}} lifecycle={{.lifecycle_state}} already={{.already_existed}}"
```

Every line should be `status=skipped lifecycle=loser already=true`.

## Fix shape (proposed v0)

A one-shot recovery sweep + a guard rule:

1. **One-time SQL** (or a node script run once per env): for each row in `poly_redeem_jobs` with `status='skipped' AND lifecycle_state='loser'`:
   - Query `ConditionalTokens.payoutNumerators(condition_id)` on chain
   - For each `outcome_index`, compare to the actual user CTF balance for that `(condition_id, outcome_index)`
   - If the user holds the WINNER side: `UPDATE … SET status='pending', lifecycle_state='winner'` so the worker picks it up
   - If they really did lose: leave the row alone
2. **Guard for going forward** (in the redeem-subscriber): when `already_existed=true` and the existing row is `lifecycle_state=loser`, do an on-chain re-check before trusting the row. If the user actually holds winner-side CTF, transition `loser → winner` in DB. Costs one RPC `balanceOfBatch` per re-observation, but only fires when the row was stuck pre-fix.

Per-tenant on candidate-a: ~50 stale rows for `billing_account_id=777dedd4-…`.

## Out of scope

- Redoing bug.0431's classifier fix
- Auto-wrap loop (task.0429) — works fine when USDC.e arrives; this bug just blocks USDC.e from ever arriving
- Recovery on prod (no per-user impact yet because prod is on `2d7c8f100`, behind both fixes; but ANY pre-fix prod row will hit the same shape on next deploy)

## Validation

- Pre-sweep: `SELECT count(*) FROM poly_redeem_jobs WHERE billing_account_id='777dedd4-…' AND status='skipped' AND lifecycle_state='loser'` → 50
- Post-sweep: same query → number of actual losers; the rest flipped to `pending/winner`
- Worker claims them, submits `redeemPositions(USDC.e, …)` (V1 markets) or `redeemPositions(pUSD, …)` (V2)
- For V1: USDC.e lands at funder → task.0429's auto-wrap loop wraps to pUSD on next 60s tick → loop closed end-to-end
- For V2: pUSD lands directly, ready to fund next BUY

## Notes

- This is the bug that prevented task.0429's Tier-B validation. With this fixed, task.0429's loop demonstrates naturally without external transfers.
- Derek manually redeeming on Polymarket directly (bypassing the worker) also produces the same on-chain tokens at the funder address, so it's a valid manual workaround for unblocking task.0429's deploy_verified.
