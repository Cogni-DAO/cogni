---
id: proj.dao-dividends
type: project
primary_charter:
title: DAO Dividend Distributions
state: Dropped
priority: 3
estimate: 2
summary: DAO treasury USDC → on-chain distribution to contributors/token holders via a Splits contract, driven by payout statements from transparent-credit-payouts.
outcome: Epoch closes → payout statement computed → Split recipients updated to match statement → distributeERC20() sends USDC pro-rata. Fully verifiable on-chain.
assignees: derekg1729
created: 2026-02-20
updated: 2026-02-20
labels: [governance, payments, web3]
---

# DAO Dividend Distributions

> **Superseded by [proj.financial-ledger](proj.financial-ledger.md).** Splits-based push distribution replaced by MerkleDistributor (Uniswap pattern) user-initiated claims. See financial-ledger spec for the new settlement model.

## Goal

Close the last mile: DAO treasury has USDC (routed by [ai-operator-wallet](proj.ai-operator-wallet.md) Layer 1 Split). Contributors have signed payout statements (from [transparent-credit-payouts](proj.transparent-credit-payouts.md)). This project connects the two — treasury USDC flows to contributors on-chain, proportional to their earned share.

## Key Design Question

Two approaches for dynamic recipient updates (token-holder-proportional payouts):

| Approach                    | How it works                                                                                                                   | Tradeoff                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Snapshot → update**       | App reads payout statement, calls `updateSplit()` on a mutable Split to set recipients + percentages, then `distributeERC20()` | Simple. Requires controller tx per epoch. Recipients match payout math exactly.                                          |
| **Liquid Split (ERC-1155)** | Ownership represented as ERC-1155 NFTs. Distribution auto-reads current holders.                                               | No update tx needed. But requires adopting ERC-1155 as the ownership primitive — hard pivot from Aragon GovernanceERC20. |

**Recommendation**: Snapshot → update for P0. It works with existing Aragon governance tokens and payout statements. Liquid Splits are a P2+ consideration if the DAO wants transferable ownership shares.

## Roadmap

### Crawl (P0) — Snapshot-Driven Distribution

**Goal:** Epoch close → update Split recipients from payout statement → distribute USDC.

| Deliverable                                                                | Status      | Est | Work Item         |
| -------------------------------------------------------------------------- | ----------- | --- | ----------------- |
| Deploy mutable "dividend Split" on Base (controller = operator wallet)     | Not Started | 1   | (create at start) |
| `updateDividendSplit()` — reads payout statement, maps to Split recipients | Not Started | 2   | (create at start) |
| Wire into epoch close flow: update → distribute → log                      | Not Started | 2   | (create at start) |

### Walk (P1) — Automation + Verification

| Deliverable                                                                  | Status      | Est | Work Item            |
| ---------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| On-chain verification: Merkle root from payout statement matches Split state | Not Started | 2   | (create at P1 start) |
| Automatic epoch → distribute pipeline (no manual trigger)                    | Not Started | 1   | (create at P1 start) |
| Contributor claim UI (or push distribution)                                  | Not Started | 2   | (create at P1 start) |

### Run (P2+) — Liquid Ownership

| Deliverable                                                 | Status      | Est | Work Item            |
| ----------------------------------------------------------- | ----------- | --- | -------------------- |
| Evaluate Liquid Splits (ERC-1155) vs Aragon GovernanceERC20 | Not Started | 1   | (create at P2 start) |
| Transferable ownership shares (if Liquid Split adopted)     | Not Started | 3   | (create at P2 start) |

## Constraints

- Base mainnet (8453) only
- Must use payout statements from transparent-credit-payouts as source of truth (not raw token balances)
- Controller = operator wallet (same Privy-managed wallet from ai-operator-wallet)
- No custom contracts — uses pre-deployed Splits infrastructure

## Dependencies

- [ ] proj.ai-operator-wallet P0 complete (DAO treasury receiving USDC via Layer 1 Split)
- [ ] proj.transparent-credit-payouts P0 complete (payout statements exist with per-contributor shares)
- [ ] Splits SDK integration already done in ai-operator-wallet PR 2 (reuse `@0xsplits/splits-sdk`)

## As-Built Specs

- (none yet — specs created when code merges)

## Design Notes

### Why not distribute directly from the Layer 1 Split?

The Layer 1 Split (ai-operator-wallet) routes revenue between operator and DAO treasury. Its percentages are fixed by pricing constants (~92/8). Contributor shares change every epoch based on work done. Mixing these concerns in one Split would require updating percentages on every payment AND every epoch close. Two Splits, each with a single responsibility, is cleaner.

### Why payout statements over raw token balances?

Aragon GovernanceERC20 tokens represent voting power, not necessarily earned revenue share. Payout statements from transparent-credit-payouts capture actual work contributions with signed receipts. Using payout statements means the distribution is auditable back to specific merged PRs, not just "you hold X% of tokens."
