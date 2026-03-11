---
id: task.0085
type: task
title: Splits deployment + distribution wiring
status: needs_design
priority: 0
estimate: 2
summary: Deploy Push Split V2o2 on Base via repeatable script, implement distributeSplit() in Privy adapter, wire into credit settlement flow.
outcome: Split contract deployed on Base with operator/DAO split. distributeSplit() working in adapter. Credit settlement triggers distribution automatically.
spec_refs: operator-wallet
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch:
pr:
reviewer:
created: 2026-02-17
updated: 2026-03-09
labels: [wallet, web3, billing]
external_refs:
revision: 1
blocked_by: task.0084
deploy_verified: false
rank: 20
---

# Splits deployment + distribution wiring

> Supersedes original "DAO treasury USDC sweep" scope. Splits handles DAO share on-chain — no app-level sweep needed.

## Requirements

- `scripts/deploy-split.ts` — programmatic Split deployment on Base via `@0xsplits/splits-sdk`
  - Recipients: ~92.1% operator wallet, ~7.9% DAO treasury (derived from pricing constants)
  - Controller: operator wallet address
  - Outputs: checksummed Split address to stdout + next-steps checklist
  - Uses `splitV2ABI` from `@0xsplits/splits-sdk/constants/abi` (Push Split V2o2 — validated by spike.0090)
  - Repeatable script pattern (same as `provision-operator-wallet.ts`)
- `distributeSplit()` implemented in `PrivyOperatorWalletAdapter` — encode `distribute(splitParams, token, distributor)` and submit via Privy wallet RPC
  - SplitParams (recipients, allocations, totalAllocation, distributionIncentive) sourced from config
  - ABI from `splitV2ABI`, NOT manual selector encoding
- Wire `distributeSplit()` call into credit settlement flow (call after credit mint)
- Update `operator_wallet.split_address` in repo-spec to point to deployed Split
- `FakeOperatorWalletAdapter.distributeSplit()` returns fake tx hash (already does — no change needed)

## Removed from scope (vs original task.0085)

- ~~`sweepUsdcToTreasury()`~~ — Splits handles DAO share on-chain
- ~~`calculateDaoShare()`~~ — DAO share is a Split allocation, not app-level math
- ~~`outbound_transfers` table~~ — no app-level sweep state machine needed

## Key spike references

- `scripts/experiments/splits-deploy.ts` — working deployment code
- `scripts/experiments/full-chain.ts:170-203` — working distribute call with SplitParams struct
- Factory: `0x8E8eB0cC6AE34A38B67D5Cf91ACa38f60bc3Ecf4`
- Gas: ~166k deploy, ~81k distribute
- ~0.000002 USDC dust remains after distribution (acceptable)

## Allowed Changes

- `scripts/deploy-split.ts` (new)
- `src/adapters/server/wallet/privy-operator-wallet.adapter.ts` (implement distributeSplit)
- `src/features/payments/services/creditsConfirm.ts` (dispatch distribution after credit settlement)
- `.cogni/repo-spec.yaml` (update split_address after deployment)
- `src/core/billing/pricing.ts` (split allocation constants if not already present)
- `tests/` (integration tests for distribute flow)

## Design

_To be designed. Key decisions:_

- Where do SplitParams live? (repo-spec extension? dedicated config in `src/core/billing/pricing.ts`?)
- How does `distributeSplit()` get the SplitParams struct? (config injection? derive from repo-spec?)
- Should distribution be synchronous in the credit settlement path or async (Temporal activity)?

## Plan

- [ ] **Checkpoint 1: Deploy script**
  - [ ] Create `scripts/deploy-split.ts` using `@0xsplits/splits-sdk`
  - [ ] Derive allocations from pricing constants (92.1% operator, 7.9% DAO)
  - [ ] Deploy to Base, output checksummed Split address
  - [ ] Update `.cogni/repo-spec.yaml` with deployed address
  - Validation: Script runs successfully on Base testnet/mainnet

- [ ] **Checkpoint 2: Implement distributeSplit()**
  - [ ] Implement `distributeSplit()` in `PrivyOperatorWalletAdapter` using `splitV2ABI`
  - [ ] Encode `distribute(splitParams, token, distributor)` — match spike `full-chain.ts:191-196`
  - [ ] Source SplitParams from config (recipients, allocations, totalAllocation, distributionIncentive)
  - Validation: Contract test passes with real encode/decode

- [ ] **Checkpoint 3: Wire into settlement**
  - [ ] Add distribution dispatch to `creditsConfirm.ts` (after credit mint)
  - [ ] Non-blocking: log error but don't fail credit settlement if distribution fails
  - Validation: `pnpm check` passes, integration test confirms flow

## Validation

```bash
pnpm check
pnpm test tests/contract/operator-wallet.contract.ts
```

## Review Checklist

- [ ] **Work Item:** `task.0085` linked in PR body
- [ ] **Spec:** Distribution uses `splitV2ABI` (not manual selectors), params from config
- [ ] **Tests:** Integration test for distribute flow
- [ ] **Reviewer:** assigned and approved
- [ ] **No manual steps:** Deploy script is repeatable

## PR / Links

- Depends on: task.0084 (operator wallet foundation)
- Branch target: `feat/operator-wallet-v0` (not staging)

## Attribution

-
