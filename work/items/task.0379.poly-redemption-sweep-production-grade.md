---
id: task.0379
type: task
title: Poly redemption sweep — top-0.1% production-grade hardening (gates + spec + anvil-fork validation)
blocked_by: bug.0376
status: needs_triage
priority: 0
rank: 1
estimate: 5
branch:
summary: bug.0376 stopped the unbounded gas drain. This task takes the autonomous redemption sweep the rest of the way to top-0.1% crypto-app practice — on-chain resolution + payout gates, in-flight idempotency, post-flight receipt verification, written spec invariants, and an anvil-fork regression test that exercises the actual bug-class chain semantic.
outcome: The redemption sweep is correct-by-construction, not by code-review. A `docs/spec/poly-autonomous-redemption-sweep.md` exists with enumerated invariants. The sweep skips unresolved markets, skips losing-side balances, deduplicates in-flight ticks during tx confirmation, and refuses to mark a redemption complete without observing the expected USDC.e Transfer event in the receipt. An anvil-fork CI test forks Polygon at a known resolved-market block and asserts (a) the first sweep mints USDC.e + decrements ERC1155 balance, (b) the second sweep submits zero new transactions. Operator wallet drain caused by the redemption sweep becomes impossible by construction.
spec_refs:
assignees: []
credit:
project: proj.poly-web3-security-hardening
pr:
reviewer:
revision: 0
deploy_verified: false
created: 2026-04-25
updated: 2026-04-25
labels: [poly, security, web3, gas, crypto, redemption]
external_refs:
---

# Poly redemption sweep — top-0.1% production-grade hardening

## Requirements

bug.0376 inverted the sweep predicate from Data-API `redeemable` to on-chain
`balanceOf > 0`. That stops the _specific_ unbounded loop. It does not make
the sweep production-grade. Concretely, the post-bug.0376 code still has
five real gaps:

1. **No resolution gate.** A funder holding tokens on a market that has not
   yet resolved passes `balanceOf > 0`. The sweep then calls
   `redeemResolvedPosition`, which throws `not_redeemable` via the Data-API
   inner check. Net: every sweep tick warn-logs for held-but-unresolved
   markets at sweep cadence. Cosmetic but surfaces the design hole.
2. **No payout-side gate.** A funder holding _losing-side_ tokens on a
   resolved market passes `balanceOf > 0` AND Data-API marks
   `redeemable: true`. We submit `redeemPositions`, the contract burns the
   losing-side ERC1155 tokens, USDC.e payout is 0. Gas spent for nothing.
   One-shot per holder per market — bounded, but avoidable.
3. **No idempotency during tx confirmation.** Sweep tick at t=0 fires
   redeem. Tx confirms in ~2s on Polygon. If the next tick falls in that 2s
   window, `balanceOf` still returns >0 and we fire a second redeem. Both
   succeed; second is a no-op. ~0.0085 POL wasted per double-fire. Bounded
   to one extra tx per redemption today.
4. **No post-flight receipt verification.** We don't parse the receipt
   `Transfer` events to verify the USDC.e amount. A redemption that
   silently produces zero payout (case 2) succeeds without anomaly.
5. **No spec.** `docs/spec/poly-position-exit.md` covers user-initiated
   `/redeem`, not the autonomous mirror-pipeline sweep. The loop that
   drained the operator wallet is in zero specs.

Plus one validation gap that bug.0376 itself failed to close:

6. **Bug-fix happy path was never validated against real chain state.**
   Candidate-a has zero resolved+held positions. The bug.0376 fix's
   regression gate ("after a successful redemption, the next sweep tick
   submits zero transactions") was proved by mocked unit tests only. No
   real chain semantic was exercised.

## Allowed Changes

- `packages/market-provider/src/adapters/polymarket/polymarket.ctf.ts`
  (extend ABI with `payoutDenominator`, `payoutNumerators` view methods).
- `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts`
  (extend sweep predicate with resolution + payout gates; add in-flight
  single-flight map; add receipt-event verification helper).
- `nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts` (only if the
  single-flight gate lives at the tick boundary, otherwise no change).
- New: `docs/spec/poly-autonomous-redemption-sweep.md`.
- New: `nodes/poly/app/tests/integration/redeem-sweep.fork.test.ts` (or
  wherever `task.0378`'s anvil-fork harness lands — depend on it).
- Source-of-truth checklist (Top-0.1% on-chain write checklist) added to
  `proj.poly-web3-security-hardening.md` Design Notes — already present.

Out of scope: env flags, kill switches, throttles. Same as bug.0376.

## Plan

- [ ] **Phase 1 — Spec first.** Write
      `docs/spec/poly-autonomous-redemption-sweep.md` with enumerated
      invariants:
      `SWEEP_NEVER_BURNS_GAS_ON_NO_OP_REDEEM`,
      `SWEEP_RESPECTS_RESOLUTION` (`payoutDenominator > 0`),
      `SWEEP_RESPECTS_PAYOUT` (`payoutNumerators[indexSet] > 0` for held side),
      `SWEEP_IDEMPOTENT_DURING_TX_CONFIRMATION` (single-flight per
      `(funder, conditionId)` for the duration of an unconfirmed tx),
      `SWEEP_RECEIPT_VERIFIED` (refuse "done" without the expected USDC.e
      Transfer > 0; emit `poly.ctf.redeem.no_payout` anomaly if zero).
      `/design` review against the spec before code touches.

- [ ] **Phase 2 — On-chain gates.** Extend the sweep multicall to batch
      `payoutDenominator(conditionId)` + `payoutNumerators(conditionId, indexSet)` + `balanceOf(funder, asset)` for every candidate. Skip when payout
      product is 0. Single multicall, no extra round-trip.

- [ ] **Phase 3 — Single-flight idempotency.** In-process
      `Map<conditionId, { txHash, startedAt }>` keyed by normalized
      conditionId, populated when `writeContract` fires, cleared on receipt
      (success OR failure). Sweep tick observing an entry < `MAX_TX_TTL`
      old (default 60s) skips the condition. Restart-tolerant note: a
      restart loses the map but `balanceOf` will already be 0 post-mined,
      so the worst case after restart is one extra tx if confirmation
      lapped the restart — same bound as today, not a regression.

- [ ] **Phase 4 — Receipt verification.** After
      `waitForTransactionReceipt`, parse the receipt's `logs` for the
      USDC.e (`POLYGON_USDC_E`) `Transfer(from=CTF, to=funder)` event with
      value > 0. If absent, log structured `poly.ctf.redeem.no_payout` and
      mark the redemption as "completed-zero-payout" rather than "ok". The
      tx itself isn't reverted — we just refuse to claim success.

- [ ] **Phase 5 — Anvil-fork validation (depends on task.0378).** Add the
      regression test that bug.0376 should have shipped with: fork Polygon
      at a known resolved-market block, impersonate a funder holding the
      winning side, run the sweep, assert (a) one redeem tx fires, (b)
      receipt has USDC.e Transfer > 0, (c) ERC1155 balance is now 0, (d)
      the next sweep tick submits zero new txs and emits one
      `poly.ctf.redeem.skip_zero_balance` info log.

- [ ] **Phase 6 — Refill prod operator wallet.** ONLY after Phases 1–5 are
      green and flighted to candidate-a successfully. The wallet stays
      empty until then.

## Validation

```bash
# Unit (mocked) — gate semantics
pnpm --filter @cogni/poly-app test:unit -- redeem-sweep

# Integration (anvil fork) — real chain semantic regression
pnpm --filter @cogni/poly-app test:fork -- redeem-sweep
```

**Expected:** all tests pass. The fork test's "second sweep submits 0 txs"
assertion is the regression gate this whole project exists to install.

**Post-flight on candidate-a:**

The candidate-a env will not have a redeemable position on demand. Validate
indirectly:

1. `buildSha` matches PR head.
2. Loki shows zero `poly.ctf.redeem.error` warn-logs at sweep cadence
   (resolution gate filters them out before the inner Data-API check).
3. Loki shows `poly.ctf.redeem.skip_*` info logs at sweep cadence — proves
   gates are exercising.

The actual happy-path proof is the anvil-fork test, not candidate-a.

## Review Checklist

- [ ] **Work Item:** `task.0379` linked in PR body
- [ ] **Spec:** `docs/spec/poly-autonomous-redemption-sweep.md` lands in the
      same PR (spec-first invariant for this project)
- [ ] **Tests:** mocked unit tests for each gate + anvil-fork integration
      test green; fork test's "second sweep = 0 txs" assertion present
- [ ] **Reviewer:** assigned and approved
- [ ] **Project link:** project `proj.poly-web3-security-hardening` Crawl
      table updated with PR + final status

## PR / Links

- Project: `proj.poly-web3-security-hardening`
- Parent: `bug.0376` (stop-the-bleed predicate inversion)
- Sister: `task.0377` (sweep architecture refactor — reactive on resolution event)
- Sister (hard dep): `task.0378` (anvil-fork test harness — required for Phase 5)
- Sweep code: `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts:657`
- CTF ABI: `packages/market-provider/src/adapters/polymarket/polymarket.ctf.ts`

## Attribution

- Filed by: derek (`/review-design` follow-up on bug.0376 — top-0.1%
  practice gap).
