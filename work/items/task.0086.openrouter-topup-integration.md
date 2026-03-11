---
id: task.0086
type: task
title: OpenRouter credit top-up via operator wallet
status: needs_design
priority: 0
estimate: 3
summary: "Implement fundOpenRouterTopUp() — multi-step flow: create OpenRouter charge, ERC-20 approve, transferTokenPreApproved via Privy. Durable state machine."
outcome: Every settled payment triggers an OpenRouter top-up for the provider cost amount. outbound_topups table tracks state. Credits provision automatically.
spec_refs: web3-openrouter-payments, operator-wallet
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch:
pr:
reviewer:
created: 2026-02-17
updated: 2026-03-09
labels: [wallet, web3, billing, openrouter]
external_refs:
revision: 1
blocked_by: task.0085
deploy_verified: false
rank: 21
---

# OpenRouter credit top-up via operator wallet

> Updated with spike.0090 findings. Old scope had wrong contract addresses and function names.

## Corrections from spike.0090

| Item                     | Old (wrong)                                  | Correct (spike-validated)                                        |
| ------------------------ | -------------------------------------------- | ---------------------------------------------------------------- |
| Transfers contract       | `0xeADE6bE02d043b3550bE19E960504dbA14A14971` | `0x03059433BCdB6144624cC2443159D9445C32b7a8`                     |
| Function                 | `swapAndTransferUniswapV3Native` (needs ETH) | `transferTokenPreApproved` (USDC via direct ERC-20 transferFrom) |
| Input token              | ETH (swap via Uniswap)                       | USDC (direct ERC-20 approval, no swap)                           |
| Minimum charge           | $5                                           | $1                                                               |
| `function_name` from API | Expected in response                         | NOT returned — hardcode `transferTokenPreApproved`               |
| `calldata`               | Caller-provided                              | Adapter encodes internally from `call_data` fields               |
| Gas                      | Unknown                                      | ~120k (~$0.0003)                                                 |

## Requirements

- Fix `TransferIntent` type to match actual OpenRouter `transfer_intent.call_data` shape:
  ```typescript
  {
    (recipient_amount,
      deadline,
      recipient,
      recipient_currency,
      refund_destination,
      fee_amount,
      id,
      operator,
      signature,
      prefix);
  }
  ```
  See: `scripts/experiments/full-chain.ts:58-69`
- `calculateOpenRouterTopUp(paymentUsd, markupFactor, revenueShare, providerFee)` pure function in `src/core/billing/pricing.ts`
- New env vars: `OPENROUTER_CRYPTO_FEE` (default 0.05), `OPERATOR_MAX_TOPUP_USD` (default 500)
- `MARGIN_PRESERVED` startup check: `MARKUP × (1 - FEE) > 1 + REVENUE_SHARE` — fail fast if violated
- `fundOpenRouterTopUp()` implemented as multi-step flow:
  1. `POST /api/v1/credits/coinbase` → get charge with `transfer_intent`
  2. ERC-20 `approve(transfersContract, recipientAmount + feeAmount)`
  3. `transferTokenPreApproved(intent)` on Transfers contract via Privy
- `DESTINATION_ALLOWLIST`: validate `contract_address` against allowlist (only `0x0305...`)
- `OPERATOR_MAX_TOPUP_USD`: per-tx cap validation
- `SENDER_MATCH`: `intent.metadata.sender === operator wallet address`
- `outbound_topups` DB table with state machine: `CHARGE_PENDING` → `CHARGE_CREATED` → `TX_BROADCAST` → `CONFIRMED` (terminal: `FAILED`)
- `TOPUP_IDEMPOTENT`: keyed by `clientPaymentId` — no duplicate charges
- `NO_REBROADCAST`: TX_BROADCAST state → poll only, never re-broadcast
- Dispatch triggered from `creditsConfirm.ts` alongside Split distribution (TOPUP_AFTER_CREDIT)

## Key spike references

- `scripts/experiments/openrouter-topup.ts` — working charge creation + top-up flow
- `scripts/experiments/full-chain.ts:205-288` — working end-to-end with approve + transfer
- `scripts/experiments/shared.ts` — `TRANSFERS_ABI` with `transferTokenPreApproved` signature
- Transfers contract: `0x03059433BCdB6144624cC2443159D9445C32b7a8`
- Gas: ~120k for transferTokenPreApproved (~$0.0003)
- Provider fee: 5% on charge amount
- Charge response shape: `data.web3_data.transfer_intent.{call_data, metadata}`

## Allowed Changes

- `src/ports/operator-wallet.port.ts` (fix TransferIntent type)
- `src/core/billing/pricing.ts` (add calculateOpenRouterTopUp)
- `src/shared/env/server-env.ts` (add OPENROUTER_CRYPTO_FEE, OPERATOR_MAX_TOPUP_USD)
- `src/shared/web3/coinbase-transfers.ts` (new — Transfers ABI, address, encoding helpers)
- `src/adapters/server/wallet/privy-operator-wallet.adapter.ts` (implement fundOpenRouterTopUp)
- `src/adapters/test/wallet/fake-operator-wallet.adapter.ts` (update for new TransferIntent shape)
- `src/features/payments/services/creditsConfirm.ts` (dispatch top-up after credit settlement)
- `src/shared/db/schema.billing.ts` (add outbound_topups table)
- `src/adapters/server/db/migrations/` (new migration for outbound_topups)
- `src/bootstrap/` (margin safety startup check)
- `tests/` (unit tests for calculateOpenRouterTopUp, margin check, top-up flow)

## Plan

- [ ] **Checkpoint 1: TransferIntent + pricing**
  - [ ] Fix `TransferIntent` type to match actual OpenRouter shape
  - [ ] Add `calculateOpenRouterTopUp()` to `src/core/billing/pricing.ts`
  - [ ] Write unit tests: default constants ($1.00 → $0.9211), edge cases
  - [ ] Add `OPENROUTER_CRYPTO_FEE`, `OPERATOR_MAX_TOPUP_USD` env vars
  - [ ] Add `MARGIN_PRESERVED` startup check

- [ ] **Checkpoint 2: Transfers contract encoding**
  - [ ] Create `src/shared/web3/coinbase-transfers.ts` — ABI + encoding
  - [ ] Use `transferTokenPreApproved` (NOT `swapAndTransferUniswapV3Native`)
  - [ ] Contract address: `0x03059433BCdB6144624cC2443159D9445C32b7a8`
  - [ ] Unit test: encode/decode roundtrip

- [ ] **Checkpoint 3: State machine + adapter**
  - [ ] Create `outbound_topups` table migration + drizzle schema
  - [ ] Implement `fundOpenRouterTopUp()` in Privy adapter:
    - Validate DESTINATION_ALLOWLIST, SENDER_MATCH, MAX_TOPUP_USD
    - ERC-20 approve → transferTokenPreApproved (two Privy tx submissions)
  - [ ] Update fake adapter for new TransferIntent shape

- [ ] **Checkpoint 4: Orchestration**
  - [ ] Add OpenRouter charge creation service (`POST /api/v1/credits/coinbase`)
  - [ ] Add dispatch logic to `creditsConfirm.ts`
  - [ ] State transitions: CHARGE_PENDING → CHARGE_CREATED → TX_BROADCAST → CONFIRMED
  - [ ] Idempotency on clientPaymentId
  - [ ] Integration test for full flow

## Validation

```bash
pnpm check
pnpm test tests/unit/core/billing/pricing.test.ts
pnpm test tests/contract/operator-wallet.contract.ts
```

## Review Checklist

- [ ] **Work Item:** `task.0086` linked in PR body
- [ ] **Spec:** DESTINATION_ALLOWLIST, SENDER_MATCH, MAX_TOPUP_CAP, TOPUP_IDEMPOTENT, NO_REBROADCAST, MARGIN_PRESERVED invariants upheld
- [ ] **Tests:** calculateOpenRouterTopUp unit + margin check + top-up flow integration
- [ ] **Reviewer:** assigned and approved
- [ ] **Architecture:** Pure math in core, contract encoding in shared/web3, tx submission in adapter, orchestration in features

## PR / Links

- Depends on: task.0085 (Splits deployment — distributeSplit must work first)
- Branch target: `feat/operator-wallet-v0` (not staging)

## Attribution

-
