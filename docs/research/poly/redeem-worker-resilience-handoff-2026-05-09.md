---
id: redeem-worker-resilience-handoff-2026-05-09
type: research
title: "Handoff: poly redeem-worker resilience — bug.5041 follow-up after bug.5040 cosmetic+observability fix"
status: draft
trust: draft
summary: "PR #1310 (bug.5040) shipped a dashboard-correctness fix (chain authority over redeem-job pipeline state) plus a one-shot migration that resets ~34 abandoned-via-transient_exhausted redeem jobs and adds structured `revert_reason`/`revert_data`/`err_short` fields to the `tx_failed_transient` log line. It does NOT fix the underlying tx-revert that caused the abandonment burst on 2026-05-09 00:32 UTC. That's bug.5041 — and there's now FRESH PROD DATA from the migration's auto-retry that you must look at first before proposing any fix."
read_when: "You are picking up bug.5041 (poly redeem worker reverts) — the deeper resilience fix after bug.5040's cosmetic + observability shipped. Or: you're investigating any future redeem-worker abandonment burst and want the up-to-date code map."
owner: derekg1729
created: 2026-05-09
implements: bug.5041
tags:
  [poly, redeem, worker, resilience, observability, state-machine, polygon-rpc]
---

# Poly redeem-worker resilience — handoff

## TL;DR

Wallet `0x95e407…5134` showed a ~$500 dashboard undercount because **34 redeem jobs got stuck in `lifecycle=abandoned`** during a 3-hour Polygon network instability window starting 2026-05-09 00:32 UTC. **PR #1310 (in prod as of `9a3b817e3`) shipped:**

1. **Dashboard correctness** (`bug.5040`): position state derives from chain (`poly_market_outcomes.payoutNumerator`) — not from redeem-job pipeline state. `abandoned` removed from `WALLET_EXECUTION_TERMINAL_LIFECYCLE_STATES`. Dashboard no longer hides positions whose redeem job abandoned but whose shares are still on chain.
2. **Migration `0046`**: one-shot reset of all `(status='abandoned', lifecycle_state='abandoned', error_class='transient_exhausted')` rows back to `(status='pending', lifecycle_state='winner', attempt_count=0)`. Idempotent.
3. **Decoded revert logging** in `tx_failed_transient`: new structured fields `revert_reason`, `revert_data`, `err_short` so future failures are queryable in Loki without parsing raw err strings.

What it did NOT ship: **the actual resilience fix for the worker.** The 3-strike circuit-breaker (`REDEEM_MAX_TRANSIENT_ATTEMPTS = 3`) doesn't distinguish RPC errors from chain reverts, so a 30-minute Polygon gas-spike window is enough to mass-abandon every redeem job that lands during it.

This handoff is for the next dev tackling that.

## STEP 0 — Look at the new prod data FIRST

PR #1310 deployed to prod at ~`2026-05-09T08:00Z`. The migration ran on the next migrator boot. The reset has likely already been processed (worker re-claims and re-tries are scheduled by reaper cadence ~30s).

**Before writing any code, query Loki for what happened on the retry.** This determines whether the "fix" is "do nothing — chain stabilization auto-recovered everything" or "build the proper RPC-vs-revert classification."

```bash
# 1. Did the reset rows succeed on retry?
scripts/loki-query.sh '{env="production",service="app"} | json | event="poly.ctf.redeem.job_confirmed"' 720 200 \
  | jq '.data.result | length'    # confirmed events in last 12h

# 2. Did any fail again? If so, how — and now we have decoded fields.
scripts/loki-query.sh '{env="production",service="app"} | json | event="poly.ctf.redeem.tx_failed_transient"' 720 100 \
  | jq -r '.data.result[].stream | "\(.condition_id) \(.revert_reason // "?") \(.err_short // "?" | .[0:100])"'

# 3. Cross-reference: how many of the original 34 stuck conditions now have a
#    `job_confirmed` vs another `tx_failed_transient`?
```

The list of 34 stuck conditions from the original incident is in this same handoff in **Appendix A**.

**If most succeeded** → the "fix" is mostly defensive: distinguish RPC errors from contract reverts so future Polygon gas spikes don't mass-abandon. No urgent code change.

**If many failed again with the same revert reason** → the new `revert_reason` / `revert_data` / `err_short` fields tell you what's actually breaking. Skip to the per-reason playbook below.

## What we already know (so you don't re-derive)

### 1. Failure window had two error classes (Loki sample, 30 events of 117)

```
24x  "The contract function 'redeemPositions' reverted."        ← chain-side revert
6x   "Missing or invalid parameters."                          ← Alchemy RPC error
```

The RPC-error sample showed `maxFeePerGas: 0x4bfbba1fa1` ≈ 326 gwei (Polygon typical: 30–150 gwei). **Polygon was experiencing a gas spike during the window.** That's load-bearing context — the same code paths worked at 00:32:06 (success) and failed at 00:32:31 (5 seconds later).

### 2. Chain probes from this wallet succeed NOW

For the top stuck condition (`0xce41a7675e914202fdd0346e46cb06843366649678969a261f014ece68316b5e`):

```bash
RPC=https://polygon-mainnet.g.alchemy.com/v2/<key>
WALLET=0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134
CTF=0x4D97DCd97eC945f40cF65F87097ACe5EA0476045   # V2 conditional tokens
# balanceOf(funder, asset=17935...4365) → 74270000   (74.27 shares — real)
# payoutNumerator(condId, 0) → 1                    (winner)
# payoutDenominator(condId)  → 1
# eth_call FROM funder of redeemPositions(USDC.e, 0, condId, [1,2]) → SUCCESS (returns 0x)
# eth_estimateGas FROM funder of redeemPositions(...)              → SUCCESS (gas estimate 0x1d792)
```

5 sampled stuck conditions ALL pass `eth_estimateGas` from the wallet at the latest block. **Chain says the redemptions would work right now.**

### 3. Code path is unchanged for weeks

```bash
git log --since='2026-04-15' --oneline origin/main -- \
  nodes/poly/app/src/features/redeem/ \
  nodes/poly/app/src/core/redeem/ \
  nodes/poly/app/src/adapters/server/redeem/ \
  nodes/poly/app/src/adapters/server/wallet/privy-poly-trader-wallet.adapter.ts \
  nodes/poly/packages/market-provider/src/policy/redeem.ts
```

Last meaningful change to the actual write path was **PR #1145 (April 19)** — `per-job collateralToken vintage at redeem dispatch (bug.0428)`. PR #1286 (May 6) added the `redeem-diff` periodic tick — that's how the 34 conditions all came in together (ConditionResolution events fired in a chain-batch when sports games finalized). **No code change explains why these 34 conditions started failing on May 9.**

### 4. Why "chain in a bad place" is a real category

`decideRedeem` (`nodes/poly/packages/market-provider/src/policy/redeem.ts:134`) protects against `payoutDenominator===0` by returning `skip:market_not_resolved`. But it does NOT protect against:

- CTF transfer failure inside `redeemPositions` (e.g., contract momentarily under-collateralized during a mass-redemption batch)
- Polygon nonce / gas-pricing edge cases under load
- Alchemy returning generic `"Missing or invalid parameters"` because of internal rate-limit / param-validation under load

These all surface as "tx_failed_transient" in our worker, get 1 of 3 strikes, abandon at 3.

## The proper fix (bug.5041)

The architectural defect: **the 3-strike circuit-breaker collapses two distinct failure classes into one count.**

| Class                               | What it is                                                                                                       | Should it consume retry budget?               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Chain revert** (deterministic)    | `ContractFunctionRevertedError` from viem; reason decodable; will fail forever unless something on chain changes | YES — eventually abandon                      |
| **RPC error / network** (transient) | `"Missing or invalid parameters"`, RPC timeouts, gas-price spikes during a window                                | NO — back off and retry, infrastructure fluke |

Today both eat 1 of 3, and 3 strikes within ~30 min is enough to mass-abandon during any half-hour of Polygon instability.

### Proposed shape

In `redeem-worker.ts:345` (the existing catch block — already augmented with `decodeRevertReason` in PR #1310):

```ts
// Pseudocode
} catch (err) {
  const cls = classifyError(err);  // "rpc_transient" | "chain_revert" | "unknown"

  if (cls === "rpc_transient") {
    // Don't consume retry budget. Just delay and retry next reaper tick.
    await this.deps.redeemJobs.markTransientFailure({ jobId: job.id, error: msg });
    // (do NOT increment attempt_count toward circuit-breaker;
    //  log structured event so we can rate-control if RPC noise becomes baseline)
  } else {
    // Existing 3-strike behavior for deterministic reverts and unknown.
    const result = transition(job, { kind: "transient_failure", error: msg });
    // ... abandon path stays as-is
  }
}
```

`classifyError` is a pure function — should live in `nodes/poly/app/src/features/redeem/error-classification.ts` or near `transitions.ts`.

Care needed:

- The classification rules must be deterministic from viem's error shape (don't sniff strings if you can avoid it). Use viem's typed errors: `BaseError.walk(e => e instanceof RpcRequestError)`.
- "Missing or invalid parameters" sometimes comes back from contract reverts too (Alchemy's wrapping). Verify with the new `revert_data` field — if data is `0x` and the URL was Alchemy, lean RPC. If data has actual revert bytes, lean chain.

### Don't change without thinking

- `REDEEM_MAX_TRANSIENT_ATTEMPTS` — staying at 3 is correct. Bumping doesn't help if you're not classifying. (I tried 50 in an earlier pass on this PR; reviewed away — burned Privy quota for ~zero benefit per the same-error-50-times retry pattern.)
- Schema: `poly_redeem_jobs.attempt_count` is INTEGER. Adding a separate `rpc_attempt_count` column is over-engineering — track in `lastError` / `errorClass` instead.

## Code pointers (with line numbers as of `9a3b817e3`)

| Concern                                                             | File                                                                                | Line/Function                                       |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| Worker entrypoint                                                   | `nodes/poly/app/src/features/redeem/redeem-worker.ts`                               | `drainOnePending`, ~L274                            |
| Existing tx_failed_transient catch (where decoded reason now lives) | `nodes/poly/app/src/features/redeem/redeem-worker.ts`                               | ~L345–L401                                          |
| `decodeRevertReason` helper (added in PR #1310)                     | `nodes/poly/app/src/features/redeem/redeem-worker.ts`                               | end of file                                         |
| Job state machine + retry budget                                    | `nodes/poly/app/src/core/redeem/transitions.ts`                                     | `REDEEM_MAX_TRANSIENT_ATTEMPTS = 3`, `transition()` |
| Decision policy (already protects against `denominator=0`)          | `nodes/poly/packages/market-provider/src/policy/redeem.ts`                          | `decideRedeem`, L134                                |
| Args builder                                                        | `nodes/poly/app/src/features/redeem/build-submit-args.ts`                           | `buildSubmitArgs`                                   |
| Collateral inference (verified correct via chain probe)             | `nodes/poly/app/src/features/redeem/infer-collateral-token.ts`                      | `inferCollateralTokenForPosition`                   |
| Privy account creation                                              | `nodes/poly/app/src/adapters/server/wallet/privy-poly-trader-wallet.adapter.ts`     | `resolveSigningContext`, ~L392                      |
| Mirror lifecycle (when worker writes `lifecycle=abandoned`)         | `nodes/poly/app/src/features/redeem/mirror-ledger-lifecycle.ts`                     | `mirrorRedeemLifecycleToLedger`                     |
| Spec                                                                | `docs/spec/poly-order-position-lifecycle.md`                                        | already updated for abandoned-not-position-terminal |
| Position-state derivation (chain-first)                             | `nodes/poly/app/src/features/wallet-analysis/server/current-position-read-model.ts` | `deriveCurrentPositionStatus`, ~L309                |

## Validation recipe for your fix

1. **Reproduce** the classification problem locally:
   - Mock viem errors of both kinds (RpcRequestError vs ContractFunctionRevertedError)
   - Unit-test `classifyError` returns the correct class for each
   - Unit-test that `rpc_transient` does NOT increment the circuit-breaker

2. **Verify on candidate-a**: trigger a redemption that hits an RPC error. Hardest part — Polygon instability isn't on-demand. Cheap simulation: temporarily point at a fake RPC that returns `"Missing or invalid parameters"` for the redemption write. Confirm the job stays in `failed_transient` and is retried on next reaper tick (NOT abandoned).

3. **Validate the deploy**: after flighting, query Loki for any net-new tx_failed_transient with `revert_reason: null AND err_short: "Missing"` — those should now show `error_class: "rpc_transient"` and not consume retry budget.

## Appendix A — the original 34 stuck conditions

Sourced from Loki query for `event="poly.ctf.redeem.tx_failed_transient"` over 24h on 2026-05-09. Use to cross-reference against `job_confirmed` events post-PR-#1310-deploy:

```
0x10d98ad569fcce8e55ea63a73d4da1afee3298d18b545e9f9e3cbefb6b420a7c
0x10e68b6f809dfd61c7fdf832d08c76f68e80e538f1e23edf41eaaac8fbf3e8a8
0x20acfcd5131a77a33605f7753ad0751d338a60fc378d3b05624831037c63f614
0x3221b3c604fe177de8e62ff3826c56965d801936a5abf7275b9abd14154f9dcc
0x3d0083e0dbdf83309e318b7314484c84a727023730e2aab6511fa1a76c7047fd
0x52de9acbe65b11e30fa4e8af3f2c290fd11768d743a0622a39895be04b39dbfe
0x57f34924f1cc09d1bc71758d37eaf25412983d7de41da6adf96549ee7bc9b0fa
0x5f7455f17171b878459bb9c9c54f8a73f205d55403fdb10911399b680f1a8da9
0x61658e2b575ce71a9aa486838945b96c88a05ddcbe1e12d6045a739d0095b54c
0x623cfbe4537673f653c6e574c51e63440e8cfe93917b1ccaaaaac1ebe837f0f0
0x747ae22c5e525a7ca1d8e1288e6888e1735bed2d3e6863307a24b8350d03a874
0x788c6cc69bc3ecc312a019e98a6a5996c96e213c9a956f93ba43f3e91592b159
0x7d5af6cef1d34cdb806cbe2e194ff26d9b7d4cf9b60f6f22ab915db6ef828367
0x89606c9235b218ee7fd0672b14828f2dc17878f146fd453a79134c59f31e2f4e
0x8bec5ce2d629d255f62f7250a17c8238c248f731ba2f021ae91f8b5bf2c332f0
0x8c55b551c9ad8de1a64cf004e5251fada92ee376c3630a79499808e2341e1efa
0x8e3e3cc812b4f452892979be3e4d2cd5b782ed310bf4e922e3929afe84efe1b8
0xa243bd2c1602ed39341665757930b58bbfbf75da1a3451127fec52a24f11f4d3
0xac89da3b11a30e5ac31c08ca61264517470d9b0a322a3727098e03398ee380e7
0xb802caf14e78d862a5b9801842360ca3759196b3ddfb0ce7386bba4cdbc3d494
0xc518f25e2dbddddc010cff8a5328ab68daeb3122657c732da94f0eda55c02a73
0xc70b0cec65bb9f9a240e353f19eda4e5f4c4aaeadf03f779d260e5428eab3cc3
0xc7383206726589d27d58caeecd4d1330b3a72222abcce7baca529075075c93dc
0xce41a7675e914202fdd0346e46cb06843366649678969a261f014ece68316b5e
0xd8a0227dfadb4d6164766540fffda9b83cd6bf71223503b4fbc3f85bd7337382
0xdd95c5402c70d499d33f1741028f34060c833bf597f9ec61479449fbc168d197
0xecdcfa1d67297a9a8cbf981691912f8bd8d1dc92275d921906ef7cc25665e06e
0xf06984bd00743b300b4d65208ed4119ceefc78b05ed2076e5e0166da6807aa01
0xf0cdb18eabb670cab5337cdf6d3a9a5841eca53d634add537fb482ef1b28baa0
0xf1bc2b61135b0f2e39181fe71edba8fe799c916c8989d99905443d00d205f115
0xf21f87eda19bfb8e7a573a06718aa830b74346da50fa5383fb52473f6fd76cb6
0xfaa9b2a799ec5a5165362726767b85a01fbb8b40c7a67de881b590de60f1c801
0xfb72e013230b80f9ccb4cafaa4f63bc08478b3ee54ab47db8f78284d6cc18ea8
0xffa235e0b15954bd14218374980952e91787e4c68b02e09af334706f4f1699ab
```

Mix: 14 vanilla CTF (`negativeRisk=false`), 14 neg-risk (`negativeRisk=true`), 0 mixed. **Both flavors failed equally — rules out flavor-specific routing as the cause.**

## Appendix B — what's already been ruled out

- ❌ **Code regression**: no recent changes to write path. Same code worked at 00:32:06, failed at 00:32:31, 5 seconds apart.
- ❌ **Wrong collateral inference**: chain probe `getPositionId(USDC.e, collectionId)` matches the wallet's expected positionId for vanilla cond `0xce41`. NegRiskAdapter routing is also correct (worker calls `0xd91E80…`).
- ❌ **Privy LocalAccount address mismatch**: error log `sender: 0x95e407…` matches funder address. Same `from` as my external eth_call which succeeded.
- ❌ **Multi-pod race condition**: 117 failures all from a single pod (`htf5b`); no nonce conflict via concurrent workers.
- ❌ **Specific market property**: even mix of negativeRisk True/False; even mix of event slugs; common factor is the time window only.

## Appendix C — useful Loki one-liners

```bash
# All failure events in the original window (replace with future windows as needed):
scripts/loki-query.sh '{env="production",service="app"} | json | event="poly.ctf.redeem.tx_failed_transient"' 1440 500

# Count of confirmed redemptions per hour:
scripts/loki-query.sh '{env="production",service="app"} | json | event="poly.ctf.redeem.job_confirmed"' 1440 500 \
  | jq -r '.data.result[].values[][0]' | xargs -n1 -I{} date -u -r $(({}/1000000000)) +%Y-%m-%d_%H \
  | sort | uniq -c

# Just the new structured fields (post-#1310):
scripts/loki-query.sh '{env="production",service="app"} | json | event="poly.ctf.redeem.tx_failed_transient"' 1440 200 \
  | jq -r '.data.result[].stream | [.condition_id, .revert_reason, .err_short] | @tsv'
```

Use `scripts/loki-query.sh` (auto-sources `.env.canary`/`.env.local` for the Grafana service-account token).
