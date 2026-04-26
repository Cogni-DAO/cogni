---
id: task.0378
type: task
title: poly anvil-fork test harness — verify CTF semantics against real Polygon chain state
blocked_by: bug.0373
status: needs_triage
priority: 2
rank: 60
estimate: 3
branch:
summary: bug.0373's fix (drop Data-API `redeemable` filter, use on-chain ERC1155 balance instead) is verified by mocked unit tests, but the underlying chain semantic — `redeemPositions` succeeding-as-no-op when payout is 0 — was never under test. Build a minimal anvil-fork harness so the regression gate is "calling redeemPositions on a zero-balance position is impossible," verified against a real CTF contract.
outcome: One integration test that forks Polygon mainnet at a known resolved-market block, impersonates a funder holding a redeemable CTF position, runs the sweep twice, and asserts (a) the first call mints a USDC.e Transfer and decrements ERC1155 balance, (b) the second call submits zero new transactions. Repo gains a reusable anvil-fork harness for future on-chain regression tests.
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
labels: [poly, testing, infra, on-chain]
external_refs:
---

# poly anvil-fork test harness

## Requirements

bug.0373 was filed because we trusted `Data-API.redeemable` and burned POL on
no-op redemptions. The fix swaps the predicate to on-chain ERC1155 balance,
verified by mocked unit tests in
`nodes/poly/app/tests/unit/bootstrap/poly-trade-executor.test.ts`. Those
tests cover predicate logic but **not** the chain semantic that allowed the
bug to exist: `redeemPositions` succeeds (no revert) even when the funder's
position-token balance is 0.

A mock cannot reproduce that semantic. To install a real regression gate we
need an integration test that hits a real (forked) Polygon CTF contract. The
repo currently has zero anvil/fork test infrastructure
(`nodes/{poly,resy,operator}/app/tests/component/wallet/viem.adapter.int.test.ts`
are stubs).

## Allowed Changes

- New: `nodes/poly/app/tests/integration/redeem-sweep.fork.test.ts` (or wherever
  integration-tier tests live once the harness exists).
- New: shared anvil-fork helper under `nodes/poly/app/tests/helpers/` or a
  shared `packages/test-anvil-fork/` if reused beyond poly.
- `nodes/poly/app/package.json` — add `@viem/anvil` (or alternative) as
  devDependency.
- Possibly: add a foundry install step to the CI workflow that runs poly
  integration tests, OR embed an anvil binary via testcontainers.
- Minimal seam in
  `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts` so the
  factory can take an injected viem `Account` + `transport` for tests
  (current factory hard-couples to `PolyTraderWalletPort` which resolves a
  Privy account — needs a constructor option to bypass for fork tests).

## Plan

- [ ] **/design** — pick anvil delivery (`@viem/anvil` package vs.
      testcontainers vs. CI-installed foundry); pick fork pin (block number +
      condition_id holding a known redeemable position).
- [ ] Add devDep + harness helper that:
      (1) starts an anvil fork of Polygon mainnet at a pinned block,
      (2) impersonates a funder address (`anvil_impersonateAccount`),
      (3) funds it with POL via `anvil_setBalance`,
      (4) returns a wired `publicClient` + `walletClient` pointed at the fork.
- [ ] Add poly-trade-executor seam that accepts an injected raw account /
      transport (avoiding Privy walletPort) for tests only. Document the seam
      as test-only in the module header.
- [ ] Write the integration test:
  - Pre-condition: pick a (funder, conditionId) pair from Polygonscan that
    held a redeemable position at the pinned block.
  - Assert: first sweep mints USDC.e + decrements ERC1155 balance.
  - Assert: second sweep multicalls balanceOf (returns 0n) and submits zero
    new on-chain txs.
- [ ] Add a `pnpm test:fork` script and run it from the relevant CI workflow.

## Validation

```bash
pnpm --filter @cogni/poly-app test:fork
```

**Expected:** Test passes with a real anvil fork. Specifically the
"second sweep submits 0 txs" assertion is the regression gate this task
exists to install.

## Review Checklist

- [ ] **Work Item:** `task.0378` linked in PR body
- [ ] **Spec:** `bug.0376` invariants still uphold (predicate is on-chain
      balance; no env flags introduced).
- [ ] **Tests:** new fork test green; existing unit tests untouched.
- [ ] **Reviewer:** assigned and approved.

## PR / Links

- Parent fix: `bug.0376`
- Sweep code: `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts:657`

## Attribution

- Filed by: derek (`/implement bug.0373` deferral — reviewer accepted the
  trade-off given no anvil infra existed).
