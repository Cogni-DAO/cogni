---
id: task.0086
type: task
title: OpenRouter credit top-up via operator wallet
status: done
priority: 0
estimate: 2
summary: "Wire OpenRouter top-up into credit purchase flow — `runPostCreditFunding()` extracted and invoked from `verifyAndSettle()` (the canonical CREDITED transition). Composes TreasurySettlementPort + ProviderFundingPort + FinancialLedgerPort. Durable funding attempt row, deterministic TB transfer IDs, correct asset-swap accounting."
outcome: "Every confirmed on-chain USDC payment automatically tops up OpenRouter with the exact provider cost. runPostCreditFunding fires from verifyAndSettle on CREDITED transition (exactly once via state guard). Durable provider_funding_attempts row enables crash recovery. TigerBeetle records USDC movements as asset swaps (OperatorFloat to ProviderFloat). P1 follow-up: funding reconciler for crash window."
spec_refs: web3-openrouter-payments, operator-wallet, financial-ledger
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch: feat/operator-wallet-e2e
pr: https://github.com/Cogni-DAO/node-template/pull/576
reviewer:
created: 2026-02-17
updated: 2026-03-24
labels: [wallet, web3, billing, openrouter]
external_refs:
revision: 3
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

After `confirmCreditsPurchase()` mints credits and distributes the Split, it also tops up OpenRouter with the exact provider cost. TigerBeetle records USDC movements as asset swaps. A durable Postgres row enables crash recovery with deterministic TB transfer IDs.

### Approach

**Solution**: The existing `confirmCreditsPurchase` application orchestrator composes three ports: `TreasurySettlementPort` (Split distribution — unchanged), a new `ProviderFundingPort` (OpenRouter charge creation + funding), and `FinancialLedgerPort` (TB co-writes). Each port stays boundary-clean. A `provider_funding_attempts` row keyed by `paymentIntentId` provides crash recovery — if the process dies between steps, retry finds the existing row and resumes from the last completed step. TB transfer IDs are deterministic: derived from `(paymentIntentId, step)`.

**Flow after this task:**

```
confirmCreditsPurchase() — application orchestrator
  Step 1: creditAccount()                           → PG + TB (CREDIT)  ✅ exists
  Step 2: system tenant bonus                       → PG + TB (CREDIT)  ✅ exists
  Step 3: treasurySettlement.settle()               → distributeSplit   ✅ exists
  Step 4: financialLedger.transfer()                → Treasury → OperatorFloat (USDC)  🆕
  Step 5: providerFunding.fundAfterCreditPurchase() → create/reuse charge + fund  🆕
       5a: upsert provider_funding_attempts row (PENDING)
       5b: createOpenRouterCharge() or reuse existing charge_id
       5c: operatorWallet.fundOpenRouterTopUp(intent)
       5d: update row → FUNDED (store tx_hash)
  Step 6: financialLedger.transfer()                → OperatorFloat → ProviderFloat (USDC)  🆕
  All post-settlement steps non-blocking — log critical on failure
```

**Key design corrections (revision 2):**

1. **Port boundary**: `TreasurySettlementPort` stays treasury-scoped (Split distribution only). OpenRouter funding lives in a separate `ProviderFundingPort`. The orchestrator composes both — no provider logic leaks into the treasury boundary.

2. **Correct accounting**: A top-up is a prepaid asset, NOT an expense. `OperatorFloat:USDC → ProviderFloat:USDC` (asset swap). Expense booking happens later on usage/reconciliation (`ProviderFloat → Expense:ModelSpend`). The spec's current `Expense:AI:OpenRouter` line is wrong — update it.

3. **Durable state**: `provider_funding_attempts` row keyed deterministically by `paymentIntentId`. On crash recovery, the row tells us where we left off — charge already created? reuse `charge_id`. Already funded? skip. TB transfer IDs derived from `(paymentIntentId, step_code)` via deterministic hash → idempotent against double-posting.

**Reuses**: Existing `confirmCreditsPurchase` orchestrator. Existing `OperatorWalletPort.fundOpenRouterTopUp()`. Existing `FinancialLedgerPort.transfer()`. Existing pricing constants. Experimental scripts as reference for charge creation.

**Rejected alternatives**:

- **Temporal workflow**: Adds async complexity for a synchronous chain. Adapter already handles multi-step tx. The durable row + deterministic IDs give us crash recovery without a workflow engine.
- **Expand TreasurySettlementPort**: Hard-bakes one provider into the wrong boundary. Treasury settlement is about routing revenue to DAO. Provider funding is about provisioning AI service. Different concerns, different ports.
- **No DB record (logs + TB only)**: Insufficient for crash recovery. If `createOpenRouterCharge()` succeeds and process dies before `fundOpenRouterTopUp()`, we lose the charge_id. If funding succeeds and the TB post-write dies, we can't recover the transfer ID. The durable row solves both.
- **`Expense:AI:OpenRouter` account**: Wrong accounting. A prepayment converts one asset to another. Expense is recognized on consumption, not on prepayment.

### Invariants

- [ ] PORT_BOUNDARY_CLEAN: TreasurySettlementPort stays treasury-scoped. Provider funding is a separate port. Orchestrator composes both (spec: architecture)
- [ ] ASSET_SWAP_NOT_EXPENSE: Top-up posts OperatorFloat → ProviderFloat (asset-to-asset). Expense on usage/reconciliation only (spec: financial-ledger, DOUBLE_ENTRY_CANONICAL)
- [ ] DETERMINISTIC_IDS: TB transfer IDs via `uuid5(TB_TRANSFER_NAMESPACE, paymentIntentId + ":" + stepCode)` → u128. Namespace constant in financial-ledger domain. Idempotent on retry (spec: financial-ledger)
- [ ] DURABLE_FUNDING_ROW: provider_funding_attempts row keyed by paymentIntentId enables crash recovery. Charge reuse on retry
- [ ] TOPUP_FROM_CONSTANTS: `calculateOpenRouterTopUp()` derives amount from `MARKUP`, `REVENUE_SHARE`, `CRYPTO_FEE` — no hardcoded dollar amounts (spec: web3-openrouter-payments)
- [ ] MARGIN_PRESERVED: Startup check `MARKUP × (1 - FEE) > 1 + REVENUE_SHARE` — fail fast if DAO would lose money (spec: web3-openrouter-payments)
- [ ] SETTLEMENT_NON_BLOCKING: Steps 4-6 never block credit confirmation — log critical, continue (spec: financial-ledger, POST_CALL_NEVER_BLOCKS)
- [ ] CO_WRITE_NON_BLOCKING: TigerBeetle writes fire-and-forget, log critical on failure (spec: financial-ledger)
- [ ] LEDGER_PORT_IS_WRITE_PATH: USDC movements recorded through FinancialLedgerPort (spec: financial-ledger)
- [ ] SIMPLE_SOLUTION: No Temporal, minimal new abstractions. Durable row is the minimum needed for correctness
- [ ] ARCHITECTURE_ALIGNMENT: Pure math in core, HTTP + chain in adapter, orchestration in application (spec: architecture)

### Files

- Create: `apps/operator/src/ports/provider-funding.port.ts` — `ProviderFundingPort` interface with `fundAfterCreditPurchase(context)`. Provider-agnostic (OpenRouter today, other providers tomorrow)
- Create: `apps/operator/src/adapters/server/treasury/openrouter-funding.adapter.ts` — implements `ProviderFundingPort`. Composes OpenRouter charge creation + `OperatorWalletPort.fundOpenRouterTopUp()`. Manages `provider_funding_attempts` row. Error logging distinguishes `reasonCode: "insufficient_balance_timing"` (transient — split tx not yet confirmed, wallet will have funds shortly) from `reasonCode: "funding_failed"` (real failure)
- Modify: `apps/operator/src/core/billing/pricing.ts` — add `calculateOpenRouterTopUp(paymentUsd, markupFactor, revenueShare, cryptoFee): number`
- Modify: `apps/operator/src/shared/env/server-env.ts` — add `OPENROUTER_API_KEY` (optional), `OPENROUTER_CRYPTO_FEE` (default 0.05)
- Modify: `apps/operator/src/features/payments/application/confirmCreditsPurchase.ts` — add Steps 4-6 composing `FinancialLedgerPort` + `ProviderFundingPort`. Deps object instead of positional params
- Modify: `apps/operator/src/app/_facades/payments/credits.server.ts` — pass new deps from container
- Modify: `apps/operator/src/bootstrap/container.ts` — wire `ProviderFundingPort`, `MARGIN_PRESERVED` startup check
- Modify: `packages/financial-ledger/src/domain/accounts.ts` — add `ASSETS_PROVIDER_FLOAT: 2003n` on USDC ledger (asset, not expense)
- Modify: `apps/operator/src/shared/db/schema.billing.ts` — add `provider_funding_attempts` table
- Modify: `apps/operator/src/adapters/server/db/migrations/` — new migration for `provider_funding_attempts`
- Modify: `apps/operator/src/ports/index.ts` — export new port
- Modify: `docs/spec/financial-ledger.md` — fix OpenRouter top-up row: `Expense:AI:OpenRouter` → `Assets:ProviderFloat:USDC`
- Test: `tests/unit/core/billing/pricing.test.ts` — `calculateOpenRouterTopUp` + margin check
- Test: `tests/contract/provider-funding.contract.test.ts` — funding with FakeOperatorWallet + deterministic IDs

### TigerBeetle Accounts

The financial-ledger MVP has 5 accounts. This task adds 1:

```
; --- Ledger 2: USDC ---
Assets:ProviderFloat:USDC   ; 2003n — Prepaid provider credits (OpenRouter). Asset, not expense.
                            ; Expense recognized on usage/reconciliation (Walk phase).
```

Two new USDC-ledger transfers per credit purchase:

1. `ASSETS_TREASURY (2001n) → ASSETS_OPERATOR_FLOAT (2002n)` — Split distribute (code: `SPLIT_DISTRIBUTE = 3`)
2. `ASSETS_OPERATOR_FLOAT (2002n) → ASSETS_PROVIDER_FLOAT (2003n)` — Provider top-up (code: `PROVIDER_TOPUP = 4`)

Transfer IDs deterministic: `uuid5(TB_TRANSFER_NAMESPACE, paymentIntentId + ":" + stepCode)` → u128. The namespace constant (`TB_TRANSFER_NAMESPACE`) is a well-known UUID defined in the financial-ledger domain. uuid5 gives deterministic IDs with negligible collision risk vs raw hash truncation.

### Durable State: `provider_funding_attempts`

```sql
CREATE TABLE provider_funding_attempts (
  id              UUID PRIMARY KEY,     -- deterministic from paymentIntentId
  payment_intent_id TEXT NOT NULL UNIQUE, -- idempotency key
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | charge_created | funded | failed
  provider        TEXT NOT NULL DEFAULT 'openrouter',
  charge_id       TEXT,                 -- OpenRouter charge ID (reuse on retry)
  charge_expires_at TIMESTAMPTZ,
  amount_usdc_micro BIGINT,             -- gross top-up amount (scale=6)
  funding_tx_hash TEXT,                 -- on-chain tx hash
  error_message   TEXT,                 -- last error if failed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

On crash recovery: lookup by `paymentIntentId` → resume from last status. `charge_created` → reuse `charge_id` (skip re-creation). `funded` → skip entirely.

## Requirements

- **R1**: `calculateOpenRouterTopUp(paymentUsd, markupFactor, revenueShare, cryptoFee)` pure function — returns gross top-up amount in USD
- **R2**: `OPENROUTER_API_KEY` env var (optional — provider funding skipped when not set)
- **R3**: `OPENROUTER_CRYPTO_FEE` env var (default 0.05 — 5%)
- **R4**: `MARGIN_PRESERVED` startup assertion — fail fast if pricing constants don't preserve positive margin
- **R5**: `ProviderFundingPort` interface — `fundAfterCreditPurchase(context)` with `paymentIntentId` + `amountUsdCents`
- **R6**: `OpenRouterFundingAdapter` — creates charge, calls `fundOpenRouterTopUp()`, manages `provider_funding_attempts` row
- **R7**: `provider_funding_attempts` table — keyed by `paymentIntentId`, tracks status for crash recovery
- **R8**: TigerBeetle transfer: `ASSETS_TREASURY → ASSETS_OPERATOR_FLOAT` on USDC ledger (Split distribute)
- **R9**: TigerBeetle transfer: `ASSETS_OPERATOR_FLOAT → ASSETS_PROVIDER_FLOAT` on USDC ledger (provider top-up)
- **R10**: `ASSETS_PROVIDER_FLOAT: 2003n` — new asset account (prepaid, not expense)
- **R11**: Deterministic TB transfer IDs from `(paymentIntentId, step_code)`
- **R12**: All Steps 4-6 non-blocking — log critical, don't throw to user
- **R13**: Update spec `financial-ledger.md` — fix OpenRouter row accounting

## Allowed Changes

- `apps/operator/src/ports/provider-funding.port.ts` (new — ProviderFundingPort interface)
- `apps/operator/src/ports/index.ts` (export new port)
- `apps/operator/src/adapters/server/treasury/openrouter-funding.adapter.ts` (new — OpenRouter adapter)
- `apps/operator/src/core/billing/pricing.ts` (add calculateOpenRouterTopUp)
- `apps/operator/src/shared/env/server-env.ts` (add OPENROUTER_API_KEY, OPENROUTER_CRYPTO_FEE)
- `apps/operator/src/shared/db/schema.billing.ts` (add provider_funding_attempts table)
- `apps/operator/src/adapters/server/db/migrations/` (new migration)
- `apps/operator/src/features/payments/application/confirmCreditsPurchase.ts` (compose new ports)
- `apps/operator/src/app/_facades/payments/credits.server.ts` (pass new deps)
- `apps/operator/src/bootstrap/container.ts` (wire ProviderFundingPort, margin check)
- `packages/financial-ledger/src/domain/accounts.ts` (add ASSETS_PROVIDER_FLOAT)
- `docs/spec/financial-ledger.md` (fix accounting for OpenRouter top-up row)
- `tests/` (unit + contract tests)

## Plan

- [ ] **Step 1: Pricing + env**
  - [ ] Add `calculateOpenRouterTopUp()` to `pricing.ts`
  - [ ] Add `OPENROUTER_API_KEY`, `OPENROUTER_CRYPTO_FEE` to `server-env.ts`
  - [ ] Unit tests for pricing function + edge cases
  - [ ] `MARGIN_PRESERVED` startup check in `container.ts`

- [ ] **Step 2: Port + domain**
  - [ ] Create `ProviderFundingPort` interface in `src/ports/provider-funding.port.ts`
  - [ ] Add `ASSETS_PROVIDER_FLOAT: 2003n` to `accounts.ts` + `ACCOUNT_DEFINITIONS`
  - [ ] Export from `src/ports/index.ts`

- [ ] **Step 3: DB + adapter**
  - [ ] Add `provider_funding_attempts` table to `schema.billing.ts` + migration
  - [ ] Create `OpenRouterFundingAdapter` — charge creation + funding + durable row
  - [ ] Deterministic TB transfer ID generation from (paymentIntentId, step_code)

- [ ] **Step 4: Orchestrator wiring**
  - [ ] Expand `confirmCreditsPurchase` — add Steps 4-6 (TB co-writes + provider funding)
  - [ ] Refactor to deps object (too many positional params)
  - [ ] Update facade to pass new deps from container
  - [ ] Wire `ProviderFundingPort` in `container.ts`

- [ ] **Step 5: Spec + tests**
  - [ ] Fix `financial-ledger.md` — OpenRouter row: Expense → Assets:ProviderFloat
  - [ ] Unit: `calculateOpenRouterTopUp` default constants ($1.00 → $0.9211), edge cases
  - [ ] Contract: provider funding with FakeOperatorWallet + deterministic IDs

## Validation

```bash
pnpm check
pnpm test tests/unit/core/billing/pricing.test.ts
pnpm test tests/contract/provider-funding.contract.test.ts
```

## Review Checklist

- [ ] **Work Item:** `task.0086` linked in PR body
- [ ] **Spec:** PORT_BOUNDARY_CLEAN, ASSET_SWAP_NOT_EXPENSE, DETERMINISTIC_IDS, DURABLE_FUNDING_ROW, TOPUP_FROM_CONSTANTS, MARGIN_PRESERVED
- [ ] **Tests:** calculateOpenRouterTopUp unit + margin check + provider funding contract test
- [ ] **Architecture:** Separate ports for treasury vs provider. Pure math in core. Durable state in Postgres. Asset accounting in TB
- [ ] **Non-blocking:** All post-settlement steps fire-and-forget, log critical on failure

## Review Feedback

### Revision 2 (2026-03-13)

**Blocking (3 design bugs fixed):**

1. **Port boundary violation.** V1 design expanded `TreasurySettlementPort` with OpenRouter logic — wrong boundary. Treasury settlement is about routing revenue to DAO. Provider funding is about provisioning AI service. **Fix:** Separate `ProviderFundingPort`. Application orchestrator composes both.

2. **Wrong ledger posting.** V1 design posted `OperatorFloat → ExpenseProviderTopup`. A top-up is a prepaid asset, not an expense. **Fix:** `OperatorFloat → Assets:ProviderFloat:USDC` (asset swap). Expense recognized on usage/reconciliation (Walk phase). Spec `financial-ledger.md` also needs correction.

3. **Missing durability.** V1 design rejected all DB records ("logs + TB are the audit trail"). Insufficient for crash recovery: if `createOpenRouterCharge()` succeeds and process dies, charge_id is lost. **Fix:** `provider_funding_attempts` table keyed by `paymentIntentId`. Deterministic TB transfer IDs from `(paymentIntentId, step_code)`.

### Revision 3 — Implementation Review (2026-03-13)

**Blocking (3 issues):**

1. **Facade test failure.** `credits.server.ts:74` calls `serverEnv()` unconditionally — breaks existing facade unit test with `EnvValidationError`. **Fix:** Move `serverEnv()` call inside the `container.providerFunding` guard since `pricingConfig` is only needed when provider funding is configured.

2. **`resumeFromCharge` creates a new charge instead of reusing existing.** `openrouter-funding.adapter.ts:162` calls `createOpenRouterCharge()` again on resume — abandons the stored `chargeId`, funds a different charge, leaves the row pointing at the old one. **Fix:** Either fetch the existing charge by ID, or update the row's `chargeId` with the new charge before funding.

3. **Stale comments in `accounts.ts`.** Line 58 says "5 accounts" (now 6). Line 67 lists "Future: Expense:ProviderTopUp:USDC" — that account now exists and is named `Assets:ProviderFloat:USDC` (asset, not expense). **Fix:** Update count, remove the stale future-account line.

**Suggestions (non-blocking):**

- Use `USDC_SCALE` from `@cogni/financial-ledger` (already exported) instead of hardcoded `1_000_000`. Convert cents → micro-USDC with all-bigint math: `BigInt(amountUsdCents) * USDC_SCALE / 100n`. No floats, no magic numbers. Same for the `topUpUsd` conversion (will need `BigInt(Math.round(topUpUsd * 100)) * USDC_SCALE / 100n` since topUpUsd is a float from the pricing function).
- Use `isMarginPreserved()` from `pricing.ts` in `container.ts` instead of inlining the same logic.
- Consider deterministic row ID via `uuid5(namespace, paymentIntentId)` for truly idempotent inserts.
- Log a warning when `providerFunding` is set but `pricingConfig` is missing — silent misconfiguration skip is risky.

## PR / Links

- Previous PR: [#556](https://github.com/Cogni-DAO/node-template/pull/556) (adapter layer — merged)
- Depends on: task.0145 (TigerBeetle — PR #559, merged)
- Branch target: `feat/operator-wallet-e2e` (not staging)

## Attribution

-
