---
id: spike.0090
type: spike
title: "Validate operator wallet payment chain: OpenRouter top-up + Splits + end-to-end"
status: needs_implement
priority: 1
estimate: 1
rank: 10
summary: "Run real transactions on Base to validate OpenRouter crypto top-up API, 0xSplits USDC distribution, and the full chain before building abstractions."
outcome: "Key unknowns resolved: which Coinbase Commerce function OpenRouter returns, Splits works with Base USDC, full chain proven end-to-end. Findings written back to specs."
spec_refs:
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch:
pr:
reviewer:
created: 2026-02-21
updated: 2026-02-21
labels: [wallet, billing, web3, spike]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
---

# Validate Operator Wallet Payment Chain

> Hands-on experimental spike — run real transactions on Base to validate the full payment chain before building abstractions.

## Context

The operator wallet project (proj.ai-operator-wallet) depends on three building blocks that have never been tested together: OpenRouter's crypto top-up API, 0xSplits USDC distribution on Base, and the Coinbase Commerce Transfers contract. Key design decisions (ETH vs USDC input, contract addresses) are blocked until we hit the real APIs.

## Sub-Experiments

### Experiment 1: OpenRouter crypto top-up ($5 minimum)

**Script:** `scripts/experiments/openrouter-topup.ts`

1. `POST https://openrouter.ai/api/v1/credits/coinbase` with `{amount: 5, sender: "<test wallet>", chain_id: "8453"}`
2. Log the full response — especially:
   - `metadata.function_name` — is it `swapAndTransferUniswapV3Native` (needs ETH) or `transferTokenPreApproved` / `swapAndTransferUniswapV3TokenPreApproved` (can use USDC)?
   - `metadata.contract_address` — is it `0xeADE6bE02d043b3550bE19E960504dbA14A14971` (confirmed Coinbase Transfers on Base) or something else?
   - `call_data.recipient_currency` — what token does OpenRouter want to receive?
   - `expires_at` — how long do we have?
3. Encode and execute the transaction using viem
4. Poll `GET /api/v1/credits` to confirm credits appear
5. Record gas cost, confirmation time, and any gotchas

**Key unknown resolved:** ETH vs USDC input for top-ups.

### Experiment 2: 0xSplits deployment + distribution

**Script:** `scripts/experiments/splits-deploy.ts`

1. Deploy a mutable Split on Base via `@0xsplits/splits-sdk`
   - Two recipients: test wallet A (92%), test wallet B (8%)
   - Controller: test wallet A
2. Send a small amount of USDC to the Split address
3. Call `distributeERC20(USDC_ADDRESS)` on the Split
4. Verify both recipients received correct shares
5. Record gas cost for deploy + distribute

**Key unknown resolved:** Splits works with Base USDC, gas costs acceptable.

### Experiment 3: End-to-end chain

**Script:** `scripts/experiments/full-chain.ts`

1. Send USDC to the Split from Experiment 2
2. Call `distributeERC20()` — operator share arrives at test wallet A
3. From test wallet A, execute the OpenRouter top-up from Experiment 1
4. Confirm OpenRouter credits appear
5. Time the full chain end-to-end

**Key unknown resolved:** The full flow works. USDC → Split → operator wallet → OpenRouter credits.

## Acceptance Criteria

- [ ] `metadata.function_name` from OpenRouter documented (ETH vs USDC decision made)
- [ ] `metadata.contract_address` from OpenRouter matches `0xeADE6...` or discrepancy documented
- [ ] Split deployed on Base, USDC distributed successfully
- [ ] Full chain proven: USDC → Split → wallet → OpenRouter credits
- [ ] Gas costs and timing documented
- [ ] Findings written back to specs (web3-openrouter-payments.md, operator-wallet.md)

## Validation

- Experiment 1: OpenRouter credits balance increases by $5 (minus 5% fee = $4.75 net)
- Experiment 2: Both Split recipients have correct USDC balances after distributeERC20()
- Experiment 3: Full chain completes — USDC sent to Split, distributed, used for top-up, credits confirmed

## Prerequisites

- Test wallet with USDC + ETH on Base mainnet (small amounts: ~$10 USDC + ~$5 ETH for gas)
- OpenRouter API key with management permissions
- `@0xsplits/splits-sdk` and `viem` available

## Budget

~$15 total: $5 OpenRouter minimum + $5 USDC for Split testing + ~$5 ETH for gas across all experiments.
