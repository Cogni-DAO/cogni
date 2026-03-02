---
id: financial-ledger-spec
type: spec
title: "Financial Ledger: Double-Entry Treasury with On-Chain Settlement"
status: draft
spec_state: draft
trust: draft
summary: "Double-entry financial ledger using Beancount as source of truth. MerkleDistributor (Uniswap pattern) for on-chain claim settlement. Operator Port for treasury signing actions. Attribution statements are governance commitments — financial events occur only when funds move on-chain."
read_when: Working on treasury accounting, on-chain distributions, settlement workflows, Beancount integration, MerkleDistributor claims, or the Operator Port.
implements: proj.financial-ledger
owner: derekg1729
created: 2026-03-02
verified:
tags: [governance, payments, web3, treasury]
---

# Financial Ledger: Double-Entry Treasury with On-Chain Settlement

## Goal

All money I/O in one place. Inbound USDC → treasury postings. Attribution statements → MerkleDistributor claim trees. Users claim on-chain with inclusion proofs. Beancount is the canonical ledger; Postgres stores operational state. Rotki enriches crypto transaction history and tax lots but is NOT the canonical ledger.

## Core Invariants

| Rule                      | Constraint                                                                                                                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BEANCOUNT_CANONICAL       | Beancount journal files are the source-of-truth financial ledger. All monetary state is reproducible from the journal.                                                                                                                  |
| ATTRIBUTION_NOT_FINANCIAL | A signed attribution statement is a governance commitment (who earned what share), NOT a financial event. No money moves at epoch finalization.                                                                                         |
| FUNDING_IS_FINANCIAL      | Treasury → MerkleDistributor contract funding IS a financial event. Entry: Dr Liability:UnclaimedRewards / Cr Assets:Treasury:USDC.                                                                                                     |
| CLAIM_IS_FINANCIAL        | User on-chain claim from the distributor IS a financial event (liability reduction).                                                                                                                                                    |
| ROTKI_ENRICHMENT_ONLY     | Rotki for crypto transaction enrichment and tax lot validation. NOT the canonical ledger.                                                                                                                                               |
| EQUITY_PRIMARY            | Equity tokens (ERC-20) are the primary automated distribution instrument. USDC distributions are governance-voted, not automated.                                                                                                       |
| MERKLE_CLAIMS             | MerkleDistributor (Uniswap pattern, Base mainnet) for on-chain distribution. User-initiated claims with inclusion proofs. Not Splits push distribution. Supports both equity tokens and USDC (separate roots or instances).             |
| MULTI_INSTRUMENT          | Beancount hierarchy tracks all instrument types (equity tokens, USDC, future). Financial events are instrument-typed. Settlement policy determines which instruments are active.                                                        |
| OPERATOR_PORT_REQUIRED    | Treasury actions (fund distributor, rotate Merkle roots, contract management, batch operations) require an Operator Port — a signing + policy boundary with rate limits, approvals, allowlists, and audit logs. NOT a custodial wallet. |
| ALL_MATH_BIGINT           | No floating point in monetary calculations. Inherited from attribution-ledger.                                                                                                                                                          |

## Accounts Hierarchy (Beancount)

```
; --- Equity Token (primary distribution instrument) ---
Assets:EmissionsVault:COGNI       ; Pre-minted equity tokens awaiting release
Assets:Distributor:COGNI          ; Tokens locked in MerkleDistributor per epoch
Liability:UnclaimedEquity         ; Committed but unclaimed equity token distributions

; --- USDC (revenue + governance-voted distributions) ---
Assets:Treasury:USDC              ; DAO treasury wallet (inbound revenue)
Assets:Distributor:USDC           ; Funds locked in MerkleDistributor (governance-voted payouts)
Liability:UnclaimedUSDC           ; Committed but unclaimed USDC distributions (future)

; --- P&L ---
Expense:ContributorRewards:Equity ; Equity token distributions (automated per epoch)
Expense:ContributorRewards:USDC   ; USDC distributions (governance-voted, future)
Income:ServiceRevenue             ; Inbound payments for AI services
Income:x402Settlements            ; x402 per-request settlement revenue
```

## Financial Events

**Automated (per epoch):**

1. **Epoch signed (optional accrual)**: Dr Expense:ContributorRewards:Equity / Cr Liability:UnclaimedEquity. No tokens move.
2. **EmissionsVault funds distributor**: Dr Liability:UnclaimedEquity / Cr Assets:EmissionsVault:COGNI. Equity tokens move on-chain via Operator Port.
3. **User claims equity tokens on-chain**: Liability reduction via MerkleDistributor claim.

**Governance-voted (future, not automated):**

4. **USDC distribution approved**: Governance vote passes → Dr Expense:ContributorRewards:USDC / Cr Assets:Treasury:USDC. Operator Port funds a separate USDC MerkleDistributor (or same contract, different token).
5. **User claims USDC on-chain**: Same MerkleDistributor claim pattern, different token.

## Design

Stub — to be fleshed out when implementation begins. See [proj.financial-ledger](../../work/projects/proj.financial-ledger.md) for the project roadmap.

## Non-Goals

- Custom smart contracts (use battle-tested MerkleDistributor)
- Speculative token economics (co-op patronage, not governance tokens)
- Postgres as financial ledger (Postgres is operational state; Beancount is canonical)
- Raw private key env vars (Operator Port uses keystore/Vault/CDP, never raw keys)

## Related

- [Attribution Ledger](./attribution-ledger.md) — governance truth (who earned what)
- [Billing Evolution](./billing-evolution.md) — current credit system (as-built)
- [x402 E2E](./x402-e2e.md) — per-request settlement (forward path)
- [proj.financial-ledger](../../work/projects/proj.financial-ledger.md) — project roadmap
