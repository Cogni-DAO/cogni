---
id: bug.0373
type: bug
title: poly CTF redeem sweep burns POL on a runaway loop, re-redeeming already-redeemed positions
status: needs_triage
priority: 0
rank: 1
estimate: 2
summary: Mirror-pipeline CTF redeem sweep keeps re-submitting `redeemPositions` for the same condition_ids every ~30s; trading wallet drained 0.425 POL in 20 minutes (00:47–01:07 UTC 2026-04-25) and is now at 0.0029 POL.
outcome: Sweep dedups against actual on-chain redemption state (or a short-lived in-process guard) and stops re-submitting no-op redemptions. POL drain on `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134` returns to zero outside legitimate, one-shot redemptions.
spec_refs:
assignees: []
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-25
updated: 2026-04-25
labels: [poly, copy-trade, gas, incident]
external_refs:
---

# poly CTF redeem sweep burns POL on a runaway loop

## Requirements

### Observed

The CTF redeem sweep on the prod poly node is hot-looping `redeemPositions`
against the same condition_ids every ~30 seconds, draining native POL gas from
the operator trading wallet `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134`.

**On-chain evidence (Polygon, Blockscout, last 20 min sample):**

- 50 successful `redeemPositions` txs to CTF `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`
  between `2026-04-25T00:47:30Z` and `2026-04-25T01:07:34Z`.
- Total fee burned: **0.425 POL** in 20 min (~$0.040 at ~$0.093/POL).
- Avg fee: 0.0085 POL/tx. Rate: ~2.5 tx/min → projected **~30 POL/day** drain.
- Two distinct `gas_used` values alternate in pairs: `65230` and `72659` —
  consistent with the same two condition_ids being re-submitted every tick.
- All txs `status: ok`, `value: 0`. Polygon `eth_getBalance` now returns
  `0xa49d78abbb4fe` = 0.002896 POL.
- Sample tx: `0x4765f49bc03af618ee8f99d912522b3e5cd414363fb0f31ddeb7689167f617b4`.

**Loki evidence (`{env="production",pod=~"poly-node-app-.*"}`, same window):**

- 18× `poly.ctf.redeem.sweep_skip` for a different condition_id
  (`0x2f76…aeb9`) — fails at `eth_estimateGas` with `Missing or invalid parameters`.
  Estimation reverts on the node, no tx submitted, no gas burned. Noisy but
  not the source of the drain.
- The successful drain txs above are NOT logged as `poly.ctf.redeem.ok` in
  the same window — i.e. the sweep is firing successful txs without the
  expected info-level event, OR the event is being emitted but at a different
  pod than `poly-node-app-db778595-dmf2b`.

**Code pointers:**

- Sweep entrypoint: `nodes/poly/app/src/bootstrap/container.ts:831` —
  `redeemSweep` calls `executor.redeemAllRedeemableResolvedPositions()` on
  every mirror-pipeline tick.
- Sweep loop: `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts:657-691`
  (`redeemAllRedeemableResolvedPositions`). It iterates `dataApiClient.listUserPositions(funderAddress)`,
  filters by `p.redeemable`, and dedupes by normalized `conditionId` **only
  within a single sweep call** (the `seen` Set is local to the function).
- Per-condition redeem: `redeemResolvedPosition` at `poly-trade-executor.ts:580-655`
  — calls `walletClient.writeContract({ functionName: "redeemPositions", … })`
  unconditionally as long as `p.redeemable === true` from the data-api.
- Tick driver: `nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts:163-175`
  — `redeemSweep` runs at the end of every mirror tick (no rate-limit, no
  cooldown, no “already attempted within last N seconds” guard).

**Root cause hypothesis:** Polymarket Data-API keeps returning `redeemable: true`
for positions that the node has already submitted a `redeemPositions` tx for,
either because (a) Data-API state lags on-chain settlement, or (b) the
position is genuinely still redeemable on-chain (CTF `redeemPositions` is a
no-op-success when the payout balance is 0 — it doesn’t revert). With no
in-process dedup across ticks, every mirror-pipeline tick re-submits the same
two condition_ids, paying ~0.017 POL/tick forever.

### Expected

- The sweep submits `redeemPositions` **at most once per condition_id** until
  the data-api stops reporting it as `redeemable` OR a cooldown elapses.
- A failed `eth_estimateGas` (case 1, the sweep_skip path) does not retry
  every tick — same condition_id should be backed off.
- A successful redemption that is actually a no-op on-chain (zero payout
  transfer in the tx receipt) should be detected and the condition_id
  marked “do not retry” for a sane window.
- POL gas spend on the operator trading wallet trends to ~0 outside genuine
  one-time redemptions.

### Reproduction

1. Deploy poly node with mirror pipeline enabled (`PRIVY_USER_WALLETS_*` +
   `POLY_WALLET_AEAD_*` configured) so `redeemSweep` is wired in
   `container.ts:831`.
2. Have at least one position on the operator funder wallet that the
   Polymarket Data-API reports as `redeemable: true` (resolved market that
   was already redeemed, or zero-payout redeem).
3. Watch the wallet on Polygonscan: `redeemPositions` will fire every
   mirror tick (~30s) indefinitely, each consuming ~0.008 POL.

Code path: `mirror-pipeline.ts:163` → `container.ts:831` →
`poly-trade-executor.ts:657` (`redeemAllRedeemableResolvedPositions`) →
`poly-trade-executor.ts:614` (`walletClient.writeContract` redeemPositions).

### Impact

- **Severity: priority 0.** Direct, unbounded loss of operator funds on the
  shared trading wallet. ~30 POL/day at current cadence; wallet is already
  empty (0.0029 POL) and any top-up will be drained within hours unless the
  sweep is disabled or fixed.
- Secondary: noisy `poly.ctf.redeem.sweep_skip` warns flood Loki, masking
  real errors.
- Tertiary: every mirror-pipeline tick is artificially slow because it
  serializes a real on-chain `writeContract` + `waitForTransactionReceipt`
  per redeemable condition_id.

## Allowed Changes

- `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts`
  (`redeemAllRedeemableResolvedPositions` + `redeemResolvedPosition` — add
  cross-tick dedup / cooldown / no-op detection).
- `nodes/poly/app/src/bootstrap/container.ts` (wiring of `redeemSweep` if a
  cooldown store needs to be injected).
- `nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts` (only if the
  rate-limit lives at the tick boundary).
- Tests under `nodes/poly/app/tests/unit/features/copy-trade/` and
  `packages/market-provider/tests/` that cover the sweep path.

## Plan

- [ ] **Stop the bleed first.** Land a kill-switch env flag
      (`POLY_CTF_REDEEM_SWEEP_ENABLED=false` default-off in prod) so we can
      disable the sweep via config without redeploy churn while the real fix
      is in flight.
- [ ] Add an in-process cooldown map keyed by normalized condition_id
      (`Map<string, { last_attempt_ms, last_outcome }>`) inside
      `redeemAllRedeemableResolvedPositions` (or a small store on the
      executor instance). On each sweep, skip any condition_id attempted
      within the last N minutes regardless of outcome. N starts at 10 min.
- [ ] After a successful tx, parse the receipt for the USDC.e `Transfer`
      event amount. If 0, log `poly.ctf.redeem.no_payout` and extend the
      cooldown to a much longer window (24h+) — this is the "already
      redeemed, Data-API lying" case.
- [ ] On `eth_estimateGas` failure path (already lands as `sweep_skip`),
      apply the same cooldown so the noisy condition_id stops retrying every
      tick.
- [ ] Unit tests: - sweep called twice in a row only submits once per condition_id; - no-payout receipt extends cooldown beyond a normal failed attempt; - kill-switch flag short-circuits the sweep entirely.
- [ ] Add a one-time bounded retry escape hatch (operator API or admin
      endpoint) to force-redeem a specific condition_id, since cooldown will
      otherwise block legitimate redemption retries for the cooldown window.
- [ ] Top up the operator wallet only AFTER fix is flighted to candidate-a
      and the sample tx rate has dropped to zero on the live wallet.

## Validation

**Command:**

```bash
pnpm --filter @cogni/poly-node-app test:unit -- redeem-sweep
```

**Expected:** New tests pass; existing mirror-pipeline tests still green.

**Post-flight on candidate-a (the gate that actually matters):**

```bash
# 1. Confirm sweep enabled in candidate-a config (or kill-switch flipped).
# 2. Watch the operator wallet for 1 hour:
curl -s -X POST https://1rpc.io/matic \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134","latest"]}'
# 3. Read tx history; expect 0 new redeemPositions txs in the hour, OR at
#    most 1 per genuinely-redeemable condition_id.
# 4. Loki: zero `poly.ctf.redeem.sweep_skip` repeats for the same
#    condition_id within the cooldown window.
```

**Expected:** Wallet balance does not decrease over a 1-hour idle window;
`redeemPositions` cadence drops from 150/hr to ≤1/hr per condition_id.

## Review Checklist

- [ ] **Work Item:** `bug.0373` linked in PR body
- [ ] **Spec:** mirror-pipeline + poly-trade-executor invariants upheld; no
      regression to existing redeem flow on truly-unredeemed positions
- [ ] **Tests:** new unit tests for cooldown + no-payout + kill-switch
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Sample drain tx (Polygonscan): https://polygonscan.com/tx/0x4765f49bc03af618ee8f99d912522b3e5cd414363fb0f31ddeb7689167f617b4
- Operator trading wallet: https://polygonscan.com/address/0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134
- Pod: `poly-node-app-db778595-dmf2b` (cogni-production)

## Attribution

- Reported by: derek (`/logs prod` → `/bug`)
