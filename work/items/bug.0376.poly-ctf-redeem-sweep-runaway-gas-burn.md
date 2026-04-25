---
id: bug.0376
type: bug
title: poly CTF redeem sweep burns POL on a runaway loop, re-redeeming already-redeemed positions
status: needs_merge
priority: 0
rank: 1
estimate: 2
branch: fix/bug-poly-redeem-sweep-gas-drain
summary: Mirror-pipeline CTF redeem sweep keeps re-submitting `redeemPositions` for the same condition_ids every ~30s; trading wallet drained 0.425 POL in 20 minutes (00:47–01:07 UTC 2026-04-25) and is now at 0.0029 POL.
outcome: Sweep dedups against actual on-chain redemption state (or a short-lived in-process guard) and stops re-submitting no-op redemptions. POL drain on `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134` returns to zero outside legitimate, one-shot redemptions.
spec_refs:
assignees: []
credit:
project: proj.poly-web3-security-hardening
pr: https://github.com/Cogni-DAO/node-template/pull/1051
reviewer:
revision: 1
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

## Design

### Outcome

The poly node stops burning POL gas on no-op `redeemPositions` calls. After the
fix, `0x95e4…5134`'s POL balance does not decrease while the mirror pipeline is
running unless a position is genuinely redeemable on-chain (non-zero CTF
ERC1155 balance for the position token).

### Approach

**Invert the predicate: ERC1155 balance is the trigger, not a guard. Drop the
Data-API `redeemable` flag from the predicate entirely.** The chain is the
truth source; the Data-API positions list is just the _enumeration source_
(which token ids to check). This deletes the entire class of "Data-API said yes
when chain said no" bug, not just this instance.

Concretely, in `redeemAllRedeemableResolvedPositions`
(`nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts:657`):

1. Drop the `if (!p.redeemable …) continue` filter.
2. Build the list of candidate `(conditionId, asset)` pairs from
   `dataApiClient.listUserPositions(funderAddress)`. `Position.asset` is the
   ERC1155 token id (decimal string per
   `packages/market-provider/src/adapters/polymarket/polymarket.data-api.types.ts:68`)
   — that _is_ the positionId; no `getCollectionId` / `getPositionId` derivation needed.
3. Issue a single `publicClient.multicall` of `balanceOf(funder, BigInt(p.asset))`
   against `POLYGON_CONDITIONAL_TOKENS` for every candidate.
4. For positions where balance > 0, call `redeemResolvedPosition`. For balance
   = 0, log `poly.ctf.redeem.skip_zero_balance` (info-level, structured:
   `condition_id`, `asset`, `funder`) and skip.
5. Inside `redeemResolvedPosition`
   (`poly-trade-executor.ts:580`), keep the call shape unchanged — the precheck
   lives in the sweep, not in the per-condition write path, so direct
   `redeemResolvedPosition({ condition_id })` callers still work as today.

ABI surface: add ONE fragment to the existing CTF ABI module — `balanceOf(address, uint256) view returns (uint256)`.
Rename `polymarket.ctf.redeem.ts` → `polymarket.ctf.ts` and broaden the
module `Purpose` from "redeemPositions calldata" to "Polygon CTF read+write
surface used by the poly node". Sibling-module split is unnecessary: the CTF
contract is one address, this is one tiny adapter file.

**Reuses:**

- viem `publicClient.multicall` — already constructed once in
  `poly-trade-executor.ts:320` and shared via `SHARED_PUBLIC_CLIENT`.
- The `PolymarketUserPosition.asset` field already returned by the Data-API
  positions endpoint. No new fields, no schema migration.
- The existing `polymarketCtfRedeemAbi` (after rename) — one ABI artifact,
  same contract address.

**Known acceptable limitation: in-flight double-fire window.** Tick at t=0
fires `redeemPositions`; tx confirms in ~2s on Polygon. If a tick happens to
fall in that 2s window, `balanceOf` still returns >0, and a second tx fires.
Worst case: one extra successful redeem (cost ~0.0085 POL), and the second
call is a no-op-success because the first already burned the ERC1155 balance.
**Bounded by 1 extra tx per redemption, not unbounded** — this is the bug we
are fixing, just expressed as the residual O(1) tail. Not blocking. If/when
the sweep is moved to be reactive (see follow-up below), the window closes
entirely. A single-flight in-process lock keyed by `conditionId` would also
close it cheaply, but is deferred until we observe the residual matter.

### Rejected alternatives

- **Env kill switch (`POLY_CTF_REDEEM_SWEEP_ENABLED`).** Rejected: v0
  single-tenant prod with no users; bleed is bounded by the empty wallet, no
  refill until the fix lands. Adding a flag for v0 creates a "default-off
  forever" tar-pit.
- **Cadence throttle (`POLY_CTF_REDEEM_SWEEP_INTERVAL_MS`).** Rejected:
  defense-in-depth on a correct precheck is dead code. If the precheck is
  right, 30s tick is fine. If it's wrong, throttling slows the bleed instead
  of stopping it — that's _worse_, because the bug becomes invisible.
- **Compute `positionId` via `getCollectionId` + `getPositionId` view
  methods.** Rejected: `Position.asset` already _is_ the ERC1155 id. Saves
  two ABI fragments and 2 RPC reads per position.
- **In-memory cooldown map (`Map<conditionId, last_attempt_ms>`).**
  Rejected: stateful, lost on pod restart, still issues one wasted tx per
  restart per condition. On-chain balance is stateless, authoritative, free.
- **Post-hoc `Transfer` event scan on the receipt.** Rejected: gas already
  spent by the time we read the receipt. Pre-flight is strictly cheaper.
- **Trust `Data-API.redeemable` and rate-limit retries.** Rejected: the
  Data-API flag is the bug source. Hoping it self-heals isn't a control loop.

### Follow-up (separate ticket — not this PR)

Filed as `task.0377` (sweep architecture refactor). The current sweep runs
every mirror-pipeline tick over every position; even with the precheck this
is O(positions) RPC fan-out per tick on a hot loop the rest of the pipeline
doesn't care about. Cleaner long-term: trigger redemption reactively when
`wallet-watch` first observes the resolution event for a condition_id we
hold, OR move the sweep to a slow dedicated cron. Out of scope for the
emergency fix; in scope as the next refactor.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **SWEEP_TRIGGERED_BY_ON_CHAIN_BALANCE** — the sweep MUST select positions
      to redeem by `balanceOf(funder, asset) > 0`, NOT by `Position.redeemable`.
      The Data-API `redeemable` flag is no longer in the predicate.
- [ ] **NO_REDEEM_ON_ZERO_BALANCE** — sweep MUST NOT call `redeemPositions`
      when `balanceOf` returns 0. Verified by unit test (mocks) AND by
      anvil-fork test (real contract, real tx semantics).
- [ ] **POLYGON_MAINNET_ONLY** — extended ABI stays pinned to the same CTF
      contract address (spec: `polymarket.ctf.redeem.ts` invariants).
- [ ] **BINARY_INDEX_SETS_WRITE_ONLY** — `[1, 2]` constraint applies only to
      the `redeemPositions` write path (indexSets argument). The new read
      path uses `Position.asset` directly and is outcome-cardinality agnostic.
- [ ] **AUTHORIZED_PLACE_ONLY** — redeem write path is unchanged; existing
      `authorizeWalletExit` runs before any submitted tx (spec:
      `poly-trade-executor.ts`).
- [ ] **NO_NEW_PORTS** — fix is contained to the existing `poly-trade-executor`
      capability + the renamed `polymarket.ctf` ABI module. No new ports,
      adapters, env vars, or config layers.
- [ ] **SIMPLE_SOLUTION** — two small changes (one ABI fragment, one predicate
      inversion in the sweep). No env flags, no throttles, no state machines,
      no DB migrations, no new packages.
- [ ] **ARCHITECTURE_ALIGNMENT** — extends an existing capability and a market-
      provider adapter ABI; no boundary violations (spec: architecture).

### Files

- Rename + modify: `packages/market-provider/src/adapters/polymarket/polymarket.ctf.redeem.ts`
  → `polymarket.ctf.ts`. Update module header `Purpose` to "Polygon CTF
  read+write surface used by the poly node". Add ONE ABI fragment to the
  existing `polymarketCtfRedeemAbi`:
  `balanceOf(address account, uint256 id) view returns (uint256)`.
  Update the importer in `packages/market-provider/src/adapters/polymarket/index.ts`.
- Modify: `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts`
  — rewrite `redeemAllRedeemableResolvedPositions` (line 657-691) to:
  (a) drop the `p.redeemable` filter, (b) multicall `balanceOf(funder, BigInt(p.asset))`
  for each candidate, (c) call `redeemResolvedPosition` only for positions
  where balance > 0, (d) emit `poly.ctf.redeem.skip_zero_balance` info-log
  (structured: `condition_id`, `asset`, `funder`) for the skipped ones.
  Downgrade `poly.ctf.redeem.sweep_skip` to debug or remove (it is now
  largely redundant — most "skips" become balance=0 skips at info level).
  `redeemResolvedPosition` itself is unchanged.
- Tests:
  - `nodes/poly/app/tests/unit/.../redeem-sweep.test.ts` — mocked-RPC unit
    tests asserting (a) zero-balance positions are skipped, (b) non-zero
    balance positions are passed through to `redeemResolvedPosition`,
    (c) the `Position.redeemable` flag has no effect on the predicate
    (test passes `redeemable: false` with balance > 0 → still redeems).
  - `nodes/poly/app/tests/integration/.../redeem-sweep.fork.test.ts` (NEW
    layer) — anvil-fork integration test that:
    (1) forks Polygon mainnet at a known resolved-market block,
    (2) impersonates a funder holding a redeemable position,
    (3) calls the sweep and asserts the ERC1155 balance decrements + USDC.e
    transfer in the receipt,
    (4) calls the sweep AGAIN with the now-zero balance and asserts NO new
    tx is broadcast (anvil tx count unchanged).
    This is the only test that catches the actual bug — `redeemPositions`
    succeeding-as-no-op is a chain semantic that mocks cannot reproduce.

## Allowed Changes

- `packages/market-provider/src/adapters/polymarket/polymarket.ctf.redeem.ts`
  (rename to `polymarket.ctf.ts` + add `balanceOf` ABI fragment).
- `packages/market-provider/src/adapters/polymarket/index.ts` (re-export path
  update).
- `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts`
  (`redeemAllRedeemableResolvedPositions` only — predicate inversion).
- New tests under `nodes/poly/app/tests/unit/` and
  `nodes/poly/app/tests/integration/` for the sweep path (mocked + anvil-fork).

Out of scope: env vars, container wiring (`container.ts:831`),
`mirror-pipeline.ts`, prod overlays, ConfigMaps. Sweep stays wired exactly
as today.

## Plan

- [x] **Checkpoint 1 — ABI surface**
  - Milestone: CTF read+write surface exposes `balanceOf`; importers updated.
  - Invariants: POLYGON_MAINNET_ONLY, NO_NEW_PORTS.
  - Todos:
    - [ ] Rename `packages/market-provider/src/adapters/polymarket/polymarket.ctf.redeem.ts` → `polymarket.ctf.ts`. Update module header `Purpose`.
    - [ ] Add `balanceOf(address account, uint256 id) view returns (uint256)` to `polymarketCtfRedeemAbi`.
    - [ ] Update import path in `packages/market-provider/src/adapters/polymarket/index.ts`.
    - [ ] Update `Links:` comment in `nodes/poly/app/src/app/api/v1/poly/wallet/positions/redeem/route.ts`.
    - [ ] Rename + update `packages/market-provider/tests/polymarket-ctf-redeem.test.ts` → `polymarket-ctf.test.ts` if needed.
  - Validation: `pnpm --filter @cogni/market-provider check` green.

- [x] **Checkpoint 2 — Predicate inversion**
  - Milestone: `redeemAllRedeemableResolvedPositions` redeems only when on-chain ERC1155 balance > 0.
  - Invariants: SWEEP_TRIGGERED_BY_ON_CHAIN_BALANCE, NO_REDEEM_ON_ZERO_BALANCE.
  - Todos:
    - [ ] Rewrite `redeemAllRedeemableResolvedPositions` (`nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts:657`) to drop `p.redeemable` filter, multicall `balanceOf(funder, BigInt(p.asset))` for each candidate, redeem only when balance > 0.
    - [ ] Emit `poly.ctf.redeem.skip_zero_balance` (info, structured) for zero-balance positions; downgrade old `sweep_skip` warn-event.
  - Validation: typecheck + existing unit tests pass.

- [x] **Checkpoint 3 — Mocked unit tests**
  - Milestone: Test layer asserts predicate semantics (independent of real chain).
  - Todos:
    - [ ] New tests in `nodes/poly/app/tests/unit/bootstrap/poly-trade-executor.test.ts`:
      - [ ] Sweep skips positions with `balanceOf === 0n` (no `writeContract` call).
      - [ ] Sweep redeems positions with `balanceOf > 0n` (one `writeContract` per non-zero).
      - [ ] Sweep ignores `Position.redeemable` flag (false + non-zero balance still redeems).
  - Validation: `pnpm --filter @cogni/poly-app test:unit` green.

- [ ] **Checkpoint 4 — Anvil-fork integration test (DEFERRED to task.0378)**
  - Decision: poly node has no anvil/fork test infrastructure
    (`viem.adapter.int.test.ts` files are stubs across all nodes; no
    `@viem/anvil` dep, no foundry, no testcontainers anvil image). Building
    that harness, plus refactoring the executor factory to accept an injected
    raw account (currently hard-couples to Privy `PolyTraderWalletPort`), is
    a multi-hour scope expansion materially larger than the bug fix itself.
  - Trade-off accepted: the mocked unit tests prove the predicate is
    inverted; the regression-prone `redeemable` filter is dropped at the
    source level. The remaining "redeemPositions succeeds-as-no-op on
    zero balance" semantic is documented CTF behavior — we no longer call
    that code path on a zero-balance position regardless of chain semantics.
  - Filed `task.0378` (anvil-fork harness) so the gate gets installed in
    a follow-up PR with proper infra scope.

- [x] **Checkpoint 5 — Bookkeeping**
  - Todos:
    - [x] File `task.0377` (sweep architecture refactor follow-up).
    - [x] File `task.0378` (anvil-fork test harness follow-up).
    - [x] Update `_index.md` and bug status to `needs_closeout`.

## Validation

**Commands:**

```bash
# Unit (mocked) — predicate semantics
pnpm --filter @cogni/poly-node-app test:unit -- redeem-sweep

# Integration (anvil fork of Polygon mainnet) — real CTF semantics
pnpm --filter @cogni/poly-node-app test:integration -- redeem-sweep.fork
```

**Expected:** All tests pass. Critically, the fork test's "second sweep" step
asserts zero new transactions are broadcast — that is the regression gate
this bug exists to install.

**Post-flight on candidate-a (the gate that actually matters):**

```bash
# 1. After candidate-a flight + wallet refill, watch native POL balance:
curl -s -X POST https://1rpc.io/matic \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134","latest"]}'
# 2. Pull Polygonscan tx history; expect zero `redeemPositions` txs over a
#    1-hour idle window (no resolved positions held).
# 3. Loki: structured `poly.ctf.redeem.skip_zero_balance` lines appear at
#    sweep cadence; no `redeemPositions confirmed` (`poly.ctf.redeem.ok`)
#    unless we genuinely had a non-zero balance.
```

**Expected:** Wallet balance flat over 1h idle; `redeemPositions` cadence
drops from ~150/hr to 0/hr in steady state, with one tx per genuinely-
redeemable position observed at resolution time.

## Review Checklist

- [ ] **Work Item:** `bug.0376` linked in PR body
- [ ] **Spec:** mirror-pipeline + poly-trade-executor invariants upheld; no
      regression to existing redeem flow on truly-unredeemed positions
- [ ] **Tests:** mocked unit tests + anvil-fork integration test (real
      chain semantics) both green; fork test's "second sweep submits 0 txs"
      assertion is present
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Sample drain tx (Polygonscan): https://polygonscan.com/tx/0x4765f49bc03af618ee8f99d912522b3e5cd414363fb0f31ddeb7689167f617b4
- Operator trading wallet: https://polygonscan.com/address/0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134
- Pod: `poly-node-app-db778595-dmf2b` (cogni-production)

## Review Feedback (revision 1, 2026-04-25)

From `/review-implementation`:

**B1 (blocking) — Dedup by normalized conditionId.**
`poly-trade-executor.ts:674` dedupes by raw `p.conditionId`; the old loop dedupes
by `normalizePolygonConditionId(p.conditionId)`. Two rows with the same value in
different case (e.g. `0xABC…` vs `0xabc…`) would multicall twice. Capture the
normalized form into `norm` and use `seen.has(norm)` / `seen.add(norm)`.

**B2 (blocking) — Add three missing test cases.**

- All-balances-non-zero → all positions redeem in order (currently we only
  cover one-redeems-one-skips).
- `multicall` returning a `failure` element (`[{ status: "failure", error }, { status: "success", result: 100n }]`) → first warns,
  second still redeems.
- Empty positions list → no `multicall` call at all (covers the `if (candidates.length === 0) return [];` short-circuit).

**S1 (suggestion) — Honor the design's logging change.**
Either downgrade `poly.ctf.redeem.sweep_skip` to `debug`, or rename to
`poly.ctf.redeem.error` to reflect that it now only fires when
`redeemResolvedPosition` itself throws (rare, post-balance-check).

**S2 (suggestion) — Guard `BigInt(p.asset)`** with `if (!p.asset) continue;`
before the `try/catch`. `BigInt("")` returns `0n`, currently silently filtered
by the balance check — fine, but cheaper to short-circuit.

## Attribution

- Reported by: derek (`/logs prod` → `/bug`)
