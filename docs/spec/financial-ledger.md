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
| FUNDING_IS_FINANCIAL      | Emissions funding of the MerkleDistributor IS a financial event. Entry: Dr Liability:UnclaimedEquity / Cr Assets:EmissionsVault:COGNI.                                                                                                  |
| CLAIM_IS_FINANCIAL        | User on-chain claim from the distributor IS a financial event (liability reduction).                                                                                                                                                    |
| ROTKI_ENRICHMENT_ONLY     | Rotki for crypto transaction enrichment and tax lot validation. NOT the canonical ledger.                                                                                                                                               |
| EQUITY_PRIMARY            | Governance/rewards token distributions are the primary token distribution instrument. USDC distributions are governance-voted, not automated.                                                                                              |
| MERKLE_CLAIMS             | Stock per-epoch MerkleDistributor (Uniswap pattern, Base mainnet) is the preferred MVP on-chain distribution rail. User-initiated claims with inclusion proofs. Not Splits push distribution.                                            |
| MULTI_INSTRUMENT          | Beancount hierarchy tracks all instrument types (equity tokens, USDC, future). Financial events are instrument-typed. Settlement policy determines which instruments are active.                                                        |
| OPERATOR_PORT_REQUIRED    | Treasury actions (fund distributor, rotate Merkle roots, contract management, batch operations) require an Operator Port — a signing + policy boundary with rate limits, approvals, allowlists, and audit logs. NOT a custodial wallet. |
| ALL_MATH_BIGINT           | No floating point in monetary calculations. Inherited from attribution-ledger.                                                                                                                                                          |
| TRUSTED_MVP_EXPLICIT      | MVP claim publication/funding is trusted governance execution (Safe/manual or equivalent), NOT on-chain emissions enforcement. The trust model must be stated explicitly in product and operator docs.                                   |
| SETTLEMENT_MANIFEST_REQUIRED | Every published distribution records a settlement manifest containing `epochId`, `statementHash`, `merkleRoot`, `totalAmount`, `fundingTxHash`, `publisher`, and `publishedAt`.                                                       |

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

MVP settlement path:

1. Attribution finalization produces a signed `AttributionStatement`.
2. Settlement resolves each finalized claimant to a wallet address. Epochs with unresolved claimants remain governance-finalized but are not settlement-eligible.
3. `computeMerkleTree()` derives leaves from statement-line `credit_amount` entitlements and maps them into `GovernanceERC20` token amounts under the active settlement policy.
4. The settlement token is the Aragon `GovernanceERC20` minted at node formation to a DAO-controlled emissions holder.
5. DAO-controlled trusted execution (Safe/manual or equivalent) publishes a per-epoch Merkle root and funds the distributor. No second statement-signing step is introduced at settlement time.
6. Settlement publication stores a signed settlement manifest linking `epochId`, `statementHash`, `merkleRoot`, `totalAmount`, `fundingTxHash`, `publisher`, and `publishedAt`.

Lifecycle:

```
node formation
  -> fixed GovernanceERC20 supply minted to emissions holder
  -> epoch finalized as signed AttributionStatement
  -> settlement manifest + Merkle root derived from signed `credit_amount`
  -> DAO-controlled publish + fund
  -> contributor claims tokens on-chain
```

See [proj.financial-ledger](../../work/projects/proj.financial-ledger.md) for the implementation roadmap.

## Threat Model

| Threat | MVP controls |
| ------ | ------------ |
| Malicious maintainer changes settlement code or publication inputs before release | Branch protection, required review, signed releases or build attestations, and reproducible settlement artifacts. |
| Compromised operator publishes a root early or funds a distributor with the wrong amount | Safe/manual publish-and-fund policy, limited publisher set, and manifest review before execution. |
| Statement/root mismatch: a valid signed statement exists, but a different root is published | Settlement manifest stores `statementHash`, and the published root is derived from the signed statement rather than ad hoc balances. |
| Replay or duplicate publication for an epoch | One settlement publication record per epoch plus explicit operator review before any replacement action. |
| Overfunding distributor beyond the intended epoch amount | Funding amount must equal manifest `totalAmount`, with reconciliation against the stored settlement record and journal entry. |

## Non-Goals

- Bespoke emissions enforcement in MVP
- Speculative token economics (co-op patronage, not governance tokens)
- Postgres as financial ledger (Postgres is operational state; Beancount is canonical)
- Raw private key env vars (Operator Port uses keystore/Vault/CDP, never raw keys)

## Related

- [Attribution Ledger](./attribution-ledger.md) — governance truth (who earned what)
- [Billing Evolution](./billing-evolution.md) — current credit system (as-built)
- [x402 E2E](./x402-e2e.md) — per-request settlement (forward path)
- [proj.financial-ledger](../../work/projects/proj.financial-ledger.md) — project roadmap
