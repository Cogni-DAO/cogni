---
id: spike.0090
type: spike
title: "Validate operator wallet payment chain: OpenRouter top-up + Splits + end-to-end"
status: done
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
updated: 2026-03-09
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

- [x] `metadata.function_name` from OpenRouter documented — **API does not return function_name. Correct function: `transferTokenPreApproved` (USDC via direct ERC-20 `transferFrom`, NOT Permit2). No ETH swap needed.** (2026-03-09)
- [x] `metadata.contract_address` from OpenRouter documented — **Returns `0x03059433BCdB6144624cC2443159D9445C32b7a8` (NOT old `0xeADE6...`). Allowlist updated in specs.** (2026-03-09)
- [x] Split deployed on Base, USDC distributed successfully — **Push Split V2o2 via `splitV2ABI`. Direct ERC-20 transfers to recipients (no warehouse withdrawal). Deploy: 166k gas, distribute: 81k gas. ~0.000002 USDC dust remains.** (2026-03-09)
- [x] Full chain proven: USDC → Split → wallet → OpenRouter credits — **23.6s end-to-end, 247k total gas (~$0.001). Send to split + distribute + approve + transferTokenPreApproved + credits confirmed.** (2026-03-09)
- [x] Gas costs and timing documented — **120,541 gas (~$0.0003), 1.6s confirm time** (2026-03-09)
- [x] Findings written back to specs (web3-openrouter-payments.md, operator-wallet.md) (2026-03-09)

## Validation

- Experiment 1: ✅ OpenRouter credits increased by $1.00 for a $1 charge (1.05 USDC spent including 5% fee). `transferTokenPreApproved` with direct ERC-20 approval to Transfers contract (NOT Permit2). tx: `0x8fcdb7c5242d034f77feb035955b7ff11f5deee3cd6b4ba21c714ac58ea0cc47`
- Experiment 2: ✅ Push Split V2o2 deployed on Base. `distribute()` sends USDC directly via ERC-20 transfers — 92.1% to operator, 7.9% to treasury. Verified across 3 separate splits. Factory: `0x8E8eB0cC6AE34A38B67D5Cf91ACa38f60bc3Ecf4`. SDK ABI: `splitV2ABI` (not `pushSplitAbi`). tx: `0x6d9f02d8ccc82358731c484e76da979d04bb57dc82ab4b65ddf85d7aea656ec7`
- Experiment 3: ✅ Full chain proven in 23.6s. USDC → Split → distribute (92.1% to operator) → ERC-20 approve to Transfers contract → `transferTokenPreApproved` → OpenRouter credits +$1.00. Total gas: 247k (~$0.001). tx: `0x8540f5914476373243ce36c85867fcc50746e25d570bf48a40e3467e65a4dd0d`

## Prerequisites

- Test wallet with USDC + ETH on Base mainnet (small amounts: ~$10 USDC + ~$5 ETH for gas)
- OpenRouter API key with management permissions
- `@0xsplits/splits-sdk` and `viem` available

## Budget

~$15 total: $5 OpenRouter minimum + $5 USDC for Split testing + ~$5 ETH for gas across all experiments.
