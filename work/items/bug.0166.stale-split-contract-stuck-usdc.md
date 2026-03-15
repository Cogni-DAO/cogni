---
id: bug.0166
type: bug
title: "Stale Split contract holds $10 USDC — deployed with test wallet, cannot distribute"
status: needs_triage
priority: 1
rank: 99
estimate: 1
summary: "Split contract 0xd92EEc51C471CcF76996f0163Fd3cB6A61798f9C was deployed during spike.0090 with a test wallet's addresses. On-chain splitHash does not match production operator wallet or DAO treasury. distributeERC20 reverts with InvalidSplit(). $10 USDC is stuck."
outcome: "USDC recovered from stale Split contract. New Split deployed with production addresses and registered in repo-spec."
spec_refs: operator-wallet
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-14
updated: 2026-03-14
labels: [wallet, web3, billing]
external_refs:
---

# Stale Split contract holds $10 USDC — deployed with test wallet, cannot distribute

## Observed

`distributeSplit()` reverts with `InvalidSplit()` on every payment attempt. The Split contract at `0xd92EEc51C471CcF76996f0163Fd3cB6A61798f9C` was deployed during spike.0090 using a test wallet private key (`OPERATOR_PRIVATE_KEY` in `scripts/experiments/.env`). The on-chain `splitHash` does not match any combination of production or dev addresses.

Verified via on-chain simulation:

```
On-chain splitHash: 0x2ce03682d21b2364ef5c89fa0e15340025590ca0855a85e5d1a9455590fd1858
Computed (dev treasury):  0x045eded0...  — NO MATCH
Computed (prod treasury): 0xff268d70...  — NO MATCH
```

## Expected

`distributeSplit()` succeeds, pushing ~92.1% USDC to operator wallet and ~7.9% to DAO treasury.

## Reproduction

1. Make a payment via the UI ($2+ USDC to Split contract)
2. Payment verifies, credits mint (CREDITED)
3. `runPostCreditFunding` calls `distributeSplit()` → reverts `InvalidSplit()`
4. Provider funding also fails (operator wallet has no USDC)

Stack: `PrivyOperatorWalletAdapter.distributeSplit` → `SplitTreasurySettlementAdapter.settleConfirmedCreditPurchase` → `runPostCreditFunding`

## Impact

- $10 USDC stuck in stale Split contract — unrecoverable without original test wallet private key
- All post-credit funding broken — treasury settlement and OpenRouter top-up fail on every payment
- Credits still mint correctly (non-blocking design), but no provider provisioning occurs

## Root Cause

`scripts/deploy-split.ts` reads `OPERATOR_ADDRESS` and `DAO_TREASURY_ADDRESS` from env vars. During spike.0090, these pointed to a test wallet. The Split address was committed to repo-spec. Later, repo-spec was overwritten with production DAO addresses (commit `17a98c9`), creating a mismatch between on-chain state and app config.

## Requirements

- Deploy a new Split contract with production addresses (operator wallet + DAO treasury from repo-spec)
- Update `payments_in.credits_topup.receiving_address` in repo-spec with the new Split address
- Document the $10 USDC loss (or recover if test wallet key is available)

## Allowed Changes

- `.cogni/repo-spec.yaml` (update receiving_address)
- `scripts/deploy-split.ts` (if improvements needed)

## Plan

- [ ] Deploy new Split via `scripts/deploy-split.ts` with correct env vars
- [ ] Update repo-spec with new Split address
- [ ] Simulate `distribute` on new contract to verify
- [ ] Retry payment flow end-to-end

## Validation

Simulate distribute on new Split contract — should not revert with `InvalidSplit()`.

## Review Checklist

- [ ] **Work Item:** `bug.0166` linked in PR body
- [ ] **Spec:** operator-wallet invariants upheld
- [ ] **Tests:** distribute call validated on-chain
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: spike.0090 (original deployment)
- Related: commit `17a98c9` (repo-spec overwrite that exposed the mismatch)

## Attribution

-
