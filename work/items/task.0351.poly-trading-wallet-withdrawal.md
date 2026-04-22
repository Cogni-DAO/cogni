---
id: task.0351
type: task
title: "Poly trading wallet withdrawal — backend + UI"
status: needs_triage
priority: 2
rank: 20
estimate: 3
created: 2026-04-22
updated: 2026-04-22
summary: "Implement the `withdrawUsdc` port method on `PrivyPolyTraderWalletAdapter` plus a SIWE-authed `POST /api/v1/poly/wallet/withdraw` route and a Withdraw dialog on the Money page, replacing the stubbed disabled button shipped with the Money page v0."
outcome: "A user with a provisioned trading wallet can withdraw USDC.e from it to an external Polygon address from `/credits`, the tx hash lands in Polygonscan, and the transfer is observable in Loki with billing_account_id + connection_id."
spec_refs:
  - docs/spec/poly-trader-wallet-port.md
  - docs/spec/poly-multi-tenant-auth.md
assignees: []
credit:
project: proj.poly-copy-trading
branch:
pr:
reviewer:
revision: 0
blocked_by:
labels: [poly, wallet, withdraw, privy, ui]
---

# task.0351 — Poly trading wallet withdrawal

## Problem

[task.0318 Phase B](./task.0318.poly-wallet-multi-tenant-auth.md) shipped the `withdrawUsdc` port declaration on `PolyTraderWalletPort` but left it un-implemented in `PrivyPolyTraderWalletAdapter` (explicit follow-up in PR #968). The Money page v0 (feat/poly-money-page-v0) ships a disabled "Withdraw" button tagged to this task. Until this lands, there is no sanctioned path to move funds out of a user's tenant trading wallet — funds are effectively one-way in.

## Scope

In:

- Implement `PrivyPolyTraderWalletAdapter.withdrawUsdc({ billingAccountId, destination, amountAtomic, requestedByUserId })`:
  - Resolve signing context via existing `resolve()`.
  - Encode ERC-20 `transfer(to, amount)` calldata for USDC.e at `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` on Polygon (preserves the port's `NO_GENERIC_SIGNING` invariant — token is hard-coded).
  - Submit via Privy backend wallet call; return `{ txHash }`.
  - Log `poly.wallet.withdraw.submit` + `poly.wallet.withdraw.confirmed` with billing_account_id, connection_id, destination, amount_atomic, tx_hash.
- New contract `packages/node-contracts/src/poly.wallet.withdraw.v1.contract.ts`:
  - Input `{ destination: 0x-address, amountUsdcAtomic: string (bigint-as-string), confirmationToken?: string }`.
  - Output `{ tx_hash, polygonscan_url, amount_usdc_atomic, destination }`.
- `POST /api/v1/poly/wallet/withdraw` route: session auth, resolves billing account, calls `adapter.withdrawUsdc`. Rate-limit mirrors the connect route cooldown pattern.
- UI: swap the stubbed button in `TradingWalletPanel.tsx` for a `WithdrawDialog` component that:
  - Input: destination address (with address-format validation), amount (with Max button pulling from `balances.usdcE`).
  - Confirmation screen: shows destination truncated + short-addr warning if destination looks like the funder address (copy-paste guard).
  - Submits, shows progress, surfaces the Polygonscan link on success.
  - Reuses `PaymentFlowDialog` / `UsdcPaymentFlow` patterns where the state machine fits.
- Component test for the adapter path (fake Privy backend); route happy-path stack test.

Out:

- Agent/API-key-authed withdraw (follow-up once `custodialConsentActorKind` widens in task.0318 B3).
- POL / gas-token withdraw (USDC.e only for v0).
- Withdraw from a revoked connection — hard error, no rescue path here.

## Validation

- **exercise:** on candidate-a, sign in as a user with USDC.e on their trading wallet, visit `/credits`, click Withdraw, enter a destination + amount, submit. Returns a Polygonscan tx URL; the destination's USDC.e balance increments after confirmation; the source tenant's balance decrements on the next panel refresh.
- **observability:** `{job="poly-node-app",sha="<sha>"} |= "poly.wallet.withdraw"` at the deployed SHA shows the user's request with billing_account_id, connection_id, destination, amount_atomic, and tx_hash.

## Out of Scope

Agent-authed withdrawal, POL withdrawal, cross-chain withdrawal, automatic sweep-to-owner flows.

## Notes

- Blocks any real "funds recovery" story — without withdraw, any funded trading wallet is a one-way roach motel.
- Pairs with [task.0352](./task.0352.poly-trading-wallet-fund-flow.md) which lands the deposit side.
