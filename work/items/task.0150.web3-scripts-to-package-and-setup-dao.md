---
id: task.0150
type: task
title: Operator wallet e2e validation — Privy credentials, Split deploy, test:external
status: needs_review
priority: 1
estimate: 3
summary: Validate the operator wallet pipeline end-to-end. Provision Privy credentials, deploy Split on Base, update repo-spec with real addresses, create test:external tests for PrivyOperatorWalletAdapter and distributeSplit(). Without this, the entire task.0085 pipeline is untested against real infrastructure.
outcome: Privy credentials provisioned. Split deployed on Base. repo-spec has real addresses. test:external suite proves PrivyOperatorWalletAdapter.distributeSplit() works against real Privy + real chain. Container wires real adapter. Credit purchase triggers on-chain distribution.
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
revision: 3
blocked_by:
deploy_verified: false
rank: 15
---

# Operator wallet e2e validation

> Validate the full payment pipeline end-to-end: user pays USDC → Split contract → distribute() → operator/DAO split. Prove it works with real Privy credentials on Base mainnet.

## Plan

### Checkpoint 1: Privy credentials + operator wallet provisioning

- [x] Create Privy account / obtain credentials (PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_SIGNING_KEY)
- [x] Provision operator wallet via Privy API — address: `0xdCCa8D85603C2CC47dc6974a790dF846f8695056`
- [x] Update `.cogni/repo-spec.yaml` → `operator_wallet.address`
- [x] Add Privy env vars to `.env.local`
- [x] Document setup in `docs/guides/operator-wallet-setup.md`

### Checkpoint 2: Split contract deployment on Base

- [x] Fund deployer EOA with ETH on Base
- [x] Deploy Push Split V2o2 — address: `0xd92EEc51C471CcF76996f0163Fd3cB6A61798f9C`
- [x] Allocations match billing constants (92.1% operator / 7.9% DAO)
- [x] Update `.cogni/repo-spec.yaml` → `payments_in.credits_topup.receiving_address` = Split address
- [ ] Verify on Basescan: Split contract exists, recipients correct

### Checkpoint 3: test:external for operator wallet

- [x] `tests/external/operator-wallet/operator-wallet.external.test.ts` — all 3 tests passing
  - [x] `getAddress()` returns expected address after Privy verification
  - [x] `getSplitAddress()` returns deployed Split address
  - [x] `distributeSplit(USDC)` submits real tx on Base via Privy HSM
- [x] Guard with env var check (skip if credentials missing)
- [x] Fix: address checksum bug in PrivyOperatorWalletAdapter
- [x] Fix: IPv6 timeout in vitest external config

### Checkpoint 4: dev:stack validation

- [ ] `pnpm dev:stack` with Privy env vars — verify container wires real adapter (not undefined)
- [ ] Credit purchase via web UI → verify treasury settlement calls real `distributeSplit()`
- [ ] Verify structured logs show settlement outcome with txHash

## What's wired (confirmed by code trace)

The full flow exists in code:

1. `POST /api/v1/payments/credits/confirm` → route validates + SIWE auth
2. `confirmCreditsPaymentFacade` → resolves billing account
3. `confirmCreditsPurchase` → credits user, mints system bonus, then calls `treasurySettlement.settleConfirmedCreditPurchase()`
4. `SplitTreasurySettlementAdapter` → calls `operatorWallet.distributeSplit(USDC_ADDRESS)`
5. `PrivyOperatorWalletAdapter.distributeSplit()` → encodes Split V2 distribute(), submits via Privy HSM
6. On-chain: Split distributes USDC to operator wallet (92.1%) + DAO treasury (7.9%)

Settlement failure does NOT fail credit confirmation (decoupled). Container wires real adapter only when all 3 Privy env vars + repo-spec addresses are present.

## Immediate next steps

1. **Boot `dev:stack` with Privy env vars** — confirm container logs show Privy adapter init (not "skipping operator wallet")
2. **Do a real credit purchase through the web UI** — confirm treasury settlement fires and `distributeSplit()` tx appears in logs
3. **Verify on Basescan** — Split contract recipients + the distribute tx from step 2

## Relationship to other tasks

- **task.0085** (done) — built the code; this task validates it works
- **task.0086** (blocked by this) — implements `fundOpenRouterTopUp()`; depends on proven Privy adapter

## Validation

```bash
pnpm check
pnpm dotenv -e .env.local -- pnpm test:external  # requires PRIVY_* env vars
pnpm dev:stack  # verify real adapter wiring + credit purchase flow
```

## PR / Links

- PR: [#553](https://github.com/Cogni-DAO/node-template/pull/553) → `feat/operator-wallet-e2e`
- Handoff: [handoff](../handoffs/task.0150.handoff.md)
- Setup guide: [operator-wallet-setup.md](../../docs/guides/operator-wallet-setup.md)

## Attribution

-
