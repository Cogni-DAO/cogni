---
id: bug.0383
type: bug
title: poly CTF redeem sweep loops on losing-outcome ERC1155 — bug.0376 fix-of-fix
status: needs_implement
priority: 0
rank: 1
estimate: 2
branch: bug/0376-redeem-still-reverts
summary: bug.0376's "ERC1155 balance > 0" predicate also fires for losing-outcome tokens. `redeemPositions(indexSets=[1,2])` on losers succeeds with payout=0, doesn't burn, balance stays > 0, sweep loops every tick. 334 of 339 redeem txs in 24h on `0x95e4…5134` were no-ops; ~1.9 POL drained.
outcome: Redeem sweep only fires `redeemPositions` when the funder's held position is the *winning* outcome (`payoutNumerators(conditionId, outcomeIndex) > 0`). On-chain POL spend on `0x95e4…5134` traces 1:1 to USDC.e payouts.
spec_refs:
assignees: []
credit:
project: proj.poly-web3-security-hardening
pr:
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-04-25
updated: 2026-04-25
labels: [poly, gas, web3, incident, redeem]
external_refs:
---

# poly CTF redeem sweep loops on losing-outcome ERC1155 — bug.0376 fix-of-fix

## Requirements

### Observed

After bug.0376's fix (`ab0fc108e`, deployed prod 2026-04-25 09:08 UTC), the
sweep now correctly uses chain truth (`balanceOf > 0`) as the predicate. But
the predicate fires for **every outcome token the funder holds**, including
the losing side of resolved markets. `redeemPositions` on a losing position
succeeds with payout=0 and burns nothing — so the wallet's ERC1155 balance for
that positionId is unchanged and the next sweep tick re-fires the same call
forever.

**On-chain evidence (Polygon, wallet `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134`, last 24h):**

- 339 outbound `redeemPositions` txs (nonce 12 → 351).
- Net POL spend ~1.902 POL (bal 0.904 + 1.0 MATIC inbound − 0.001 now).
- Inbound USDC.e from CTF `0x4d97…6045`: 5 transfers, 27.14 USDC total.
- 5 of 339 redeems paid out; **334 (98.5%) were no-op success calls.**
- Avg gas per no-op: 72,659. Avg gas per paying: 109,528.

**Receipt diff (smoking gun):**

- No-op tx `0x00f15e1268dc0ce2c1681df7a668e692e7d8cdc6b87fcf15901a304d85aecd67`:
  status=success, gasUsed=72,659, **2 logs**: `PayoutRedemption(payout=0)` from
  CTF + Polygon gas-burn. **No ERC1155 TransferSingle. No USDC Transfer.** The
  funder's position-token balance is unchanged after the call.
- Paying tx `0x6af03644d5d206acee7ace9c0ccfa5c59a267efa9e8c9a27228bfaa77d813f3b`:
  status=success, gasUsed=109,528, 4 logs: ERC1155 TransferSingle (winning
  tokens burned) + USDC Transfer (7.14 paid) + PayoutRedemption + gas-burn.
  Balance for that positionId goes to 0; not picked up next sweep ✓.

**Loki evidence:**

- 14,555 `poly.ctf.redeem.error` events post-promo over ~8.5h, all of form
  `"no redeemable position for conditionId=…"` — these are cheap (no RPC),
  but they correspond to the same condition-ids the sweep fires `balanceOf > 0`
  on and then trips the inner Data-API guard. Symptom of the same root cause.
- 111 `poly.ctf.redeem.ok` events post-promo == on-chain nonce delta exactly.
  All 111 burned gas; all but ~1 returned 0 USDC.

**Code pointers:**

- Sweep: `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts:670-770`
  (`redeemAllRedeemableResolvedPositions`). After bug.0376, predicate is
  `multicall.balanceOf(funder, positionId) > 0`. No outcome-side check.
- Per-condition write: same file `:580-665` (`redeemResolvedPosition`) calls
  `walletClient.writeContract({ functionName: "redeemPositions", args: [USDC, 0x0, conditionId, [1n, 2n]] })`.
  Index sets `[1, 2]` mean "redeem both YES and NO"; CTF returns 0 for the side
  we don't hold AND for the side that lost.
- ABI: `packages/market-provider/src/adapters/polymarket/polymarket.ctf.ts` —
  exposes `balanceOf` and `redeemPositions` only. Missing `payoutNumerators`.
- Position type: `packages/market-provider/src/adapters/polymarket/polymarket.data-api.types.ts:68-115`
  has `asset` (positionId), `conditionId`, and `outcomeIndex` (0/1 for binary).

**Root cause:** The chain-truth predicate from bug.0376 is correct in spirit
but uses the wrong variable. Holding ERC1155 balance for _some_ outcome
doesn't mean we hold a _winning_ outcome. CTF's `redeemPositions` is
intentionally idempotent on losers — it pays 0, burns nothing, returns
success. The predicate must additionally consult
`payoutNumerators(conditionId, outcomeIndex)`.

### Expected

- For each (`conditionId`, `outcomeIndex`, `positionId`) the funder holds:
  fire `redeemPositions` only when **both** `balanceOf(funder, positionId) > 0`
  **and** `payoutNumerators(conditionId, outcomeIndex) > 0`.
- Losing-outcome positions log `poly.ctf.redeem.skip_losing_outcome` (info)
  and never hit chain.
- Unresolved markets (denominator == 0) are already excluded by data-api's
  `position.redeemable` filter on the upstream side; if they slip through, our
  `payoutNumerators == 0` check skips them too.
- After this fix: every `poly.ctf.redeem.ok` corresponds to a non-zero USDC
  inbound to the funder. POL gas burn ≤ 1 paying-redeem worth per resolved
  winning position, ever.

### Reproduction

1. Funder wallet holds ERC1155 balance for the _losing_ outcome of a resolved
   binary market (any of the 100s of positionIds currently held by
   `0x95e4…5134`).
2. Mirror tick runs `redeemSweep`.
3. Current code: `balanceOf > 0` ⇒ submits `redeemPositions(USDC, 0x0, c, [1, 2])`.
4. Tx confirms, payout=0, ERC1155 not burned, ~73k gas spent.
5. Next tick (≤30s later): same balance, same submit, same waste. Forever.

### Impact

- **Severity: priority 0.** Direct, unbounded loss of operator funds. Current
  burn rate ≈ 1 POL per refill cycle (1 POL drained in ~20 min after the 09:14
  refill). The wallet auto-empties any top-up within an hour as long as it
  holds _any_ losing-outcome position from prior copy-trade or mirror activity.
- Secondary: 14k+/day `poly.ctf.redeem.error` log spam in Loki masks real
  errors.
- Tertiary: every mirror-pipeline tick is artificially slow (sequential on-chain
  writes per held position).

## Design

### Outcome

The poly node's redeem sweep AND the manual `/api/v1/poly/wallet/positions/redeem`
route stop paying gas on no-op `redeemPositions` calls. After this ships,
on-chain POL spend on the operator funder traces 1:1 to USDC.e inbound
payouts within the same tx, for both vanilla CTF and neg-risk positions.
Predicate is verified end-to-end against the full position matrix held by
the production funder via captured fixtures (see Test Fixtures).

### Approach

**One shared on-chain precheck, called by both the autonomous sweep and the
manual redeem route.** Predicate: `balanceOf(funder, positionId) > 0` AND
`payoutNumerators(conditionId, outcomeIndex) > 0`. Extends the existing
multicall with one ABI fragment; no new ports, no new infra.

Verified against real Data-API + on-chain reads on
`0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134` (16 held positions; see
"On-chain validation of the predicate" below).

#### Shared precheck (closes the bug class on both paths)

Add a private helper inside `poly-trade-executor.ts`:

```ts
async function assertOnChainRedeemable(
  conditionId: `0x${string}`,
  outcomeIndex: number,
  positionId: bigint
): Promise<{
  ok: boolean;
  reason?:
    | "zero_balance"
    | "losing_outcome"
    | "missing_outcome_index"
    | "read_failed";
}>;
```

- Invoked by `redeemResolvedPosition` (manual route) BEFORE
  `walletClient.writeContract`. If `!ok`, throw
  `PolyTradeExecutorError("not_redeemable", reason)` — no chain write, no gas.
- Invoked by `redeemAllRedeemableResolvedPositions` (autonomous sweep) per
  candidate. If `!ok`, log structured skip and continue.

#### Sweep changes (`redeemAllRedeemableResolvedPositions`, file `:667+`)

1. Carry `outcomeIndex` from each `Position` into the candidate tuple
   alongside `conditionId` + `asset`. The field exists on the Data-API
   `Position` zod type (`polymarket.data-api.types.ts:78,115`).
2. Existing multicall: N × `balanceOf` + N × `payoutNumerators(conditionId, outcomeIndex)`.
   Same `publicClient.multicall({ allowFailure: true })` shape, doubles the
   call count but stays in one RPC round-trip. Predicate works for both
   vanilla CTF and neg-risk markets — verified against the captured
   fixture; see Test Fixtures.
3. Per candidate, skip with structured log if:
   - `balanceOf == 0` → existing `poly.ctf.redeem.skip_zero_balance` (kept).
   - `payoutNumerators == 0` → new `poly.ctf.redeem.skip_losing_outcome`
     (info-level, fields: `condition_id`, `asset`, `outcome_index`, `funder`).
   - either read failed → existing `poly.ctf.redeem.balance_read_failed`-shape
     warn (rename to `read_failed`; reason field covers both reads).
4. Only when both checks pass, invoke `redeemResolvedPosition`.

#### Manual route changes

`redeemResolvedPosition` (`:585+`) gets the same precheck applied to its
single (`condition_id` → looked-up Position). If precheck fails, throw
`not_redeemable` with the specific reason; the route at
`app/api/v1/poly/wallet/positions/redeem/route.ts:91` already maps that to
a 400-ish response — no route changes needed.

#### Outcome-index hardening

`Position.outcomeIndex` zod schema currently defaults to 0 silently
(`z.coerce.number().optional().default(0)`). Tighten to fail loud: drop
`.default(0)`, keep `.optional()` so we can detect missing values, and reject
in the helper if `outcomeIndex == null`. Logged as
`poly.ctf.redeem.skip_missing_outcome_index` (warn). Touch in
`packages/market-provider/src/adapters/polymarket/polymarket.data-api.types.ts:78,115`.

#### Kill switch

Add `POLY_REDEEM_SWEEP_ENABLED` env var (default `true`); when `false`,
`redeemSweep` in `mirror-pipeline.ts` is a no-op. Wired through
`serverEnv()`. Lets us kill the loop via configmap without revert+redeploy
if the new predicate misfires. Manual route is unaffected (kill switch only
affects the autonomous sweep — manual close still works).

#### Test Fixtures (real Polymarket + Polygon mainnet data)

Captured 2026-04-25 at Polygon block `86010953` against funder
`0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134` (the production trader). Three
files in `nodes/poly/app/tests/fixtures/poly-ctf-redeem/`:

- `positions.data-api.snapshot-2026-04-25.json` — raw Data-API response
  (16 positions; 11 neg-risk, 5 vanilla; 11 redeemable, 5 not).
- `ctf-reads.snapshot-2026-04-25.json` — per-position on-chain reads at the
  pinned block: `payoutNumerators(cid, heldIdx)`, `payoutNumerators(cid, otherIdx)`,
  `payoutDenominator(cid)`, `getOutcomeSlotCount(cid)`,
  `balanceOf(funder, heldAsset)`, `balanceOf(funder, oppositeAsset)`.
- `expected-decisions.snapshot-2026-04-25.json` — golden decision table:
  for each position, the `assertOnChainRedeemable` output the predicate
  MUST produce (`{action: redeem|skip, skipReason}`).
- `snapshot.sh` — re-runner. Re-snapshot when adding scenarios; pin a new
  block, write a new dated file, don't mutate old ones.
- `README.md` — what each file is, predicate covered, scenarios covered
  vs. synthesized, refresh procedure.

**Predicate verdict on the captured matrix (16 positions):**

| Bucket                         | Count | Predicate decision                       | Correct? |
| ------------------------------ | ----: | ---------------------------------------- | -------- |
| Vanilla, resolved-loser        |     3 | `skip:losing_outcome`                    | ✅       |
| Vanilla, unresolved (denom=0)  |     2 | `skip:losing_outcome` (numerator==0 too) | ✅       |
| Neg-risk, resolved-loser       |     6 | `skip:losing_outcome`                    | ✅       |
| Neg-risk, unresolved (denom=0) |     3 | `skip:losing_outcome`                    | ✅       |
| **Neg-risk, resolved-WINNER**  | **2** | **`redeem`**                             | **✅**   |

The two winners (Shanghai Haigang `+$4.83`, Querétaro `+$3.39`) are both
neg-risk, both correctly identified by the predicate. The naive predicate
covers vanilla AND neg-risk on this funder — earlier hypothesis that
neg-risk needed special handling was based on testing the wrong conditionId
(see git history of this file).

These fixtures are the canonical e2e ground truth. Unit tests load
`expected-decisions.snapshot-*.json` and assert that
`assertOnChainRedeemable` reproduces every row exactly. No test mocks the
Polymarket schema, the CTF ABI, or the predicate decisions — they all come
from real data.

**Reuses:**

- `publicClient.multicall` with `allowFailure: true` (already used).
- `polymarketCtfRedeemAbi` ABI module — append one fragment:
  `function payoutNumerators(bytes32 conditionId, uint256 outcomeIndex) view returns (uint256)`.
- `Position.outcomeIndex` (already in the validated zod type).
- Existing `poly.ctf.redeem.skip_*` logger event family.
- bug.0376's `CHAIN_TRUTH_SOURCE` principle — this fix strengthens it.

**Rejected alternatives:**

- **Receipt-parse cooldown** (inspect prior tx for ERC1155 burn / USDC
  Transfer; cache `condition_id → no-op`): requires either in-process Set
  (lost on restart, leaks one wasted redeem per stuck condition per
  pod-start) or persistent Redis cache (new infra, new invalidation rules,
  new failure modes). Doesn't fix the underlying "we asked the wrong
  question" problem.
- **Vanilla-only carve-out (skip all neg-risk)**: initial design hypothesis
  rejected after fixture validation showed predicate works for both. Would
  forgo ~$8 of legitimate neg-risk winnings on this funder for no benefit.
- **Disable redeem sweep entirely**: stops bleed but loses real winning
  redemptions and breaks the autonomous exit-path UX. Use the kill switch
  in this PR as the operational backstop, not the default.
- **Per-tick in-memory blacklist**: doesn't survive restart, still wastes
  one redeem per condition per pod uptime, doesn't address root cause.
- **Filter at Data-API layer (`Position.redeemable`)**: precisely the trap
  bug.0376 was filed to escape.
- **Sweep-only fix without manual-route precheck**: doesn't fix the manual
  route bug class (design-review issue #1).

### Out of Scope (explicit follow-up)

- **task.0384 — losing-outcome ERC1155 dust cleanup**: positions that
  trip `skip_losing_outcome` accumulate forever on the funder. Decide
  whether to `safeTransferFrom` them to `0xdead`, leave them, or sell
  via CLOB. Not gas-burning anymore after this fix, just clutter.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] WINNING_OUTCOME_PRECHECK: Both manual `redeemResolvedPosition` and
      autonomous sweep submit `redeemPositions` only when
      `payoutNumerators(conditionId, outcomeIndex) > 0` AND
      `balanceOf(funder, positionId) > 0`. (spec: proj.poly-web3-security-hardening)
- [ ] SHARED_PRECHECK_BOTH_PATHS: The on-chain precheck is implemented as
      one helper called by both code paths; no path can skip it. (closes
      design-review issue #1)
- [ ] FIXTURE_PARITY: The unit test loads `expected-decisions.snapshot-*.json`
      and asserts predicate output matches every row. No mocked decisions.
- [ ] CHAIN_TRUTH_SOURCE: Predicate inputs come from CTF view calls
      (`balanceOf` + `payoutNumerators`), not from Data-API state flags.
      (retained from bug.0376)
- [ ] BINARY_INDEX_SETS_WRITE_ONLY: `[1, 2]` index-set assumption stays
      scoped to the `redeemPositions` write call. (existing
      `polymarket.ctf.ts` invariant)
- [ ] OUTCOME_INDEX_FAIL_LOUD: Missing `Position.outcomeIndex` rejects
      with `skip_missing_outcome_index` instead of silently defaulting to 0.
- [ ] KILL_SWITCH_PRESENT: `POLY_REDEEM_SWEEP_ENABLED=false` makes
      `redeemSweep` a no-op without code redeploy.
- [ ] SIMPLE_SOLUTION: One ABI fragment, one helper, one env var. No new
      ports, packages, or infrastructure.
- [ ] ARCHITECTURE_ALIGNMENT: All chain reads flow through the
      `polymarket.ctf.ts` ABI module; sweep wiring stays in
      `bootstrap/capabilities/poly-trade-executor.ts`.

### Files

<!-- High-level scope -->

- Modify: `packages/market-provider/src/adapters/polymarket/polymarket.ctf.ts`
  — append one ABI fragment for
  `payoutNumerators(bytes32, uint256) view returns (uint256)` to
  `polymarketCtfRedeemAbi`. Update module-doc invariants list.
- Modify: `packages/market-provider/src/adapters/polymarket/polymarket.data-api.types.ts`
  — drop silent `.default(0)` on `outcomeIndex`; allow `null`/missing,
  detected by caller.
- Modify: `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts`
  — add `assertOnChainRedeemable` helper; call from both
  `redeemResolvedPosition` (manual route) and
  `redeemAllRedeemableResolvedPositions` (autonomous sweep); new skip
  events; predicate covers vanilla + neg-risk uniformly.
- Modify: `nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts`
  (`:163-175`) — wrap `redeemSweep` invocation in
  `if (env.POLY_REDEEM_SWEEP_ENABLED)`.
- Modify: `nodes/poly/app/src/lib/server-env.ts` (or wherever `serverEnv()`
  lives) — add `POLY_REDEEM_SWEEP_ENABLED` boolean, default `true`.
- Create: `nodes/poly/app/tests/fixtures/poly-ctf-redeem/positions.data-api.snapshot-2026-04-25.json`
  — already captured.
- Create: `nodes/poly/app/tests/fixtures/poly-ctf-redeem/ctf-reads.snapshot-2026-04-25.json`
  — already captured.
- Create: `nodes/poly/app/tests/fixtures/poly-ctf-redeem/expected-decisions.snapshot-2026-04-25.json`
  — already captured.
- Create: `nodes/poly/app/tests/fixtures/poly-ctf-redeem/snapshot.sh` +
  `README.md` — already captured.
- Test: `nodes/poly/app/tests/unit/bootstrap/poly-trade-executor.test.ts`
  — drive `assertOnChainRedeemable` from
  `expected-decisions.snapshot-2026-04-25.json`. For each `case`: feed
  `case.inputs` to a mocked multicall and assert the helper returns
  `{ok, reason}` exactly matching `case.expected`. Plus synthetic cases
  the snapshot doesn't cover:
  (a) `read_failed` (mock multicall returns `status: failure`);
  (b) `missing_outcome_index` (set `outcomeIndex: null` on a fixture row);
  (c) full `redeemAllRedeemableResolvedPositions` walk over all 16 cases
  → exactly 2 `writeContract` calls (the 2 winners), 14 skips.
  (d) manual `redeemResolvedPosition` on a losing fixture row → throws
  `not_redeemable / losing_outcome`, no `writeContract`.
- Test: `packages/market-provider/tests/polymarket-ctf.test.ts` — assert
  the new ABI fragment parses with the correct signature.
- Create: `work/items/task.0384.poly-losing-outcome-erc1155-cleanup.md` —
  follow-up for accumulated dust (out of scope).

## Validation

```yaml
exercise: |
  # Real interaction on candidate-a after flight, against funder 0x95e4…5134.
  # 1. Establish baseline:
  RPC=$POLYGON_RPC_URL
  ADDR=0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134
  NONCE_BEFORE=$(curl -s -X POST $RPC -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getTransactionCount\",\"id\":1,\"params\":[\"$ADDR\",\"latest\"]}" \
    | jq -r .result)
  # 2. Trigger one mirror tick (or wait ~30s for the natural one).
  # 3. Wait 60s.
  # 4. Assert: on-chain nonce delta == 0 OR == count of poly.ctf.redeem.ok in the same window.
  # 5. POL balance delta on the funder over the next 5 minutes <= 0.001 POL.
  # Manual route exercise:
  #   POST https://test.cognidao.org/api/v1/poly/wallet/positions/redeem
  #   body: {"condition_id":"0x6e9cf6f11f6fcd7843d714fb25dce8d8f7554d22589701f405ee26fe981b6a3d"}
  #   assert: response.status == 400, body.error == "not_redeemable"

observability: |
  # Loki, env=candidate-a, service=app:
  # 1. event="poly.ctf.redeem.skip_losing_outcome" : ≥ 1 entry within first sweep tick.
  # 2. event="poly.ctf.redeem.ok" count over 1h ≤ count of USDC.e inbound transfers
  #    (alchemy_getAssetTransfers, contract 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174,
  #    from 0x4D97DCd97eC945f40cF65F87097ACe5EA0476045) in the same 1h window.
  # 3. On-chain: eth_getTransactionCount delta over 1h on funder ≤ count of
  #    poly.ctf.redeem.ok events (no surprise on-chain redemptions).

smoke_cmd: |
  pnpm -C nodes/poly/app test -- poly-trade-executor.test.ts
  pnpm -C packages/market-provider test -- polymarket-ctf.test.ts
```
