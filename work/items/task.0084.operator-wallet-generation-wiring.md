---
id: task.0084
type: task
title: Operator wallet provisioning + wiring into existing payment flow
status: needs_design
priority: 0
estimate: 2
summary: Provision operator wallet via Privy API, create OperatorWalletPort, wire operator wallet as receiving address — existing payment flow works unchanged.
outcome: Users pay USDC to operator wallet instead of DAO wallet. Privy-managed wallet verified at startup against repo-spec. OperatorWalletPort interface ready for PR 2/3.
spec_refs: operator-wallet
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch:
pr:
reviewer:
created: 2026-02-17
updated: 2026-02-18
labels: [wallet, web3, billing]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 19
---

# Operator wallet provisioning + wiring into existing payment flow

## Requirements

- `scripts/provision-operator-wallet.ts` creates an operator wallet via Privy server wallet API and prints the checksummed address to stdout
- Privy credentials read from env vars (`PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_SIGNING_KEY`) — no local key material
- `OperatorWalletPort` interface defined in `src/ports/operator-wallet.port.ts` with `getAddress()`, `sweepUsdcToTreasury()`, `fundOpenRouterTopUp()` method stubs
- `PrivyOperatorWalletAdapter` in `src/adapters/server/wallet/privy-operator-wallet.adapter.ts` connects to Privy at startup, verifies wallet address matches `operator_wallet.address` from repo-spec
- `FakeOperatorWalletAdapter` in `src/adapters/test/wallet/` for CI (APP_ENV=test)
- `operator_wallet.address` added to `.cogni/repo-spec.yaml` schema + validation
- `RECEIVING_ADDRESS_MATCH` invariant enforced: startup check that `payments_in.credits_topup.receiving_address === operator_wallet.address`
- New env vars: `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_SIGNING_KEY` (optional — only required when operator wallet features are enabled)
- `ADDRESS_VERIFIED_AT_STARTUP` invariant: Privy-reported address vs repo-spec mismatch → fail fast
- `KEY_NEVER_IN_APP` invariant: no raw private key material in the application process
- Existing payment flow (intent → sign → verify → credits) works unchanged — only `receiving_address` value changes

## Allowed Changes

- `scripts/provision-operator-wallet.ts` (new)
- `src/ports/operator-wallet.port.ts` (new)
- `src/ports/index.ts` (add export)
- `src/adapters/server/wallet/privy-operator-wallet.adapter.ts` (new)
- `src/adapters/server/index.ts` (add export)
- `src/adapters/test/wallet/fake-operator-wallet.adapter.ts` (new)
- `src/adapters/test/index.ts` (add export)
- `src/shared/config/repoSpec.schema.ts` (add operator_wallet schema)
- `src/shared/config/repoSpec.server.ts` (add getOperatorWalletConfig)
- `src/shared/env/server-env.ts` (add PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_SIGNING_KEY)
- `src/bootstrap/container.ts` (wire adapter)
- `.cogni/repo-spec.yaml` (add operator_wallet section — placeholder address for dev)
- `tests/` (unit tests for provisioning script, port contract test, adapter test)

## Plan

- [ ] Read existing `onchain-verifier.port.ts` and `repoSpec.schema.ts` patterns for port + config conventions
- [ ] Define `OperatorWalletPort` interface in `src/ports/operator-wallet.port.ts` — `getAddress()`, `sweepUsdcToTreasury(amountRaw, reference)`, `fundOpenRouterTopUp(intent)` (PR 2/3 will implement the methods; this PR defines the interface)
- [ ] Add `operator_wallet` schema to `repoSpec.schema.ts` with `address` field validation
- [ ] Add `getOperatorWalletConfig()` to `repoSpec.server.ts`
- [ ] Add startup validation: `receiving_address === operator_wallet.address` (RECEIVING_ADDRESS_MATCH)
- [ ] Add env vars `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_SIGNING_KEY` to `server-env.ts` (all optional)
- [ ] Create `PrivyOperatorWalletAdapter` — constructor connects to Privy, verifies wallet address
- [ ] Create `FakeOperatorWalletAdapter` for test mode
- [ ] Wire in `container.ts` — conditional on Privy env vars being set (graceful skip if not configured)
- [ ] Write `scripts/provision-operator-wallet.ts` using `@privy-io/server-auth` SDK to create wallet
- [ ] Add `operator_wallet` section to `.cogni/repo-spec.yaml` with placeholder address
- [ ] Write port contract test (`tests/contract/operator-wallet.contract.ts`)
- [ ] Write unit test for provisioning script
- [ ] Run `pnpm check` to verify no lint/type/architecture violations

## Validation

**Commands:**

```bash
pnpm check
pnpm test tests/contract/operator-wallet.contract.ts
pnpm test tests/unit/scripts/provision-operator-wallet.test.ts
```

**Expected:** All tests pass. `pnpm check` clean. No dependency-cruiser violations.

## Review Checklist

- [ ] **Work Item:** `task.0084` linked in PR body
- [ ] **Spec:** KEY_NEVER_IN_APP, ADDRESS_VERIFIED_AT_STARTUP, NO_GENERIC_SIGNING, RECEIVING_ADDRESS_MATCH invariants upheld
- [ ] **Tests:** Port contract test + provisioning script test + startup validation test
- [ ] **Reviewer:** assigned and approved
- [ ] **Architecture:** Port in `src/ports/`, adapter in `src/adapters/server/wallet/`, no layer violations

## PR / Links

- Handoff: [handoff](../handoffs/task.0084.handoff.md)

## Attribution

-
