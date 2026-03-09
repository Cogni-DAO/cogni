---
id: task.0086
type: task
title: OpenRouter credit top-up via operator wallet
status: needs_design
priority: 0
estimate: 3
summary: After credit settlement, top up OpenRouter via Coinbase Commerce protocol — create charge, encode swap tx, submit via OperatorWalletPort. Durable state machine.
outcome: Every settled payment triggers an OpenRouter top-up for the provider cost amount. outbound_topups table tracks state. Credits provision automatically.
spec_refs: web3-openrouter-payments, operator-wallet
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch:
pr:
reviewer:
created: 2026-02-17
updated: 2026-02-18
labels: [wallet, web3, billing, openrouter]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 21
---

# OpenRouter credit top-up via operator wallet

## Requirements

- `calculateOpenRouterTopUp(paymentUsd, markupFactor, revenueShare, providerFee)` pure function added to `src/core/billing/pricing.ts`
- New env vars: `OPENROUTER_CRYPTO_FEE` (default 0.05), `OPERATOR_MAX_TOPUP_USD` (e.g. 500)
- `MARGIN_PRESERVED` startup check: `MARKUP × (1 - FEE) > 1 + REVENUE_SHARE` — fail fast if violated
- OpenRouter charge creation: `POST /api/v1/credits/coinbase` with `{amount, sender, chain_id: 8453}`
- Coinbase Commerce protocol encoding: `swapAndTransferUniswapV3Native(intent, poolFeesTier=500)` on Transfers contract (`0xeADE6bE02d043b3550bE19E960504dbA14A14971`)
- `OperatorWalletPort.fundOpenRouterTopUp(intent)` implemented in `PrivyOperatorWalletAdapter`
- `SENDER_MATCH` invariant: `intent.metadata.sender === operator wallet address`
- `CONTRACT_ALLOWLIST` invariant: `to === TRANSFERS_CONTRACT`
- `MAX_TOPUP_CAP` invariant: reject charges exceeding `OPERATOR_MAX_TOPUP_USD`
- `outbound_topups` DB table with state machine: `CHARGE_PENDING` → `CHARGE_CREATED` → `TX_BROADCAST` → `CONFIRMED` (terminal: `FAILED`)
- `TOPUP_IDEMPOTENT`: keyed by `clientPaymentId` — no duplicate charges
- `TOPUP_RECEIPT_LOGGED`: charge_receipt with `charge_reason = 'openrouter_topup'` on CONFIRMED
- `NO_REBROADCAST`: TX_BROADCAST state → poll only, never re-broadcast
- Dispatch triggered from `creditsConfirm.ts` alongside DAO treasury sweep (TOPUP_AFTER_CREDIT)

## Allowed Changes

- `src/core/billing/pricing.ts` (add calculateOpenRouterTopUp)
- `src/shared/env/server-env.ts` (add OPENROUTER_CRYPTO_FEE, OPERATOR_MAX_TOPUP_USD)
- `src/shared/web3/coinbase-transfers.ts` (new — contract ABI, address, tx encoding)
- `src/adapters/server/wallet/privy-operator-wallet.adapter.ts` (implement fundOpenRouterTopUp)
- `src/features/payments/services/creditsConfirm.ts` (dispatch top-up after credit settlement)
- `src/shared/db/schema.billing.ts` (add outbound_topups table)
- `src/adapters/server/db/migrations/` (new migration for outbound_topups)
- `src/bootstrap/` (margin safety startup check)
- `tests/` (unit tests for calculateOpenRouterTopUp, margin check, top-up flow)

## Plan

- [ ] Add `calculateOpenRouterTopUp()` to `src/core/billing/pricing.ts` — pure function
- [ ] Write unit tests: default constants ($1.00 → $0.9211), edge cases, zero/negative
- [ ] Add env vars `OPENROUTER_CRYPTO_FEE` and `OPERATOR_MAX_TOPUP_USD` to `server-env.ts`
- [ ] Add margin safety check to startup (MARGIN_PRESERVED) — fail fast if `MARKUP × (1 - FEE) <= 1 + REVENUE_SHARE`
- [ ] Create `src/shared/web3/coinbase-transfers.ts` — Coinbase Transfers contract ABI (just `swapAndTransferUniswapV3Native` function), address constant, TransferIntent type, tx encoding helper
- [ ] Create DB migration for `outbound_topups` table (schema from spec)
- [ ] Add drizzle schema for `outbound_topups` in `schema.billing.ts`
- [ ] Implement `fundOpenRouterTopUp()` in `PrivyOperatorWalletAdapter` — validate sender/contract/chain, encode call, submit via Privy API
- [ ] Update `FakeOperatorWalletAdapter` with test stub
- [ ] Add OpenRouter charge creation service (`POST /api/v1/credits/coinbase`)
- [ ] Add dispatch logic to `creditsConfirm.ts` — insert `outbound_topups` row, create charge, encode + submit via Privy
- [ ] Add charge_receipt logging on CONFIRMED
- [ ] Write integration test for full top-up flow (with fake adapter + mocked OpenRouter API)
- [ ] Run `pnpm check` to verify no violations

## Validation

**Commands:**

```bash
pnpm check
pnpm test tests/unit/core/billing/pricing.test.ts
pnpm test tests/unit/features/payments
```

**Expected:** All tests pass. `calculateOpenRouterTopUp()` returns correct values. Margin check fails fast with bad constants. Top-up state machine transitions are correct and idempotent.

## Review Checklist

- [ ] **Work Item:** `task.0086` linked in PR body
- [ ] **Spec:** TOPUP_FROM_CONSTANTS, CONTRACT_ALLOWLIST, SENDER_MATCH, MAX_TOPUP_CAP, TOPUP_IDEMPOTENT, NO_REBROADCAST, MARGIN_PRESERVED invariants upheld
- [ ] **Tests:** calculateOpenRouterTopUp unit test + margin check test + top-up flow integration test
- [ ] **Reviewer:** assigned and approved
- [ ] **Architecture:** Pure math in core, contract encoding in shared/web3, tx submission in adapter, orchestration in features

## PR / Links

-

## Attribution

-
