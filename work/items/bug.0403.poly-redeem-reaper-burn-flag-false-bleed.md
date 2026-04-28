---
id: bug.0403
type: bug
title: poly redeem reaper trusts stale receipt-burn flag → false bleed_detected on no-op retries
status: needs_merge
priority: 1
rank: 1
estimate: 1
branch: fix/poly-redeem-pipeline-decoder-bugs
summary: "After task.0388 (PR #1082) deployed, 7 winning positions on the operator funder were redeemed on-chain (real burns + USDC payouts) but the pipeline's bookkeeping marked 5 of them as `abandoned/malformed` — one fired a false `bleed_detected@50` alert. Root cause: the reaper transitioned `submitted → failed_transient` (`burn_reorged_out`) when the subscriber hadn't yet observed `PayoutRedemption` at N=5; the worker re-claimed and submitted a no-op retry tx (position already burned); the no-op retry's receipt had `burn=false`, overwriting the persisted flag from the original successful tx; on the next reaper pass the burn-false branch fired `bleed_detected@50` + abandoned/malformed."
outcome: "After this bug closes: (1) the reaper queries chain truth at N=5 — batched `getLogs(PayoutRedemption, redeemer=funder)` per flavor (CTF for binary/multi, NegRiskAdapter for neg-risk-*) and `balanceOf` for any candidate without a matching log; (2) a new transition event `reaper_chain_evidence` replaces `reaper_finality_elapsed` and routes on `(payoutObserved, balance)`: payout → confirmed; no-payout && balance>0 → bleed_detected@50 + abandoned/malformed; no-payout && balance==0 → confirmed defensively at warn-level (off-pipeline settlement, audit signal `balance_zero_no_payout`); (3) RPC failure on `getLogs` defers all candidates of that flavor to the next tick, never falling through to the balanceOf path — protects the audit channel from RPC-flake noise; (4) `receipt_burn_observed` flag is persisted at submission time as observational only and never decides confirm-vs-bleed; (5) 19 transition unit tests cover the new state machine including the rejection-from-confirmed idempotency path. Operator action post-deploy: one-line SQL UPDATE to reset the 7 wrongly-abandoned rows on prod's `poly_redeem_jobs` so the new reaper picks them up."
spec_refs: []
assignees: []
credit:
project: proj.poly-copy-trading
pr: https://github.com/Cogni-DAO/node-template/pull/1086
reviewer:
revision: 1
blocked_by: []
deploy_verified: false
created: 2026-04-27
updated: 2026-04-27
labels: [poly, redeem, reaper, bug, observability]
external_refs:
---

# poly redeem reaper — query chain truth, not stale receipt-burn flag

## Reproduction

Funder `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134` (operator), prod `cogni_poly` DB after task.0388 deploy:

```sql
SELECT id, condition_id, flavor, status, attempt_count, error_class,
       receipt_burn_observed
FROM poly_redeem_jobs
WHERE status = 'abandoned' AND error_class = 'malformed';
```

Returns 5 rows. On-chain receipts for the txs in `tx_hashes` show `status=0x1`, `gasUsed=167K–195K`, 1 USDC.e Transfer to funder, 1 NegRiskAdapter or CTF `PayoutRedemption(redeemer=funder)` event. **Real burns. Real payouts. Pipeline says abandoned.**

## Evidence

| condition       | flavor          | DB status                              | DB burn   | actual on-chain                | bug                            |
| --------------- | --------------- | -------------------------------------- | --------- | ------------------------------ | ------------------------------ |
| `0x18ec34d0…`   | neg-risk-parent | abandoned/malformed                    | true      | redeemed (gas 195K, USDC xfer) | false-negative                 |
| `0x6178933348…` | neg-risk-parent | abandoned/malformed                    | true      | redeemed (gas 168K, USDC xfer) | false-negative                 |
| `0xeb7627b6…`   | neg-risk-parent | confirmed/redeemed                     | true      | redeemed (gas 195K, USDC xfer) | correct                        |
| `0x86c171b7…`   | neg-risk-parent | abandoned/malformed                    | true      | redeemed (gas 195K, USDC xfer) | false-negative                 |
| `0x941012e7…`   | neg-risk-parent | abandoned/malformed                    | true      | redeemed (gas 168K, USDC xfer) | false-negative                 |
| `0xe8e5b5a4…`   | binary          | confirmed/redeemed                     | **false** | redeemed (gas 117K, USDC xfer) | flag-corruption                |
| `0x986484312e…` | binary          | abandoned/malformed (`bleed_detected`) | **false** | redeemed (gas 102K, USDC xfer) | **false-positive bleed alert** |

## Root cause

The reaper's `reaper_finality_elapsed` transition (per task.0388) trusted the local `receiptBurnObserved` flag to decide between `bleed_detected@50` (`!burn`) and `failed_transient` retry (`burn`). The flag has two reliability problems:

1. **Subscriber-slow race.** `watchContractEvent` poll cadence (~4s) can be slower than the reaper's N=5 finality window (~12s on Polygon post-Heimdall-v2). When the subscriber hasn't yet observed `PayoutRedemption`, the reaper sees `burn=true` and fires `failed_transient` on a job that actually succeeded.

2. **No-op retry corruption.** Each `submission_recorded` overwrites `receipt_burn_observed`. After the false `failed_transient` above, the worker re-claims and submits a no-op tx (the position is already burned). The no-op's receipt has no `TransferSingle(from=funder)` (binary) or no `PayoutRedemption(redeemer=funder)` from NegRiskAdapter — the flag flips `true → false`. Next reaper pass: `!burn` → `bleed_detected@50` + abandoned/malformed.

The bleed alert was therefore untrustworthy — false positives exist by design under any subscriber-slow event.

## Fix

Replace local-flag inference with on-chain measurement at N=5:

1. Reaper batch-fetches `PayoutRedemption(redeemer=funder)` logs via `getLogs` per flavor across all candidate jobs (one RPC per flavor per tick, filtered by indexed `redeemer` topic).
2. For each candidate without a matching log, reads `balanceOf(funder, positionId)` on the CTF contract.
3. Dispatches `reaper_chain_evidence { payoutObserved, balance }` to `core/redeem/transitions`:
   - `payoutObserved` → `confirmed` + `lifecycle_state=redeemed`
   - `!payoutObserved && balance > 0` → `abandoned/malformed` + `bleed_detected@50`
   - `!payoutObserved && balance == 0` → `confirmed` + `lifecycle_state=redeemed` + warn-level `balance_zero_no_payout` (off-pipeline settlement audit signal)
4. RPC failure on `getLogs` returns `null` from `fetchPayoutMap`; reaper defers all candidates of that flavor to the next tick — no fall-through to `balanceOf` (which would mark genuinely-redeemed positions as `balance_zero_no_payout` and pollute the audit channel).
5. `receipt_burn_observed` stays in the schema as observational only; the worker still writes it at `submission_recorded` time but no transition reads it.

## Files changed

- `nodes/poly/app/src/core/redeem/transitions.ts` — `reaper_finality_elapsed` event kind replaced by `reaper_chain_evidence`. Two new invariants: `REAPER_QUERIES_CHAIN_TRUTH`, `REDEEM_REQUIRES_BURN_OBSERVATION` redefined to "no payout + balance>0".
- `nodes/poly/app/src/features/redeem/redeem-worker.ts` — `reapStale` rewritten; new private `fetchPayoutMap`. New events: `poly.ctf.redeem.balance_zero_no_payout` (warn), `poly.ctf.redeem.reaper_getlogs_failed` (warn), `poly.ctf.redeem.reaper_balance_read_failed` (warn), `poly.ctf.redeem.job_confirmed { source: "reaper" }` (info).
- `nodes/poly/app/tests/unit/core/redeem/transitions.test.ts` — 4 new transition tests (3 branches + confirmed-rejection idempotency).
- `nodes/poly/app/src/features/redeem/AGENTS.md` — public surface + invariants updated.

## Validation

**exercise:** post-deploy operator data-fix — reconcile the 7 wrongly-abandoned rows on prod's `cogni_poly` DB directly to `status='confirmed'`. The on-chain truth is already preserved in `tx_hashes`; this is bookkeeping reconciliation, not a re-redemption.

Do NOT route these rows through the reaper. Each abandoned row's `submitted_at_block` was overwritten by the no-op retry tx (the very bug we're fixing), so the reaper's `getLogs` window starts after the original `PayoutRedemption` block — it would defensive-confirm via `balance_zero_no_payout` (false-positive audit signal) and additionally burn ~1.2M gas across 7 no-op `redeemPositions` resubmissions. Direct UPDATE is correct here.

```sql
UPDATE poly_redeem_jobs
SET status = 'confirmed',
    lifecycle_state = 'redeemed',
    confirmed_at = now(),
    error_class = NULL,
    last_error = NULL,
    abandoned_at = NULL,
    updated_at = now()
WHERE status = 'abandoned'
  AND error_class = 'transient_exhausted'
  AND funder_address = '0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134'
RETURNING id, condition_id, flavor;
```

**observability:** rows transition straight to terminal state via SQL — no chain activity, no new pipeline events.

- DB: 7 rows now `status='confirmed', lifecycle_state='redeemed'`, audit trail (`tx_hashes`) preserved
- Dashboard History tab renders 7 rows as redeemed; Open tab no longer shows them
- Zero new `poly.ctf.redeem.*` events from this UPDATE
- Going forward, any new resolution on the operator funder flows cleanly through the new reaper (chain-truth-based) — `bleed_detected` is now trustworthy, and `balance_zero_no_payout` is reserved for genuine off-pipeline settlement.

## Out-of-scope follow-ups

- **v0.3 reorg gap (`ACCEPTED_REORG_GAP`).** Reaper-confirmed rows are invisible to the subscriber's `payout_redemption_reorged` handler. Polygon Heimdall-v2 finality at N=5 makes deep reorgs extremely rare; documented but not fixed.
- **Worker integration tests for `reapStale`.** Existing coverage is unit-only on `transitions`. The worker-level flow (getLogs map building, balance fallback, batched per-flavor split) lacks integration tests. Pre-existing gap from task.0388, surfaced here.
- **`RedeemJobsPort.markConfirmed.txHash` shape.** Adapter ignores the `txHash` arg today; port should mark it optional or drop it. Minor port refactor.
