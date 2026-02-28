---
id: proj.financial-ledger
type: project
primary_charter:
title: "Financial Ledger — Co-op Settlement from Attribution Statements"
state: Active
priority: 1
estimate: 5
summary: "All money I/O in one place. Inbound USDC → treasury postings. Attribution statements → multi-instrument settlement (cash, retained equity, reserves). Double-entry-ish transaction log with co-op accounting semantics."
outcome: "Every dollar in and every dollar out has a matching posting. Attribution statements produce settlements split across cash, retained equity, and reserves. Treasury balances are auditable and deterministic. Shared ingestion spine feeds both Attribution and Treasury from common adapters."
assignees: derekg1729
created: 2026-02-28
updated: 2026-02-28
labels: [governance, payments, web3, treasury]
---

# Financial Ledger — Co-op Settlement from Attribution Statements

## Goal

Build the money side of the DAO. The Attribution Ledger answers "who did what and how much credit?" — this project answers "where did the money go?" Every inbound payment and every outbound distribution gets a posting. Attribution statements are consumed as input and produce multi-instrument settlements: cash now, retained equity (member capital accounts), and collective reserves. The system uses co-op patronage semantics, not speculative token economics.

The ingestion spine (adapters → receipts → cursors) is shared infrastructure across Attribution and Treasury. Everything downstream (selection vs. classification, allocation vs. posting, statement vs. settlement) is domain-specific by design.

## Supersedes

**proj.dao-dividends** (Paused) — that project's "update Split recipients from payout statement" P0 becomes one settlement instrument here. The broader scope (retained equity, reserves, reconciliation) was always missing from that project.

## Roadmap

### Crawl (P0) — Shared Ingestion Spine + Treasury Schema + Statement-to-Settlement

**Goal:** Standardize the receipt ingestion framework so both Attribution and Treasury share adapters, cursors, and append-only semantics. Stand up the Treasury schema (accounts, postings, settlements). Wire the first settlement path: finalized attribution statement → settlement with a single instrument (cash distribution via Splits contract).

| Deliverable                                                                                                                                          | Status      | Est | Work Item         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --- | ----------------- |
| Extract shared ingestion package (`@cogni/ingestion-core` or extend existing)                                                                        | Not Started | 2   | (create at start) |
| Add `domain` field to `IngestionReceipt` envelope (`attribution` / `treasury`)                                                                       | Not Started | 1   | (create at start) |
| Treasury domain schema: `treasury_accounts`, `treasury_postings`, `treasury_settlements`                                                             | Not Started | 3   | (create at start) |
| Settlement port interface (`SettlementStore`) — separate from `AttributionStore`                                                                     | Not Started | 2   | (create at start) |
| `computeSettlement(statement, policy)` pure function — takes attribution statement + settlement policy, returns settlement with instrument breakdown | Not Started | 2   | (create at start) |
| V0 settlement policy: 100% cash (single instrument, matches current proj.dao-dividends P0)                                                           | Not Started | 1   | (create at start) |
| Settlement execution: update Splits recipients from settlement, trigger `distributeERC20()`                                                          | Not Started | 2   | task.0085         |
| Treasury adapter for on-chain receipts (USDC inbound payments → treasury postings)                                                                   | Not Started | 2   | (create at start) |
| Temporal workflow: `SettleEpochWorkflow` — reads finalized statement, computes settlement, executes distribution, records postings                   | Not Started | 2   | (create at start) |

### Walk (P1) — Co-op Multi-Instrument Settlement + Member Accounts

**Goal:** Settlement splits across three instruments per co-op patronage model. Member capital accounts track retained equity. Reserve fund accumulates collective balance. Governance controls the split policy.

| Deliverable                                                                                           | Status      | Est | Work Item            |
| ----------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Settlement policy schema: `{ cash_pct, retained_equity_pct, reserve_pct }` in repo-spec               | Not Started | 1   | (create at P1 start) |
| `treasury_member_accounts` — per-user retained equity balances (capital credits)                      | Not Started | 2   | (create at P1 start) |
| `treasury_reserve_fund` — collective reserve balance with component tracking                          | Not Started | 1   | (create at P1 start) |
| Multi-instrument `computeSettlement()` — splits each user's share across cash/equity/reserve          | Not Started | 2   | (create at P1 start) |
| Settlement execution for retained equity — record postings to member accounts (no on-chain tx)        | Not Started | 2   | (create at P1 start) |
| Governance snapshot pinning at settlement: `ledger_code_ref`, `manifest_hash`, settlement policy hash | Not Started | 2   | (create at P1 start) |
| Treasury read API: member balance, reserve balance, settlement history                                | Not Started | 2   | (create at P1 start) |

### Run (P2+) — Git-Canonical Bundles, Federation, Equity Redemption

**Goal:** Finalized statements and settlements become git-canonical artifacts. Fork-inheritable credit history. Member equity redemption (converting retained equity to cash). Federation royalty pool components.

| Deliverable                                                                                         | Status      | Est | Work Item            |
| --------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Git-canonical `bundle.v1.json` — finalized statement + settlement + hash chain (`prev_bundle_hash`) | Not Started | 3   | (create at P2 start) |
| Bundle commit bot: PR flow, Postgres becomes index keyed by `(bundle_hash, commit_sha)`             | Not Started | 2   | (create at P2 start) |
| Equity redemption workflow — convert retained equity to cash distribution                           | Not Started | 2   | (create at P2 start) |
| Federation `upstreams[]` — reference upstream bundles for fork-inheritable credit                   | Not Started | 2   | (create at P2 start) |
| Foundation royalty pool component — enrolled nodes auto-insert upstream royalty into pool           | Not Started | 2   | (create at P2 start) |
| Portable identity mapping — wallet addresses as cross-fork recipient identifiers                    | Not Started | 2   | (create at P2 start) |
| On-chain Merkle root anchoring for settlement bundles                                               | Not Started | 2   | (create at P2 start) |

## Constraints

- Financial Ledger does NOT redefine attribution semantics — it consumes finalized `AttributionStatement` as input
- Ingestion spine is shared; everything downstream is domain-specific (no garbage abstractions across domains)
- All monetary math uses BIGINT (inherits `ALL_MATH_BIGINT` from attribution-ledger spec)
- Treasury postings are append-only (double-entry: every debit has a matching credit)
- Settlement is multi-instrument from day one in the schema, even if V0 only uses cash
- No custom on-chain contracts — use pre-deployed Splits infrastructure (inherited from proj.dao-dividends)
- Co-op semantics: retained equity is par-value member capital (redeemable at face value), NOT speculative governance tokens
- Reserve fund is collective/unallocated — not claimable per member on exit
- Settlement policy is governance-controlled, stored in repo-spec (same pattern as `ledger.approvers`)
- V0: Postgres-canonical. Git-canonical bundles are P2 (don't dump raw data into git prematurely)
- Temporal workflow IDs and config keys: use `treasury-*` namespace (separate from `ledger-collect-*`)

## Dependencies

- [x] proj.transparent-credit-payouts P0 — finalized attribution statements exist
- [ ] proj.ai-operator-wallet P0 — operator wallet + Splits contract operational
- [ ] Shared ingestion spine extraction (P0 deliverable of this project)
- [ ] task.0085 — DAO treasury forwarding (settlement execution reuses this)

## As-Built Specs

- [attribution-ledger](../../docs/spec/attribution-ledger.md) — ingestion spine, receipt schema, cursor model (to be shared)
- [billing-evolution](../../docs/spec/billing-evolution.md) — credit unit standard, charge receipts
- [cred-licensing-policy](../../docs/spec/cred-licensing-policy.md) — federation enrollment model (P2 dependency)
- [web3-openrouter-payments](../../docs/spec/web3-openrouter-payments.md) — operator wallet economics

## Design Notes

### Three-domain ingestion, two-ledger accounting

```
SHARED INGESTION SPINE
├── Source Adapters (GitHub, Discord, on-chain, billing)
├── IngestionReceipt { ..., domain: 'attribution' | 'treasury' }
├── IngestionCursor (incremental sync, idempotent)
└── Append-only, provenance-tracked

ATTRIBUTION LEDGER (who did what)          FINANCIAL LEDGER (where money went)
├── Selection (curation)                   ├── Classification (tx categorization)
├── Evaluation (scoring/features)          ├── Postings (double-entry debits/credits)
├── Allocation (units/statements)          ├── Settlement (multi-instrument fulfillment)
└── Statement (deterministic output)       └── Reconciliation (on-chain ↔ off-chain)
```

### Co-op settlement model

An attribution statement says: "User A earned 40%, User B earned 35%, User C earned 25% of a 10,000 credit pool."

Settlement policy (governance-controlled) says: `{ cash_pct: 60, retained_equity_pct: 30, reserve_pct: 10 }`

Settlement produces:

- **Cash now**: 60% of each user's share → on-chain USDC via Splits
- **Retained equity**: 30% of each user's share → credited to member capital account (redeemable later)
- **Reserve fund**: 10% of pool → collective reserve (not per-member)

This matches co-op patronage norms: partial cash distribution, partial retained patronage (allocated equity redeemable at face value on a revolving schedule), and collective reserves for stability.

### What is NOT a governance token

Retained equity is NOT a speculative asset. It's a par-value capital credit — you contributed $X of value, the co-op owes you $X, redeemable when the revolving fund schedule allows. No market, no trading, no volatility. This is the clean co-op model.

If governance tokens (Aragon GovernanceERC20) are used separately for voting power, that's a different concern entirely. Don't conflate voting power with economic claims.

### OSS reference implementations

- **Open Collective** — transaction pairing/grouping, expense→approval→payout flows. Reference for the posting/settlement layer, NOT for attribution.
- **SourceCred** — `data/ledger.json` in-repo pattern. Reference for P2 git-canonical bundles.
- **Coordinape** — peer allocation per epoch. Different philosophy (we use explicit weights + admin finalize), but useful as comparison point.

### What V0 explicitly defers

- Multi-instrument settlement (P1 — V0 is 100% cash)
- Retained equity / member capital accounts (P1)
- Reserve fund accounting (P1)
- Governance snapshot pinning (P1)
- Git-canonical finalized bundles (P2)
- Fork-inheritable credit history (P2)
- Federation royalty pool components (P2)
- Equity redemption schedules (P2)
- On-chain Merkle anchoring (P2)
- Voting thresholds / multisig quorum for settlement approval (P2)
- Dolt or table-level branch/merge (P2+ option, not planned)
