---
id: task.0085
type: task
title: Splits deployment + distribution wiring
status: needs_implement
priority: 0
estimate: 2
summary: Deploy Push Split V2o2 on Base via repeatable script, implement distributeSplit() in Privy adapter, wire into credit settlement flow.
outcome: Split contract deployed on Base with operator/DAO split. distributeSplit() working in adapter. Credit settlement triggers distribution automatically.
spec_refs: operator-wallet
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch: feat/operator-wallet-v1-splits
pr:
reviewer:
created: 2026-02-17
updated: 2026-03-09
labels: [wallet, web3, billing]
external_refs:
revision: 2
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
  - SplitParams (recipients, allocations, totalAllocation, distributionIncentive) derived from billing constants at runtime
  - ABI from `splitV2ABI`, NOT manual selector encoding
- Wire `distributeSplit()` call into settlement (Checkpoint 3 — see open question below)
- After deploy: update `payments_in.credits_topup.receiving_address` in repo-spec to the deployed Split address
- `FakeOperatorWalletAdapter.distributeSplit()` returns fake tx hash (already does — no change needed)

## Removed from scope (vs original task.0085)

- ~~`sweepUsdcToTreasury()`~~ — Splits handles DAO share on-chain
- ~~`calculateDaoShare()`~~ — DAO share is a Split allocation, not app-level math
- ~~`outbound_transfers` table~~ — no app-level sweep state machine needed
- ~~`operator_wallet.split_address`~~ — removed from repo-spec schema; `receiving_address` is the single source of truth for where user payments land

## Key spike references

- `scripts/experiments/splits-deploy.ts` — working deployment code
- `scripts/experiments/full-chain.ts:170-203` — working distribute call with SplitParams struct
- Factory: `0x8E8eB0cC6AE34A38f67D5Cf91ACa38f60bc3Ecf4`
- Gas: ~166k deploy, ~81k distribute
- ~0.000002 USDC dust remains after distribution (acceptable)

## Design

### Package extraction (`@cogni/operator-wallet`)

Split allocation math, port interface, and Privy adapter extracted to `packages/operator-wallet/` capability package:

```
packages/operator-wallet/
  src/port/operator-wallet.port.ts       # OperatorWalletPort, TransferIntent
  src/domain/split-allocation.ts         # calculateSplitAllocations(), constants
  src/adapters/privy/                    # PrivyOperatorWalletAdapter (distributeSplit impl)
  src/index.ts                           # Main barrel: port + domain (no adapter)
```

- App imports port via `@cogni/operator-wallet` (re-exported through `@/ports`)
- Container lazy-imports adapter via `@cogni/operator-wallet/adapters/privy`
- Deploy script imports constants from `@cogni/operator-wallet`
- No `@/core` imports in the adapter — arch boundary respected

### Repo-spec receiving_address as source of truth

`payments_in.credits_topup.receiving_address` is where user USDC goes. With operator wallet, this becomes the Split contract address. Container wires `splitAddress` from `getPaymentConfig().receivingAddress`. No redundant `split_address` field.

DAO treasury address read via `getDaoTreasuryAddress()` from `cogni_dao.dao_contract` (new accessor added to `@cogni/repo-spec`).

### Open question: distribution trigger

`distribute()` is a batch operation (~81k gas). Calling per-payment wastes gas. Options:

1. **Per-payment in creditsConfirm.ts** — simple, wasteful
2. **Periodic Temporal activity** — efficient, needs scheduler wiring
3. **Manual/operator-triggered** — simplest start, no automation

Recommendation: start with (3) — the adapter is ready, script can call it. Wire automation in a follow-up task.

## Allowed Changes

- `packages/operator-wallet/` (new package — port, domain, adapter)
- `scripts/deploy-split.ts` (new)
- `scripts/distribute-split.ts` (new — manual distribution trigger)
- `src/ports/treasury-settlement.port.ts` (new — semantic settlement port)
- `src/ports/index.ts` (barrel export)
- `src/adapters/server/treasury/split-treasury-settlement.adapter.ts` (new)
- `src/features/payments/application/confirmCreditsPurchase.ts` (new — orchestrator)
- `src/app/_facades/payments/credits.server.ts` (swap to orchestrator)
- `src/ports/operator-wallet.port.ts` (re-export from package)
- `src/bootstrap/container.ts` (wiring)
- `src/shared/config/repoSpec.server.ts` (getDaoTreasuryAddress accessor)
- `src/shared/config/index.ts` (barrel export)
- `packages/repo-spec/src/` (dao_contract schema + accessor, remove split_address)
- `.cogni/repo-spec.yaml` (remove split_address, update receiving_address after deploy)
- Root config: `package.json`, `tsconfig.json`, `biome/base.json`
- `tests/` (unit + contract tests)

## Plan

- [x] **Checkpoint 1: Deploy script**
  - [x] Create `scripts/deploy-split.ts` using `@0xsplits/splits-sdk`
  - [x] Derive allocations from `@cogni/operator-wallet` constants
  - [x] Deploy to Base, output checksummed Split address
  - [ ] Run on Base mainnet (manual — requires deployer key)
  - [ ] Update `.cogni/repo-spec.yaml` receiving_address with deployed address

- [x] **Checkpoint 2: Implement distributeSplit() + package extraction**
  - [x] Create `packages/operator-wallet` capability package
  - [x] Move port, domain math, adapter into package
  - [x] `distributeSplit()` implemented using `splitV2ABI`
  - [x] Container wires adapter from `@cogni/operator-wallet/adapters/privy`
  - [x] `pnpm check` passes, contract tests pass

- [x] **Checkpoint 3: Wire distribution trigger**
  - [x] `TreasurySettlementPort` — semantic port (`settleConfirmedCreditPurchase`)
  - [x] `SplitTreasurySettlementAdapter` — wraps `OperatorWalletPort.distributeSplit(USDC)`
  - [x] `confirmCreditsPurchase()` — application orchestrator in `features/payments/application/`
  - [x] Facade updated to use orchestrator, logs structured settlement outcome
  - [x] `scripts/distribute-split.ts` — manual CLI fallback
  - [x] 4 unit tests for orchestrator, facade test updated
  - [ ] Package extraction of payments application layer — follow-up (task.0146)

## Validation

```bash
pnpm check
pnpm test tests/unit/features/payments/application/confirmCreditsPurchase.spec.ts
pnpm test tests/unit/app/_facades/payments/credits.server.spec.ts
pnpm test tests/unit/features/payments/services/creditsConfirm.spec.ts
pnpm test tests/contract/operator-wallet.contract.test.ts
pnpm test tests/unit/packages/repo-spec/accessors.test.ts
```

## Review Checklist

- [ ] **Work Item:** `task.0085` linked in PR body
- [ ] **Spec:** Distribution uses `splitV2ABI` (not manual selectors), params derived from billing constants
- [ ] **Package:** `@cogni/operator-wallet` follows capability package pattern per packages-architecture spec
- [ ] **Tests:** Contract test passes, repo-spec accessor test passes
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Depends on: task.0084 (operator wallet foundation)
- Branch target: `feat/operator-wallet-v0` (not staging)

## Attribution

-
