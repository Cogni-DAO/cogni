---
id: task.0150
type: task
title: Operator wallet e2e validation — Privy credentials, Split deploy, test:external
status: needs_implement
priority: 1
estimate: 3
summary: Validate the operator wallet pipeline end-to-end. Provision Privy credentials, deploy Split on Base, update repo-spec with real addresses, create test:external tests for PrivyOperatorWalletAdapter and distributeSplit(). Without this, the entire task.0085 pipeline is untested against real infrastructure.
outcome: Privy credentials provisioned. Split deployed on Base. repo-spec has real addresses. test:external suite proves PrivyOperatorWalletAdapter.distributeSplit() works against real Privy + real chain. Pipeline validated before task.0086 (OpenRouter top-up) builds on it.
spec_refs: operator-wallet
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch: feat/task.0150-operator-wallet-e2e
pr:
reviewer:
created: 2026-03-10
updated: 2026-03-11
labels: [wallet, web3, testing]
external_refs:
revision: 2
blocked_by:
deploy_verified: false
rank: 15
---

# Operator wallet e2e validation

> The entire operator wallet pipeline (task.0085) has only been tested with FakeOperatorWalletAdapter. The real PrivyOperatorWalletAdapter has never been called. No Privy credentials exist. No Split contract is deployed. repo-spec has placeholder addresses. This task validates the pipeline before task.0086 (OpenRouter top-up) builds on it.

## Why this blocks everything

The payment pipeline is: User USDC → Split contract → distribute() → operator/DAO split → operator funds OpenRouter (task.0086).

Task.0086 can't be implemented until:

1. Privy credentials exist and the adapter actually works
2. A Split contract is deployed on Base with correct allocations
3. `distributeSplit()` is proven to work against real chain
4. repo-spec has real addresses so the container wires the real adapter

Without this task, task.0086 would be building on unvalidated foundations.

## Current state (what's broken)

| Component                  | Status          | Problem                                                               |
| -------------------------- | --------------- | --------------------------------------------------------------------- |
| Privy credentials          | Missing         | Never provisioned. No PRIVY_APP_ID/SECRET/SIGNING_KEY                 |
| PrivyOperatorWalletAdapter | Never tested    | Only FakeOperatorWalletAdapter used in tests                          |
| Split contract             | Not deployed    | `scripts/deploy-split.ts` exists but never run on mainnet             |
| repo-spec addresses        | Placeholder     | `operator_wallet.address: 0x000...`, `receiving_address` = DAO wallet |
| Container wiring (prod)    | Never exercised | `operatorWallet: undefined` because no Privy env vars                 |
| Treasury settlement (prod) | Silently no-ops | `treasurySettlement: undefined` because no operatorWallet             |

## Plan

### Checkpoint 1: Privy credentials + operator wallet provisioning

- [ ] Create Privy account / obtain credentials (PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_SIGNING_KEY)
- [ ] Run `pnpm tsx scripts/provision-operator-wallet.ts`
- [ ] Record operator wallet address
- [ ] Update `.cogni/repo-spec.yaml` → `operator_wallet.address`
- [ ] Add Privy env vars to `.env.local` (and document in `.env.local.example`)
- [ ] Verify container boots with real adapter: check logs for Privy adapter init (not "skipping")

### Checkpoint 2: Split contract deployment on Base

- [ ] Fund deployer EOA with ETH on Base (~$0.01 for gas)
- [ ] Run `pnpm tsx scripts/deploy-split.ts` with real addresses
- [ ] Verify deployed Split allocations match billing constants (92.1% / 7.9%)
- [ ] Update `.cogni/repo-spec.yaml` → `payments_in.credits_topup.receiving_address` = Split address
- [ ] Verify on Basescan: Split contract exists, recipients correct

### Checkpoint 3: test:external for operator wallet

- [ ] `tests/external/operator-wallet.external.test.ts` — requires PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_SIGNING_KEY
  - Test: PrivyOperatorWalletAdapter.getAddress() returns expected address
  - Test: PrivyOperatorWalletAdapter.getSplitAddress() returns deployed Split address
  - Test: distributeSplit(USDC) succeeds (may need small USDC in Split first, or verify tx reverts gracefully with 0 balance)
- [ ] Guard with env var check (skip if credentials missing, like existing external tests)
- [ ] Add to `pnpm test:external` suite

### Checkpoint 4: dev:stack validation

- [ ] `pnpm dev:stack` with Privy env vars — verify container wires real adapter
- [ ] Simulate credit confirmation flow — verify treasury settlement attempts real distributeSplit()
- [ ] Verify structured logs show settlement outcome (not undefined)

## Relationship to other tasks

- **task.0085** (done) — built the code; this task validates it works
- **task.0086** (blocked by this) — implements fundOpenRouterTopUp(); depends on proven Privy adapter
- **Setup wizard refactor** — scripts → UI (DAO formation pattern) is a separate concern; do AFTER pipeline is validated

## Open questions

- [ ] Do we need a test Split on Base Sepolia first, or go straight to mainnet? (Mainnet deployment is cheap — ~$0.01 gas — but Sepolia would be safer for initial validation)
- [ ] How much USDC should be seeded in the Split for test:external to call distributeSplit()? Or should the test just verify the tx doesn't revert with 0 balance?

## Validation

```bash
pnpm check
pnpm test:external  # requires PRIVY_* env vars
pnpm dev:stack      # verify real adapter wiring
```

## PR / Links

- Handoff: [handoff](../handoffs/task.0150.handoff.md)

## Attribution

-
