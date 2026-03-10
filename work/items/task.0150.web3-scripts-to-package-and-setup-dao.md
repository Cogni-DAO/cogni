---
id: task.0150
type: task
title: Operator wallet + splits setup wizard (following DAO formation pattern)
status: needs_design
priority: 2
estimate: 5
summary: Add operator wallet provisioning and Split contract deployment as a setup wizard step in src/features/setup/, following the established DAO formation pattern. Replace standalone scripts with UI-driven flow + server-side verification.
outcome: Fork owners complete operator wallet + Split deployment via a setup wizard page. Server verifies receipts, derives addresses, writes repo-spec. Scripts become thin CLI fallbacks importing from the feature.
spec_refs: operator-wallet, node-formation, packages-architecture
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch:
pr:
reviewer:
created: 2026-03-10
updated: 2026-03-10
labels: [wallet, web3, setup]
external_refs:
revision: 1
blocked_by:
deploy_verified: false
rank: 40
---

# Operator wallet + splits setup wizard

> Follow-up from task.0085. The operator wallet provisioning and Split deployment are standalone scripts that print manual next-steps. They should follow the established DAO formation pattern: UI wizard → txBuilders → server verify → write repo-spec.

## Problem

The DAO formation flow (`src/features/setup/daoFormation/`) already solves this exact problem for Aragon contracts:
- Pure `txBuilders` for ABI encoding
- `formation.reducer` state machine driving a multi-tx wizard
- Server-side receipt verification (never trusts client addresses)
- Generates repo-spec YAML automatically

But operator wallet + Split deployment (`scripts/provision-operator-wallet.ts`, `scripts/deploy-split.ts`) bypasses all of this:
- Inline `main()` with `process.exit` and `console.log` — not importable
- Prints "copy-paste this address into repo-spec.yaml" — manual glue
- No server verification of the deployed Split's allocations
- No UI — requires CLI + env vars + private key handling

## Design Direction

### Follow the DAO formation pattern

Add a new setup step (likely `/setup/operator-wallet` or extend the existing formation flow):

| Layer | DAO Formation (existing) | Operator Wallet Setup (new) |
|-------|--------------------------|---------------------------|
| **txBuilders** | `buildCreateDaoArgs()`, `buildDeploySignalArgs()` | `buildDeploySplitArgs()` (from billing constants) |
| **Reducer** | `formationReducer` — 8 phases, 2 txns | New reducer — provision wallet (API) → deploy Split (1 txn) |
| **Server verify** | Decode receipts, verify balances, verify CogniSignal.DAO() | Decode receipt, verify Split allocations match billing constants, verify recipients |
| **Repo-spec output** | Generates `cogni_dao` section | Generates `operator_wallet.address` + updates `receiving_address` |
| **Packages** | `@cogni/aragon-osx` (encoding, receipts), `@cogni/cogni-contracts` (ABI) | `@cogni/operator-wallet` (split math, adapter) — extend with Split ABI encoding + receipt decoding |

### Key differences from DAO formation

- **Privy wallet provisioning is an API call, not a wallet transaction.** The user doesn't sign a tx — the server creates a Privy-managed wallet via API. This is Step 1 before any on-chain work.
- **Split deployment uses a deployer EOA or Privy wallet.** The connected browser wallet may not be the deployer — need to handle this.
- **`distribute-split` is operational, not setup.** It's a recurring action, not a one-time deploy. Stays as a CLI script (or becomes a scheduled activity) — not part of the setup wizard.

### Package work

Extend `@cogni/operator-wallet` with:
- `src/domain/split-encoding.ts` — pure `buildDeploySplitArgs()` using `splitV2o2FactoryAbi`
- `src/domain/split-receipt.ts` — `decodeSplitDeployReceipt()` (extract Split address from SplitCreated event)

This mirrors how `@cogni/aragon-osx` has `encoding.ts` + `osx/receipt.ts`.

### Scripts become thin CLIs

After extraction, `scripts/deploy-split.ts` becomes a 20-line CLI wrapper that imports from `@cogni/operator-wallet` and calls the same functions the setup wizard uses. Useful for operators who prefer CLI, but no longer the primary path.

## Design Questions

- [ ] **Single page or multi-step?** Is operator wallet setup a new page (`/setup/operator-wallet`) or a continuation of the DAO formation wizard (step 3 after DAO + Signal)?
- [ ] **Privy provisioning UX** — who triggers it? The setup wizard page calls a server action that hits Privy API? Or is it a pre-req the operator does separately?
- [ ] **Deployer key handling** — DAO formation uses the connected browser wallet. Split deployment currently uses `DEPLOYER_PRIVATE_KEY` env var. Should the setup wizard use the connected wallet too? Or keep it server-side via Privy?
- [ ] **`scripts/experiments/` cleanup** — spike scripts (`full-chain.ts`, `splits-deploy.ts`) now duplicate package logic. Delete, or keep as manual test fixtures?

## Requirements

- [ ] `buildDeploySplitArgs()` — pure function in `@cogni/operator-wallet`, derives from billing constants
- [ ] `decodeSplitDeployReceipt()` — extract Split address from SplitCreated event
- [ ] Server-side verification: decode receipt, verify allocations match billing constants, verify recipients are operator + DAO treasury
- [ ] Setup page/wizard step with state machine (reducer pattern)
- [ ] Server writes `operator_wallet.address` and `receiving_address` to repo-spec
- [ ] Idempotent: skip if addresses already non-placeholder
- [ ] Existing scripts refactored to thin CLI wrappers importing from package

## Validation

```bash
pnpm check
pnpm test tests/unit/packages/operator-wallet/
pnpm test tests/unit/features/setup/
```

## Attribution

-
