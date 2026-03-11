---
id: financial-ledger-spec
type: spec
title: "Financial Ledger: Double-Entry Treasury with On-Chain Settlement"
status: draft
spec_state: draft
trust: draft
summary: "Double-entry financial ledger using TigerBeetle as the transaction engine and Postgres for metadata. LedgerPort is the write path for all money-movement operations. Blockchain is the external settlement rail; TigerBeetle is the internal source of financial truth. x402 at the edge, TigerBeetle at the core."
read_when: Working on treasury accounting, on-chain distributions, settlement workflows, the LedgerPort, operator wallet, x402 payments, or any code that moves money.
implements: proj.financial-ledger
owner: derekg1729
created: 2026-03-02
verified:
tags: [governance, payments, web3, treasury]
---

# Financial Ledger: Double-Entry Treasury with On-Chain Settlement

## Goal

All money I/O in one place. TigerBeetle is the transaction engine — every balance-changing event is a double-entry transfer enforced at the database level. Postgres stores metadata, workflow state, and reporting views. Blockchain is the external settlement rail. x402 is the edge payment protocol. The ledger records **economic events your app recognizes** — not raw blockchain events.

## Scope: Money-Movement Core

The ledger covers only operations that actually touch value. In the current system, that is 5-7 operations:

| Operation                               | Debit                             | Credit                         | Source                                |
| --------------------------------------- | --------------------------------- | ------------------------------ | ------------------------------------- |
| **User tops up credits (USDC deposit)** | Assets:OnChain:USDC               | Liability:UserCredits          | On-chain watcher confirms finality    |
| **AI spend burns credits**              | Liability:UserCredits             | Revenue:AIUsage                | charge_receipts (LiteLLM cost oracle) |
| **Operator wallet funded**              | Assets:Treasury:USDC              | Assets:OperatorFloat:USDC      | Splits distribution                   |
| **OpenRouter top-up**                   | Assets:OperatorFloat:USDC         | Expense:AI:OpenRouter          | Coinbase Commerce tx confirmed        |
| **Hosting expense (Cherry Servers)**    | Assets:Treasury:EUR               | Expense:Infrastructure:Hosting | API poll / invoice                    |
| **Epoch accrual (attribution)**         | Expense:ContributorRewards:Equity | Liability:UnclaimedEquity      | Finalized epoch statement             |
| **On-chain claim settled**              | Liability:UnclaimedEquity         | Assets:EmissionsVault:COGNI    | MerkleDistributor claim tx            |

Operations that do NOT touch value (attribution scoring, weight computation, identity resolution) do NOT go through the ledger.

## Core Invariants

| Rule                         | Constraint                                                                                                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DOUBLE_ENTRY_CANONICAL       | TigerBeetle enforces balanced double-entry at the engine level. Every transfer debits one account and credits another. Unbalanced transactions are structurally impossible.                                                                                  |
| TIGERBEETLE_IS_BALANCE_TRUTH | TigerBeetle account balances are the source of truth for all monetary state. Postgres balances (e.g., `billing_accounts.balance_credits`) become reconciliation checks, not authoritative.                                                                   |
| LEDGER_PORT_IS_WRITE_PATH    | All money-movement operations go through `LedgerPort`. No direct TigerBeetle writes from feature code.                                                                                                                                                       |
| POSTGRES_IS_METADATA         | Postgres stores account names, descriptions, transfer explanations, workflow state, and reporting views. TigerBeetle stores balances and transfers. Linked via `user_data_128` fields.                                                                       |
| CHAIN_IS_SETTLEMENT          | Blockchain is the external settlement rail. TigerBeetle records the economic event when a chain transaction is confirmed. Do not mirror every raw blockchain event — record what the app recognizes (confirmed deposit, funded distributor, claimed tokens). |
| X402_AT_EDGE                 | x402 proves and settles external payments. TigerBeetle records how those payments change internal balances. The ledger works identically for prepaid credits and x402 per-request settlement.                                                                |
| ATTRIBUTION_NOT_FINANCIAL    | A signed attribution statement is a governance commitment (who earned what share), NOT a financial event. No money moves at epoch finalization. Optional accrual entry only.                                                                                 |
| FUNDING_IS_FINANCIAL         | Emissions funding of the MerkleDistributor IS a financial event.                                                                                                                                                                                             |
| CLAIM_IS_FINANCIAL           | User on-chain claim from the distributor IS a financial event (liability reduction).                                                                                                                                                                         |
| OPERATOR_PORT_REQUIRED       | Treasury actions (fund distributor, rotate Merkle roots, contract management) require an Operator Port — a signing + policy boundary. NOT a custodial wallet.                                                                                                |
| ALL_MATH_BIGINT              | No floating point in monetary calculations. TigerBeetle uses u128 natively.                                                                                                                                                                                  |
| MULTI_INSTRUMENT             | Separate TigerBeetle ledger IDs per asset type. Each is a first-class citizen with its own accounts.                                                                                                                                                         |
| SETTLEMENT_MANIFEST_REQUIRED | Every published distribution records a settlement manifest containing `epochId`, `statementHash`, `merkleRoot`, `totalAmount`, `fundingTxHash`, `publisher`, and `publishedAt`.                                                                              |
| TRUSTED_MVP_EXPLICIT         | MVP claim publication/funding is trusted governance execution (Safe/manual or equivalent), NOT on-chain emissions enforcement.                                                                                                                               |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Edge (payment protocols)                                    │
│  x402 inbound ─┐                                            │
│  USDC deposit  ─┤─→ App confirms payment                    │
│  API key auth  ─┘   (facilitator / on-chain watcher)        │
└────────────────────────────┬────────────────────────────────┘
                             │ economic event recognized
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  LedgerPort (src/ports/ledger.port.ts)                       │
│                                                              │
│  transfer(debit, credit, amount, ledger, metadata)           │
│  pendingTransfer(...)  →  postTransfer(...)  |  voidTransfer  │
│  lookupAccounts(ids)                                         │
│  getAccountBalance(id)                                       │
└────────────────────────────┬────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
┌──────────────────────┐     ┌──────────────────────────────┐
│  TigerBeetle          │     │  Postgres                     │
│  (transaction engine) │     │  (metadata + reporting)       │
│                       │     │                               │
│  Accounts:            │     │  account_metadata:            │
│   - id (u128)         │     │   - tb_account_id (u128)      │
│   - ledger (asset)    │     │   - name, type, owner         │
│   - debits_posted     │     │                               │
│   - credits_posted    │     │  transfer_metadata:           │
│   - user_data_128     │◄──►│   - tb_transfer_id (u128)     │
│                       │     │   - description, refs         │
│  Transfers:           │     │   - charge_receipt_id (FK)    │
│   - debit_account_id  │     │   - epoch_id, tx_hash, etc.  │
│   - credit_account_id │     │                               │
│   - amount (u128)     │     │  Existing tables:             │
│   - ledger            │     │   - charge_receipts           │
│   - user_data_128     │     │   - credit_ledger             │
│   - pending / posted  │     │   - payment_attempts          │
└──────────────────────┘     └──────────────────────────────┘
```

### Ledger IDs (Asset Types)

| Ledger ID | Asset                     | Scale | Unit                        |
| --------- | ------------------------- | ----- | --------------------------- |
| 1         | USD                       | 2     | cents                       |
| 2         | USDC                      | 6     | micro-USDC                  |
| 3         | EUR                       | 2     | euro-cents                  |
| 100       | COGNI (governance token)  | 0     | whole tokens                |
| 200       | CREDIT (internal credits) | 0     | whole credits (10M per USD) |

### Two-Phase Transfers

TigerBeetle's pending → posted/voided pattern maps to:

- **x402 `upto` authorization** → pending transfer (reserve max amount)
- **x402 settlement** → post transfer (actual cost) or void (cancelled)
- **Attribution accrual** → pending transfer (governance commitment)
- **On-chain claim** → post transfer (tokens actually moved)
- **Operator top-up** → pending transfer (charge created) → post (tx confirmed)

## Accounts Hierarchy

```
; --- Ledger 200: CREDIT (internal AI credits, 10M per USD) ---
Assets:UserDeposits:CREDIT          ; Credits minted from USDC deposits
Liability:UserCredits:CREDIT        ; User credit balances (owed to users)
Revenue:AIUsage:CREDIT              ; Credits burned on AI usage
Revenue:x402Settlements:CREDIT      ; x402 per-request revenue (future)

; --- Ledger 2: USDC (on-chain stablecoin, scale=6) ---
Assets:OnChain:USDC                 ; Confirmed on-chain USDC deposits
Assets:Treasury:USDC                ; DAO treasury wallet
Assets:OperatorFloat:USDC           ; Operator wallet working balance
Expense:AI:OpenRouter:USDC          ; OpenRouter provider costs
Expense:ContributorRewards:USDC     ; USDC distributions (governance-voted, future)

; --- Ledger 100: COGNI (governance token, scale=0) ---
Assets:EmissionsVault:COGNI         ; Pre-minted tokens awaiting release
Assets:Distributor:COGNI            ; Tokens locked in MerkleDistributor
Liability:UnclaimedEquity:COGNI     ; Committed but unclaimed distributions
Expense:ContributorRewards:COGNI    ; Equity token distributions per epoch

; --- Ledger 3: EUR (fiat for hosting costs, scale=2) ---
Assets:Treasury:EUR                 ; EUR balance (for hosting payments)
Expense:Infrastructure:Hosting:EUR  ; Cherry Servers hosting costs
```

## Financial Events

**Real-time (per AI call):**

1. **AI spend**: User's credit balance debited, revenue credited. Triggered by `recordChargeReceipt()`.

**Per deposit:**

2. **USDC deposit confirmed**: On-chain watcher confirms finality → mint credits to user's account.

**Per operator cycle:**

3. **Splits distribution**: Operator share arrives in wallet → record float increase.
4. **OpenRouter top-up**: Operator wallet funds OpenRouter → record provider expense.

**Per epoch:**

5. **Epoch signed (optional accrual)**: Pending transfer: Expense:ContributorRewards:COGNI → Liability:UnclaimedEquity:COGNI.
6. **EmissionsVault funds distributor**: Post transfer: tokens move on-chain via Operator Port.
7. **User claims on-chain**: Liability reduction via MerkleDistributor claim tx.

**Periodic:**

8. **Cherry Servers invoice**: API poll → record hosting expense.

**x402 (forward path):**

9. **x402 inbound**: Facilitator settles → pending transfer → post with actual cost.

## Design

### LedgerPort Integration Points

The LedgerPort is called from these existing code paths:

| Existing code path                         | What changes                                          |
| ------------------------------------------ | ----------------------------------------------------- |
| `AccountService.recordChargeReceipt()`     | Also calls `LedgerPort.transfer()` for AI spend       |
| `AccountService.creditAccount()` (deposit) | Also calls `LedgerPort.transfer()` for credit mint    |
| Attribution `finalizeEpoch()`              | Also calls `LedgerPort.pendingTransfer()` for accrual |
| Operator wallet top-up (new)               | Calls `LedgerPort.transfer()` for OpenRouter expense  |
| Cherry Servers cron (new)                  | Calls `LedgerPort.transfer()` for hosting expense     |

The pattern is **co-write**: the existing Postgres operation continues to work, and a TigerBeetle transfer is recorded alongside it. TigerBeetle becomes the balance authority over time; Postgres balances become reconciliation checks.

### MVP Settlement Path

1. Attribution finalization produces a signed `AttributionStatement`.
2. Settlement resolves each finalized claimant to a wallet address.
3. `computeMerkleTree()` derives leaves from statement `credit_amount` entitlements.
4. The settlement token is the Aragon `GovernanceERC20` minted at node formation.
5. DAO-controlled trusted execution publishes a per-epoch Merkle root and funds the distributor.
6. Settlement publication stores a manifest linking `epochId`, `statementHash`, `merkleRoot`, `totalAmount`, `fundingTxHash`, `publisher`, and `publishedAt`.

### x402 Compatibility

The ledger architecture is designed to work identically for both billing models:

- **Prepaid credits (current)**: USDC deposit → TigerBeetle mint credits → spend burns credits
- **x402 per-request (forward)**: x402 `upto` → TigerBeetle pending transfer → post with actual cost → no credit balance needed

The x402 transition deletes `credit_ledger` and `billing_accounts.balance_credits` from Postgres. TigerBeetle's pending/posted transfers replace the DB-tracked credit balance natively.

## Enforcement Progression

| Phase     | What enforces the budget cap?                                                                                           | Source of truth for remaining supply                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Crawl** | Off-chain policy. Admin reviews. TigerBeetle balances provide real-time visibility.                                     | TigerBeetle `Assets:EmissionsVault:COGNI` balance                 |
| **Walk**  | Safe signers verify funding amount against policy before authorizing each release. TigerBeetle balance is the hard cap. | TigerBeetle + on-chain `emissionsHolder.balanceOf()` (must agree) |
| **Run**   | `EmissionsController` contract enforces caps via `require()`. TigerBeetle is reconciliation.                            | On-chain contract state                                           |

## Threat Model

| Threat                                           | MVP controls                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Signed statement exceeds budget policy           | Walk: Safe signers verify. Run: contract reverts. TigerBeetle balance provides real-time budget visibility in all phases. |
| Malicious maintainer changes settlement code     | Branch protection, required review, signed releases, reproducible artifacts.                                              |
| Compromised operator publishes wrong root/amount | Safe/manual policy, limited publisher set, manifest review.                                                               |
| Statement/root mismatch                          | Settlement manifest stores `statementHash`; root derived from signed statement.                                           |
| Replay/duplicate publication                     | One settlement record per epoch + explicit operator review.                                                               |
| Overfunding distributor                          | Funding amount = manifest `totalAmount`, reconciled against TigerBeetle balance.                                          |
| TigerBeetle/Postgres desync                      | Reconciliation cron compares TigerBeetle balances with Postgres state. Alert on divergence. TigerBeetle wins.             |

## Non-Goals

- Full GAAP reporting, tax, or accounting dimensions (Crawl)
- Decorating every operation magically — explicit LedgerPort calls from money-domain services
- Mirroring every raw blockchain event 1:1 — record economic events the app recognizes
- Building a "finance layer" — this is a money-movement core for 5-7 operations
- Beancount/hledger as runtime source of truth (export to plaintext accounting format for external audit if needed)
- Raw private key env vars (Operator Port uses keystore/Vault/CDP, never raw keys)

## Related

- [Attribution Ledger](./attribution-ledger.md) — governance truth (who earned what)
- [Billing Evolution](./billing-evolution.md) — current credit system (as-built)
- [x402 E2E](./x402-e2e.md) — per-request settlement (forward path)
- [Tokenomics](./tokenomics.md) — budget policy and settlement handoff
- [proj.financial-ledger](../../work/projects/proj.financial-ledger.md) — project roadmap
- [TigerBeetle docs](https://docs.tigerbeetle.com/) — transaction engine
