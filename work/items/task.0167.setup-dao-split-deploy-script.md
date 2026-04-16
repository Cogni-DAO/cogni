---
id: task.0167
type: task
title: "Node activation: payments.status in repo-spec + pnpm node:activate-payments"
status: done
priority: 1
rank: 15
estimate: 2
summary: "Formation outputs payments.status: pending_activation. One CLI command activates payments by provisioning operator wallet, deploying Split, validating on-chain, and writing repo-spec in place."
outcome: "Fork owners run one command to activate payments. repo-spec is the single source of truth for activation state."
spec_refs: operator-wallet, node-formation
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch: feat/setup-dao-script
pr: https://github.com/Cogni-DAO/node-template/pull/583
reviewer:
revision: 5
blocked_by:
deploy_verified: false
created: 2026-03-15
updated: 2026-03-24
labels: [wallet, web3, tooling, setup]
external_refs:
---

# Node activation: payments.status in repo-spec + pnpm node:activate-payments

## Context

Formation (shared operator UI) creates governance identity. Payment activation (Privy wallet + Split) belongs to the child node. Today these are scattered ad-hoc scripts. This task adds explicit activation state to repo-spec and one guided CLI command.

## Design

### Formation output change

`buildRepoSpecYaml` adds:

```yaml
payments:
  status: pending_activation
```

### Activation command

`pnpm node:activate-payments` — reads repo-spec, provisions wallet, deploys Split, writes repo-spec in place.

**Inputs from env:**

- `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_SIGNING_KEY` — wallet provisioning
- `DEPLOYER_PRIVATE_KEY` — funded EOA for Split deployment gas
- `EVM_RPC_URL` — Base RPC

**Inputs from repo-spec (single source of truth):**

- `cogni_dao.dao_contract` — DAO treasury recipient for Split

**Explicit input with default:**

- Split controller/owner: the operator wallet address (from repo-spec). Enables programmatic allocation updates.

**Operator wallet selection:**

- 0 wallets in Privy → create one
- 1 wallet → use it
- > 1 wallets → error, require `OPERATOR_WALLET_ADDRESS` env to disambiguate

**Validation:**

- Read deployed Split config back on-chain
- Verify recipients match operator wallet + DAO treasury
- Verify allocations match billing constants

**Output:**

- Writes `.cogni/repo-spec.yaml` in place with:
  - `operator_wallet.address`
  - `payments_in.credits_topup` section
  - `payments.status: active`
- Prints summary

### What constitutes "payments active"

repo-spec must have all of:

- `payments.status: active`
- `operator_wallet.address` — Privy-managed EOA
- `payments_in.credits_topup.receiving_address` — Split contract
- `payments_in.credits_topup.provider` — e.g. `cogni-usdc-backend-v1`
- `payments_in.credits_topup.allowed_chains` + `allowed_tokens`

## Requirements

- **R1**: `buildRepoSpecYaml` outputs `payments.status: pending_activation`
- **R2**: `pnpm node:activate-payments` reads DAO treasury from repo-spec, not env
- **R3**: Split controller is the operator wallet (from repo-spec), not the deployer
- **R4**: Operator wallet: create if 0 in Privy, use if 1, error if >1 without explicit selection
- **R5**: Validate deployed Split by reading config back on-chain (not simulate distribute)
- **R6**: Write repo-spec in place (not print-to-paste)
- **R7**: Each step idempotent (safe to re-run)
- **R8**: Document formation→activation boundary in node-formation spec

## Allowed Changes

- `apps/operator/src/app/api/setup/verify/route.ts` — `buildRepoSpecYaml` adds payments.status
- `scripts/node-activate-payments.ts` (new)
- `package.json` — add `node:activate-payments` script
- `docs/spec/node-formation.md` — activation boundary section
- `docs/guides/operator-wallet-setup.md` — simplify to reference new command
- `packages/repo-spec/src/schema.ts` — add `payments` field to schema if needed

## Plan

- [ ] Add `payments.status` to repo-spec schema (if needed for validation)
- [ ] Update `buildRepoSpecYaml` to include `payments.status: pending_activation`
- [ ] Create `scripts/node-activate-payments.ts`
- [ ] Add `node:activate-payments` to package.json
- [ ] Update node-formation spec with activation boundary
- [ ] Simplify operator-wallet-setup guide
- [ ] Run `pnpm check`

## Validation

```bash
pnpm check
pnpm dotenv -e .env.local -- pnpm node:activate-payments
```

## Review Checklist

- [ ] **Work Item:** `task.0167` linked in PR body
- [ ] **Spec:** formation→activation boundary documented
- [ ] **Tests:** existing verify contract tests still pass
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Fixes: bug.0166 design gap (ad-hoc Split deployment with wrong addresses)

## Attribution

-
