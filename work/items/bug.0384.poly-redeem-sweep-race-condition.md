---
id: bug.0384
type: bug
title: poly CTF redeem sweep — read-then-write race burns gas on duplicate redeems
status: needs_merge
priority: 0
rank: 1
estimate: 1
branch: bug/0384-sweep-race
summary: bug.0383's predicate gates only per-position. Sweep ticks running concurrently (or manual route racing the sweep) all read the same pre-burn balance and re-fire `redeemPositions` on the same condition. After a 1 POL refund of the prod funder, 82 redeem txs fired in 13 min but only 3 paid USDC ($17.13) — 79 no-op duplicates burned ~0.79 POL.
outcome: One on-chain redeem per resolved-winning condition per process lifetime. Inter-tick sweep overlap impossible (mutex). Manual ↔ sweep races impossible within a 60s cooldown window. Sweep wall-clock duration emitted on every cycle so the next race-class issue surfaces in Loki within the hour.
spec_refs:
assignees: []
credit:
project: proj.poly-web3-security-hardening
pr: https://github.com/Cogni-DAO/node-template/pull/1070
reviewer:
revision: 2
blocked_by:
deploy_verified: false
created: 2026-04-26
updated: 2026-04-26
labels: [poly, gas, web3, incident, redeem, race-condition]
external_refs:
---

# poly CTF redeem sweep — read-then-write race burns gas on duplicate redeems

## Requirements

### Observed

After bug.0383 shipped to production (PR #1065, sha `c24d2f78b`), the
predicate correctly skips losing-outcome ERC1155 (verified: 796
`poly.ctf.redeem.skip_losing_outcome` events / 30m). With the wallet broke,
this looked healthy — zero on-chain txs, predicate gating cheaply.

Then the operator funded the wallet with 1.0 POL at 19:11Z 2026-04-26.
Within 13 minutes:

- **82 outbound `redeemPositions` txs** (nonce 351 → 433)
- **3 USDC.e payouts** totaling **$17.13** (Shanghai Haigang, Querétaro,
  one other — all real winners)
- **79 no-op success calls** burning ~0.01 POL each = **~0.79 POL drained**
- Burn rate: **0.06 POL/min sustained** — same as the pre-bug.0383 rate

Loki shows the same conditions firing 3-5x per ~30s window:

```
19:11:02 redeem.ok cid=0x941012... (Shanghai)
19:11:34 redeem.ok cid=0x941012... (Shanghai AGAIN, no payout)
19:11:13 redeem.ok cid=0xeb7627...
19:11:37 redeem.ok cid=0xeb7627... (AGAIN)
19:11:14 redeem.ok cid=0x617893... (Querétaro)
19:11:41 redeem.ok cid=0x617893... (AGAIN)
```

### Root cause

`redeemAllRedeemableResolvedPositions` iterates candidates with
`await redeemResolvedPosition(...)`, which awaits `waitForTransactionReceipt`.
Sequential within one tick. But:

- `mirror-pipeline.ts:163` invokes `redeemSweep()` every ~30s with **no
  concurrency guard**.
- A sweep with N winners takes N × (writeContract + receipt wait) ≈
  5-30s per condition. Even 2 winners can exceed 30s.
- Tick B starts before tick A finishes. Tick B's multicall reads all
  candidates' balances **before** tick A's writes have mined → predicate
  passes for the still-unburned conditions → tick B fires on conditions
  tick A was about to handle.
- Tick A and tick B both end up writing on the same conditionId. Tick B's
  write lands after tick A's burn → no-op success, ~0.01 POL gas, $0
  payout.

The race **always existed** but was masked pre-bug.0383: the wallet was
usually broke, so winners couldn't fire in burst, and the loser-loop
(334/24h) drowned out the winner-race signal. With losers correctly
skipped, the race becomes the dominant remaining waste.

This race went undetected for the 24h after bug.0383 shipped because
**we had no signal for "sweep wall-clock > tick interval"** — the exact
conditions under which ticks overlap. That observability gap is
inherent to the original sweep design.

### Expected

- Sweep tick B blocks if tick A is still in flight (mutex).
- Manual `redeemResolvedPosition` and the autonomous sweep both refuse to
  fire on a conditionId with a pending in-flight redeem (60s cooldown).
- Sweep wall-clock duration is emitted on every completion so the next
  race-class issue is visible in Loki the same hour it appears.
- After the fix: on-chain `redeemPositions` calls per resolved-winning
  condition per process lifetime = 1.

### Reproduction

1. bug.0383 in prod (predicate working).
2. Wallet has at least one resolved-winning condition (`payoutNumerators >
0` AND wallet holds the winning positionId).
3. Refund wallet with ≥0.1 POL so it can fund redemptions.
4. Watch on-chain nonce on the funder. Pre-fix: nonce climbs N times per
   winner before settling. Post-fix: nonce climbs exactly N times where
   N = count of distinct winning conditions, then stops.

### Impact

- **Severity: priority 0.** Production funder bleeds 0.06 POL/min any
  time it has POL to fund redemptions. A single 1 POL refund is fully
  drained in ~16 minutes, with ~95% of the spend on no-op duplicates.
  The legitimate redemption recovery (~$17/refund) is barely net positive
  versus the gas waste (~$0.40/refund), and would go negative if any
  refund were larger.
- Secondary: Alchemy RPC quota churn from the 2N multicall fan-out × N
  overlapping ticks. Unrelated to money but would amplify any future
  RPC-cost incident.

## Design

### Outcome

Three guards, all module-scope, in-process:

1. **Sweep mutex** — `sweepInFlight` boolean wraps
   `redeemAllRedeemableResolvedPositions`. Catches the prod-observed
   inter-tick overlap. Skip event:
   `poly.ctf.redeem.sweep_skip_in_flight`.
2. **Per-condition cooldown** — `Map<conditionId, expiry>`. Set after
   every successful `writeContract`. Both manual route and sweep consult
   it before firing. Catches manual ↔ sweep races and double-clicks on
   the manual endpoint that the mutex doesn't cover. Skip event:
   `poly.ctf.redeem.skip_pending_redeem`.
3. **Sweep wall-clock observability** —
   `poly.ctf.redeem.sweep_completed { duration_ms, redeems }` emitted on
   every successful sweep. Closes the observability gap that hid this
   race for 24h.

### Approach

#### Why mutex AND cooldown (both load-bearing)

| Race                                                                                                                                            | Caught by |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Inter-tick sweep overlap (the prod-observed cause)                                                                                              | Mutex     |
| Cooldown alone for sweep tick B: catches condition A1 (cooldown set), misses A2..AN (cooldown not yet set; tick A still awaiting receipt on A1) | Mutex     |
| Manual route double-click                                                                                                                       | Cooldown  |
| Manual route 5s after sweep redeem on same condition                                                                                            | Cooldown  |

Mutex alone wouldn't protect the manual route. Cooldown alone wouldn't
catch the multi-winner race. Different scenarios, both real.

#### Why 60s cooldown

Polygon block time 2s + probabilistic finality ~3-5 blocks (~10s) +
Alchemy RPC propagation lag (few s) = mined-and-readable end-to-end
~15-30s. **60s is a 2× safety margin** without being so long that a
legitimate retry-after-failure stalls.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] REDEEM_RACE_GUARDS — both mutex and cooldown are present; neither
      is removed without replacing it. The justification table above is
      load-bearing.
- [ ] COOLDOWN_TIED_TO_FINALITY — `REDEEM_COOLDOWN_MS` is documented as
      Polygon-finality + propagation × 2; not a magic number.
- [ ] SWEEP_DURATION_OBSERVABLE — every sweep cycle emits
      `poly.ctf.redeem.sweep_completed` with `duration_ms` and `redeems`.
- [ ] SINGLE_POD_ASSUMPTION — the in-process Map + bool break under
      multi-replica scaling. Documented as a module invariant; deployment
      must stay single-replica until task.0377 lands.
- [ ] NO_KILL_SWITCH_ENV_VAR — speculative config rejected. If the
      predicate misfires, revert+redeploy is the same friction as a
      configmap flip without accumulating a config-permutation matrix.
- [ ] BAND_AID_NOT_CURE — module doc + commit message both call this PR
      a band-aid for task.0377. The polling architecture itself is the
      bug class; this fix buys time, doesn't cure.

### Files

- Modify: `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts`
  — module-scope `redeemCooldownByConditionId` Map + `sweepInFlight`
  bool, `pendingRedeemMsRemaining` / `markRedeemPending` helpers,
  `pending_redeem` added to `RedeemSkipReason`, sweep wrapped with mutex
  - duration emit, cooldown checked in both manual route and sweep loop,
    exported test-reset helpers, loud module-doc invariants.
- Modify: `nodes/poly/app/tests/unit/bootstrap/poly-trade-executor.test.ts`
  — `_resetRedeemCooldownForTests` + `_resetSweepMutexForTests` in
  `beforeEach`; new `bug.0384` describe block with 4 race regression
  cases.

## Validation

```yaml
exercise: |
  # On candidate-a after flight, against funder 0x95e4…5134:
  # 1. Refund 0.05 POL (enough for 2-3 winner redeems).
  # 2. Wait one mirror tick.
  # 3. Watch on-chain nonce delta over 90s. Expect: nonce climbs by exactly
  #    N (one per distinct winning condition), then settles. Pre-fix:
  #    climbed indefinitely.
  # 4. POL balance delta over 5 min ≤ N × 0.012 POL (per-redeem gas budget).

observability: |
  # Loki, env=candidate-a, service=app:
  # 1. event="poly.ctf.redeem.sweep_completed" — every sweep, duration_ms < 30000 ideal
  # 2. event="poly.ctf.redeem.skip_pending_redeem" ≥1 within ~60s of any redeem.ok
  # 3. event="poly.ctf.redeem.sweep_skip_in_flight" — should be rare; if frequent,
  #    sweep wall-clock > tick interval and we have a perf issue (early signal)
  # 4. nonce delta on funder over 5 min ≤ count of distinct winning conditions

smoke_cmd: |
  pnpm -C nodes/poly/app exec vitest run poly-trade-executor poly-ctf-redeem-decision
```

## Follow-up plan — task.0377 is the real fix

This PR is a band-aid. The root bug class is **polling chain state for
idempotency** — every tick has to re-discover what's already been
redeemed. Three structural problems remain even with bug.0384:

1. RPC-quota churn from the 2N multicall fan-out × every tick (Alchemy
   429 throttling already observed at 2,013/30m before the fix).
2. Single-pod constraint hard-locks horizontal scaling.
3. The race window is shrunk, not eliminated — a future bug in either
   guard reintroduces it.

The real fix is **task.0377 (event-driven sweep via CTF
`ConditionResolution` + own `PayoutRedemption` events)**:

- Subscribe to CTF on-chain events via WebSocket (Alchemy + viem
  `watchContractEvent`).
- On `ConditionResolution(conditionId)` for a condition we hold,
  enqueue exactly ONE redeem job, idempotent by `conditionId`.
- Persist redemption-attempted state to DB (poly_copy_trade_redemptions
  table or equivalent) — survives restart, survives multi-pod.
- Drop the polling sweep entirely. No mutex needed. No cooldown
  needed. No race possible by construction.

Plan immediately following bug.0384's merge:

1. **Bootstrap a fresh worktree off main**: `bug/0384-sweep-race` dies;
   new branch `task/0377-event-driven-sweep`.
2. **`/design` task.0377** — the existing item is at `needs_triage`
   with one paragraph; promote it to a real design with the event
   subscription topology, idempotency table schema, restart semantics,
   and a kill-switch path back to bug.0384's polling guards if the
   event subscription drops.
3. **`/implement`** — viem `watchContractEvent` adapter + per-condition
   redemption-attempt DB table + new graph step that consumes the event
   queue + retire the sweep tick.
4. **Validate against the same fixture matrix** bug.0383 introduced
   (`tests/fixtures/poly-ctf-redeem/`) — predicate behavior must stay
   identical.

bug.0384 stays in production until task.0377 ships and passes
`deploy_verified: true`. After that, bug.0384's mutex + cooldown can be
deleted as dead code.
