---
id: task.0086
type: task
title: OpenRouter credit top-up via operator wallet
status: needs_implement
priority: 0
estimate: 2
summary: "Wire OpenRouter top-up into the credit purchase flow — calculateOpenRouterTopUp pricing, charge creation service, Step 4 in confirmCreditsPurchase, TigerBeetle co-writes for USDC movements."
outcome: Every confirmed credit purchase automatically tops up OpenRouter with the exact provider cost. TigerBeetle records the full USDC flow (Split distribute + provider top-up). No manual transfers.
spec_refs: web3-openrouter-payments, operator-wallet, financial-ledger
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch: feat/operator-wallet
pr:
reviewer:
created: 2026-02-17
updated: 2026-03-12
labels: [wallet, web3, billing, openrouter]
external_refs:
revision: 1
blocked_by:
deploy_verified: false
rank: 21
---

# OpenRouter credit top-up via operator wallet

## Already Built (PR #556, merged to feature branch)

Checkpoints 1-3 shipped the **adapter layer** — how to sign and submit the on-chain transaction:

- `TransferIntent` type matching actual OpenRouter `transfer_intent.call_data` shape
- `transferTokenPreApproved` ABI encoding in `packages/operator-wallet/src/domain/transfers-abi.ts`
- `fundOpenRouterTopUp()` in `PrivyOperatorWalletAdapter` — 5 validation gates (SENDER_MATCH, DESTINATION_ALLOWLIST, CHAIN_MISMATCH, MIN_TOPUP, MAX_TOPUP_CAP), ERC-20 approve + transferTokenPreApproved via Privy HSM
- 9 unit tests covering all validation gates + deadline parsing + happy path
- `OPERATOR_MAX_TOPUP_USD` env var (default 500)

## Design

### Outcome

After `confirmCreditsPurchase()` mints credits and distributes the Split, it also tops up OpenRouter with the exact provider cost. TigerBeetle records both USDC movements (Split distribute + provider top-up). The full payment chain is deterministic and synchronous.

### Approach

**Solution**: Expand `TreasurySettlementPort.settleConfirmedCreditPurchase()` to handle the full post-payment chain: Split distribute → OpenRouter top-up. The port already exists and is wired. The adapter already has `OperatorWalletPort`. Adding the top-up is a natural extension — both are "settle the financial implications of a credit purchase." No new ports, no Temporal workflows, no state machine in V0.

**Flow after this task:**

```
confirmCreditsPurchase()
  Step 1: creditAccount()          → PG + TB co-write (CREDIT ledger) ✅ exists
  Step 2: system tenant bonus      → PG + TB co-write (CREDIT ledger) ✅ exists
  Step 3: settleConfirmedCreditPurchase()
    3a: distributeSplit(USDC)      → on-chain tx                      ✅ exists
    3b: TB co-write                → Treasury → OperatorFloat (USDC)  🆕
    3c: createOpenRouterCharge()   → POST /api/v1/credits/coinbase    🆕
    3d: fundOpenRouterTopUp()      → approve + transfer via Privy     ✅ exists
    3e: TB co-write                → OperatorFloat → Expense (USDC)   🆕
  Return result
```

**Reuses**: Existing `TreasurySettlementPort` + `SplitTreasurySettlementAdapter`. Existing `OperatorWalletPort.fundOpenRouterTopUp()`. Existing `FinancialLedgerPort.transfer()`. Existing pricing constants (`USER_PRICE_MARKUP_FACTOR`, `SYSTEM_TENANT_REVENUE_SHARE`). Existing `OPERATOR_MAX_TOPUP_USD` env var. Experimental scripts (`scripts/experiments/openrouter-topup.ts`) as reference for charge creation.

**Rejected alternatives**:

- **Temporal workflow for top-up**: Adds async complexity, retry logic, state machine for a synchronous chain. The adapter already handles the multi-step tx (approve + transfer). Fire-and-forget with critical logging matches the co-write pattern everywhere else.
- **New ProviderTopUpPort**: Another port/adapter/test for one method call. The settlement port already handles "what happens to money after credits confirmed" — top-up is the next step in that same flow.
- **`outbound_topups` DB table + state machine**: V0 doesn't retry failed top-ups. TigerBeetle transfer + charge_receipt in Postgres provide audit trail. State machine adds complexity without value until we need retry logic (Walk).
- **Separate Step 4 in confirmCreditsPurchase**: Leaks OpenRouter charge creation into the orchestrator. The settlement adapter should handle the full chain — the orchestrator just calls `settleConfirmedCreditPurchase()`.

### Invariants

- [ ] TOPUP_FROM_CONSTANTS: `calculateOpenRouterTopUp()` derives amount from `MARKUP`, `REVENUE_SHARE`, `CRYPTO_FEE` — no hardcoded dollar amounts (spec: web3-openrouter-payments)
- [ ] MARGIN_PRESERVED: Startup check `MARKUP × (1 - FEE) > 1 + REVENUE_SHARE` — fail fast if DAO would lose money (spec: web3-openrouter-payments)
- [ ] SETTLEMENT_NON_BLOCKING: Top-up failure never blocks credit confirmation — log critical, continue (spec: financial-ledger, POST_CALL_NEVER_BLOCKS)
- [ ] CO_WRITE_NON_BLOCKING: TigerBeetle writes fire-and-forget, log critical on failure (spec: financial-ledger)
- [ ] DESTINATION_ALLOWLIST: Already enforced in adapter — contract must be `0x0305...` (spec: operator-wallet)
- [ ] SENDER_MATCH: Already enforced in adapter — intent sender must match wallet (spec: operator-wallet)
- [ ] MAX_TOPUP_CAP: Already enforced in adapter — per-tx ceiling (spec: operator-wallet)
- [ ] LEDGER_PORT_IS_WRITE_PATH: USDC movements recorded through FinancialLedgerPort (spec: financial-ledger)
- [ ] SIMPLE_SOLUTION: No new ports, no state machine, no Temporal — extends existing settlement adapter
- [ ] ARCHITECTURE_ALIGNMENT: Pure math in core, HTTP in adapter, settlement through port (spec: architecture)

### Files

- Modify: `apps/web/src/core/billing/pricing.ts` — add `calculateOpenRouterTopUp(paymentUsd, markupFactor, revenueShare, cryptoFee): number`
- Modify: `apps/web/src/shared/env/server-env.ts` — add `OPENROUTER_API_KEY` (optional), `OPENROUTER_CRYPTO_FEE` (default 0.05)
- Modify: `apps/web/src/ports/treasury-settlement.port.ts` — add `amountUsdCents` to context param, add optional `topUp` to outcome
- Modify: `apps/web/src/adapters/server/treasury/split-treasury-settlement.adapter.ts` — add charge creation + `fundOpenRouterTopUp()` + TB co-writes. Constructor gets `financialLedger`, `openRouterApiKey`, pricing config.
- Modify: `apps/web/src/bootstrap/container.ts` — pass new deps to `SplitTreasurySettlementAdapter`, add `MARGIN_PRESERVED` startup check
- Modify: `packages/financial-ledger/src/domain/accounts.ts` — add `EXPENSE_PROVIDER_TOPUP: 2003n` account ID on USDC ledger
- Modify: `apps/web/src/app/_facades/payments/credits.server.ts` — pass `amountUsdCents` in settlement context
- Test: `tests/unit/core/billing/pricing.test.ts` — `calculateOpenRouterTopUp` + margin check
- Test: `tests/contract/treasury-settlement.contract.test.ts` — settlement with top-up (FakeOperatorWallet + mocked OpenRouter API)

### N-API / TigerBeetle Timing Note

The split distribute tx is broadcast but may not be confirmed when `fundOpenRouterTopUp()` runs (~2s block time on Base L2). If the operator wallet has prior USDC balance, the top-up succeeds regardless. If not (fresh wallet, first payment), the top-up may fail due to insufficient USDC. This is acceptable for V0 — non-blocking error handling catches it, and the wallet accumulates balance quickly. Walk phase can add confirmation waiting if needed.

### TigerBeetle Accounts

The financial-ledger MVP has 5 accounts. This task adds 1:

```
; --- Ledger 2: USDC ---
EXPENSE_PROVIDER_TOPUP: 2003n  ; USDC sent to OpenRouter for AI credits
```

Two new USDC-ledger transfers per credit purchase:

1. `ASSETS_TREASURY (2001n) → ASSETS_OPERATOR_FLOAT (2002n)` — Split distribute (code: `SPLIT_DISTRIBUTE = 3`)
2. `ASSETS_OPERATOR_FLOAT (2002n) → EXPENSE_PROVIDER_TOPUP (2003n)` — Provider top-up (code: `PROVIDER_TOPUP = 4`)

Transfer codes already defined in `accounts.ts`.

## Requirements

- **R1**: `calculateOpenRouterTopUp(paymentUsd, markupFactor, revenueShare, cryptoFee)` pure function — returns gross top-up amount in USD
- **R2**: `OPENROUTER_API_KEY` env var (optional — top-up skipped when not set)
- **R3**: `OPENROUTER_CRYPTO_FEE` env var (default 0.05 — 5%)
- **R4**: `MARGIN_PRESERVED` startup assertion — fail fast if pricing constants don't preserve positive margin
- **R5**: OpenRouter charge creation in adapter — `POST /api/v1/credits/coinbase` with `{ amount, sender, chain_id: 8453 }`
- **R6**: `fundOpenRouterTopUp(intent)` called with charge's `transfer_intent` — already implemented
- **R7**: TigerBeetle co-write for Split distribute: `ASSETS_TREASURY → ASSETS_OPERATOR_FLOAT` on USDC ledger
- **R8**: TigerBeetle co-write for provider top-up: `ASSETS_OPERATOR_FLOAT → EXPENSE_PROVIDER_TOPUP` on USDC ledger
- **R9**: `EXPENSE_PROVIDER_TOPUP: 2003n` account added to financial-ledger domain
- **R10**: All failures non-blocking — log critical, return settlement outcome (split tx always returned even if top-up fails)

## Allowed Changes

- `apps/web/src/core/billing/pricing.ts` (add calculateOpenRouterTopUp)
- `apps/web/src/shared/env/server-env.ts` (add OPENROUTER_API_KEY, OPENROUTER_CRYPTO_FEE)
- `apps/web/src/ports/treasury-settlement.port.ts` (expand context + outcome)
- `apps/web/src/adapters/server/treasury/split-treasury-settlement.adapter.ts` (add top-up + TB co-writes)
- `apps/web/src/bootstrap/container.ts` (wire new deps, margin check)
- `apps/web/src/app/_facades/payments/credits.server.ts` (pass amountUsdCents)
- `apps/web/src/features/payments/application/confirmCreditsPurchase.ts` (pass amountUsdCents in settlement context)
- `packages/financial-ledger/src/domain/accounts.ts` (add EXPENSE_PROVIDER_TOPUP)
- `tests/` (unit + contract tests)

## Plan

- [ ] **Step 1: Pricing + env**
  - [ ] Add `calculateOpenRouterTopUp()` to `pricing.ts`
  - [ ] Add `OPENROUTER_API_KEY`, `OPENROUTER_CRYPTO_FEE` to `server-env.ts`
  - [ ] Unit tests for pricing function + edge cases

- [ ] **Step 2: Port + domain expansion**
  - [ ] Add `amountUsdCents` to `TreasurySettlementPort` context
  - [ ] Add `topUp?: { txHash: string; amountUsd: number }` to `TreasurySettlementOutcome`
  - [ ] Add `EXPENSE_PROVIDER_TOPUP: 2003n` to `accounts.ts`
  - [ ] Update `confirmCreditsPurchase` + facade to pass `amountUsdCents` through

- [ ] **Step 3: Settlement adapter expansion**
  - [ ] Add constructor deps: `financialLedger`, `openRouterApiKey`, pricing config
  - [ ] After `distributeSplit()`: TB co-write Treasury → OperatorFloat (non-blocking)
  - [ ] Create OpenRouter charge via `POST /api/v1/credits/coinbase`
  - [ ] Call `fundOpenRouterTopUp(intent)` with charge's transfer_intent
  - [ ] After top-up: TB co-write OperatorFloat → ExpenseProviderTopup (non-blocking)
  - [ ] Return extended outcome with `topUp` field
  - [ ] All failures wrapped in try/catch — log critical, don't throw

- [ ] **Step 4: Container wiring + startup check**
  - [ ] Pass `financialLedger`, `openRouterApiKey`, pricing config to `SplitTreasurySettlementAdapter`
  - [ ] Add `MARGIN_PRESERVED` startup assertion in container.ts

- [ ] **Step 5: Tests**
  - [ ] Unit: `calculateOpenRouterTopUp` default constants ($1.00 → $0.9211), edge cases
  - [ ] Unit: margin check (valid/invalid constant combos)
  - [ ] Contract: settlement with top-up using FakeOperatorWallet

## Validation

```bash
pnpm check
pnpm test tests/unit/core/billing/pricing.test.ts
pnpm test tests/contract/treasury-settlement.contract.test.ts
```

**Expected:** calculateOpenRouterTopUp returns correct values. Margin check fails fast with bad constants. Settlement adapter creates charge + submits tx + records TB transfers. All failures non-blocking.

## Review Checklist

- [ ] **Work Item:** `task.0086` linked in PR body
- [ ] **Spec:** TOPUP_FROM_CONSTANTS, MARGIN_PRESERVED, SETTLEMENT_NON_BLOCKING, CO_WRITE_NON_BLOCKING, LEDGER_PORT_IS_WRITE_PATH invariants upheld
- [ ] **Tests:** calculateOpenRouterTopUp unit + margin check + settlement contract test
- [ ] **Architecture:** Pure math in core, charge creation + tx submission in adapter, settlement through port
- [ ] **Non-blocking:** All co-writes and top-up fire-and-forget, log critical on failure

## PR / Links

- Previous PR: [#556](https://github.com/Cogni-DAO/node-template/pull/556) (adapter layer — merged)
- Depends on: task.0145 (TigerBeetle — PR #559, targeting feature branch)
- Branch target: `feat/operator-wallet` (not staging)

## Attribution

-
