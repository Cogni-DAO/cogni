---
id: proj.financial-ledger
type: project
primary_charter:
title: "Financial Ledger — TigerBeetle Treasury + MerkleDistributor Settlement"
state: Active
priority: 1
estimate: 5
summary: "All money I/O in one place. TigerBeetle as the double-entry transaction engine, Postgres for metadata. LedgerPort is the write path for all money-movement. Signed attribution statements become auditable Merkle claim manifests and DAO-controlled token distributions."
outcome: "Every dollar in and every token out has a TigerBeetle double-entry transfer and an auditable settlement manifest. Finalized attribution statements produce DAO-controlled Merkle claims that contributors can actually claim on-chain."
assignees: derekg1729
created: 2026-02-28
updated: 2026-03-16
labels: [governance, payments, web3, treasury]
---

# Financial Ledger — TigerBeetle Treasury + MerkleDistributor Settlement

> Spec: [financial-ledger](../../docs/spec/financial-ledger.md)
> Ingestion: [data-ingestion-pipelines](../../docs/spec/data-ingestion-pipelines.md)

## Goal

Build the money side of the DAO. The Attribution Ledger answers "who did what and how much credit?" — this project answers "where did the money go?"

**Two settlement instruments, different triggers:**

| Instrument                   | Trigger                                   | Execution model                         |
| ---------------------------- | ----------------------------------------- | --------------------------------------- |
| **Governance/rewards token** | Finalized statement → published claim set | Trusted DAO-controlled execution in MVP |
| **USDC payouts**             | Governance vote                           | Manual / governance-gated (future)      |

**Key accounting separation:** A signed attribution statement is a governance commitment (who earned what share), NOT a financial event. Financial events occur only when funds move on-chain:

1. **Epoch signed** — optional accrual entry (Dr Expense:ContributorRewards:Equity / Cr Liability:UnclaimedEquity). No money moves.
2. **Treasury funds distributor** — real financial event (Dr Liability:UnclaimedEquity / Cr Assets:EmissionsVault:COGNI). Operator Port executes.
3. **User claims on-chain** — liability reduction via MerkleDistributor claim (equity tokens).
4. **Governance-voted USDC distribution** (future) — separate proposal + vote + execution path. Not automated by the attribution pipeline.

TigerBeetle is the transaction engine enforcing double-entry at the database level. Postgres stores operational metadata. Separate TigerBeetle ledger IDs per instrument type (USDC, COGNI, EUR, CREDIT). Rotki enriches crypto tx history and tax lots but is NOT the canonical ledger.

> **Design input:** [tokenomics spec](../../docs/spec/tokenomics.md) — budget policy, emission schedules, settlement handoff. Crawl phase (budget policy + UI) lives in `proj.transparent-credit-payouts`; Walk + Run (token distribution and settlement hardening) lives here.

## Supersedes

**proj.dao-dividends** (Superseded) — Splits-based push distribution replaced by MerkleDistributor user-initiated claims.

### Scope Split: proj.on-chain-distributions

Settlement-specific deliverables (Merkle tree generation, settlement manifests, recipient resolution, distributor deployment, claim UI, SettleEpochWorkflow) moved to [proj.on-chain-distributions](proj.on-chain-distributions.md). This project retains TigerBeetle accounting, USDC inbound receipts, treasury read APIs, and the double-entry transfer recording for settlement financial events.

## Roadmap

### Crawl (P0) — TigerBeetle Ledger + Rewards-Ready Formation

**Goal:** Wire TigerBeetle as the double-entry transaction engine for existing money-movement operations. Update node formation for rewards-ready token supply. Settlement artifacts and Merkle claims are owned by proj.on-chain-distributions.

| Deliverable                                                                                                                       | Status      | Est | Work Item   |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------- | --- | ----------- |
| TigerBeetle ledger + FinancialLedgerPort — 5-account MVP (credits + USDC), co-writes for AI spend + credit deposits               | In Review   | 3   | `task.0145` |
| Node formation update: mint fixed `GovernanceERC20` supply to a DAO-controlled emissions holder instead of founder bootstrap mint | Not Started | 2   | `task.0135` |

### Walk (P1) — Trusted GovernanceERC20 Claims

**Goal:** Wire TigerBeetle accounting for settlement financial events. Settlement artifacts, distributor deployment, and claim UI are owned by proj.on-chain-distributions.

| Deliverable                                                                                                                         | Status      | Est | Work Item            |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| On-chain receipt adapter: USDC inbound payments → TigerBeetle ledger transfers                                                      | Not Started | 2   | (create at P1 start) |
| Settlement financial events: distributor funding + claim → TigerBeetle transfers (consumes events from proj.on-chain-distributions) | Not Started | 2   | (create at P1 start) |
| Treasury read API: settlement history + manifest lookup (queries TigerBeetle + settlement store)                                    | Not Started | 2   | (create at P1 start) |

### Run (P2+) — Accounting Hardening + Multi-Instrument

**Goal:** Richer accounting dimensions after live usage. On-chain enforcement and settlement primitives owned by proj.on-chain-distributions.

| Deliverable                                                                           | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Halvening emissions / richer budget policy after live usage                           | Not Started | 2   | (create at P2 start) |
| Member capital sub-accounts in TigerBeetle: `Liability:MemberEquity:{userId}`         | Not Started | 2   | (create at P2 start) |
| Reserve fund account: `Equity:Reserves:Collective`                                    | Not Started | 1   | (create at P2 start) |
| Equity redemption workflow — convert retained equity to USDC claim (governance-gated) | Not Started | 2   | (create at P2 start) |

## Constraints

- Financial Ledger does NOT redefine attribution semantics — it consumes finalized `AttributionStatement` as input
- Attribution finalization is NOT a financial event — it is a governance commitment (liability, not transfer)
- **Equity tokens are the primary distribution instrument** — USDC payouts are a separate, governance-voted action
- **Signed statement is the settlement input** — settlement consumes the finalized `AttributionStatement`; no second approval signature is introduced at settlement time
- **V0 settlement requires fully wallet-resolved claimants** — unresolved identity claimants remain in the signed statement but block on-chain settlement for that epoch
- **Multi-instrument capable** — separate TigerBeetle ledger IDs per asset type (USDC, COGNI, EUR, CREDIT)
- TigerBeetle is the canonical transaction engine; Postgres stores operational metadata
- Rotki for crypto tx enrichment/tax lots only — NOT the canonical ledger
- All monetary math uses BIGINT (inherits `ALL_MATH_BIGINT` from attribution-ledger spec)
- MerkleDistributor (Uniswap pattern) for on-chain claims — user-initiated, not push distribution
- No bespoke rewards token contract — reuse Aragon `GovernanceERC20`; distributor should be battle-tested
- Operator Port required for treasury signing — not a custodial wallet, not raw private keys
- MVP claims are **trusted governance execution** — Safe/manual or equivalent DAO-controlled publication and funding, not on-chain emissions enforcement
- Settlement manifest required for every published root/funding action
- Integrity controls are P0/P1, not a later nice-to-have: branch protection, required reviews, signed releases or attestations, reproducible builds, and Safe policy for publish/fund
- Co-op semantics: retained equity is par-value member capital, NOT speculative tokens
- Reserve fund is collective/unallocated — not claimable per member on exit
- Settlement policy is governance-controlled, stored in repo-spec (same pattern as `ledger.approvers`)
- Temporal workflow IDs and config keys: use `treasury-*` namespace (separate from `ledger-collect-*`)
- Off-chain budget policy informs settlement accounting, but it is **not** the hard security boundary for token release

## Dependencies

- [x] proj.transparent-credit-payouts P0 — finalized attribution statements exist
- [ ] task.0130 (tokenomics Crawl) — budget policy replaces magic pool_config
- [ ] task.0142 (epoch pool value stabilization) — minimum activity threshold + carry-over prevents quiet-week windfalls before credits map to tokens
- [ ] spike.0140 (multi-source category pool design) — informs credit:token ratio and settlement policy shape
- [ ] Operator Port operational (signing + policy boundary for treasury actions)
- [ ] `task.0135` — rewards-ready token formation decisions and implementation completed
- [ ] Stock per-epoch MerkleDistributor path selected and deployed on Base
- [ ] TigerBeetle deployed + LedgerPort wired (task.0145)

**Crawl handoff into this project:**

- `task.0130` retires `pool_config.base_issuance_credits` in favor of `budget_policy`.
- `budget_bank_ledger` is seeded from historical finalized `base_issuance` totals; settlement does not infer extra future issuance from quiet historical epochs.
- Settlement still starts from finalized signed statements. Budget policy changes pool sizing policy, not claimant allocation semantics.

## As-Built Specs

- [financial-ledger](../../docs/spec/financial-ledger.md) — treasury accounting invariants, accounts hierarchy
- [tokenomics](../../docs/spec/tokenomics.md) — budget policy and settlement handoff (design input, proposed)
- [data-ingestion-pipelines](../../docs/spec/data-ingestion-pipelines.md) — shared event archive, Singer taps
- [attribution-ledger](../../docs/spec/attribution-ledger.md) — ingestion spine, receipt schema, cursor model
- [billing-evolution](../../docs/spec/billing-evolution.md) — credit unit standard, charge receipts (current as-built)
- [cred-licensing-policy](../../docs/spec/cred-licensing-policy.md) — federation enrollment model (P2 dependency)

## Design Notes

### Shared event archive, N domain pipelines

```
LAYER 0 — EVENT ARCHIVE (shared, domain-agnostic)
├── ingestion_receipts  (append-only raw facts, NO domain tag)
├── ingestion_cursors   (adapter sync state)
├── Source adapters     (Singer taps + V0 TS adapters, coexisting)
├── Deterministic IDs   (e.g., github:pr:owner/repo:42)
└── Provenance          (producer, producerVersion, payloadHash)

LAYER 1 — DOMAIN PIPELINES (each selects independently from Layer 0)
├── Attribution:  select → evaluate → allocate → statement (governance truth)
├── Treasury:     classify → journal entry → settlement → reconciliation (financial truth)
├── Knowledge:    extract → link → version (future)
└── ???:          whatever the AI-run DAO needs next
```

### Two-instrument settlement model

An attribution statement says: "User A earned 40%, User B earned 35%, User C earned 25% of a 10,000 credit pool."

**V0 (Crawl/Walk):** 100% governance/rewards token. Statement → settlement manifest → per-epoch Merkle root → users claim tokens from `MerkleDistributor` under trusted DAO-controlled execution.

**V1+ (Run):** Settlement policy (governance-controlled) may split across instruments:

- **Equity tokens**: Primary instrument. Claimable from MerkleDistributor (automated per epoch).
- **Retained equity**: Credited to member capital account in TigerBeetle (redeemable later, not on-chain).
- **USDC (governance-voted)**: Separate from automated attribution. Governance proposal → vote → operator executes. Can be pro-rata to token holders or per-statement.

### Equity token = governance + ownership

The rewards token IS the Aragon `GovernanceERC20` created at node formation. Single-token model in V0. Contributors earn governance power and ownership claim through the same token. For settlement, the fixed supply is minted to a DAO-controlled emissions holder, and epoch budgets determine how much of that supply becomes claimable over time. Governance can vote to:

- Distribute USDC from treasury to token holders
- Modify settlement policy for future epochs
- Extend the EmissionsVault with additional token supply (new governance vote required)

Retained equity (P1) is par-value member capital — redeemable at face value on a revolving schedule. Not speculative.

### OSS reference implementations

- **Uniswap MerkleDistributor** — battle-tested per-epoch claim contract. Our default MVP on-chain settlement primitive.
- **TigerBeetle** — purpose-built financial transactions database (Apache 2.0, Jepsen-verified). Our canonical ledger engine.
- **Rotki** — crypto bookkeeping/tax assistant. Enrichment + validation, not canonical.
- **Open Collective** — transaction pairing/grouping, expense→approval→payout flows. Reference for the posting/settlement layer.
- **SourceCred** — `data/ledger.json` in-repo pattern. Reference for P2 git-canonical bundles.

### Threat model

- Malicious maintainer changes the settlement code path or manifest before release.
- Compromised operator publishes a root early or funds the wrong amount.
- Statement/root mismatch: valid statement, wrong published root.
- Replay or duplicate publication for an epoch.
- Overfunding a distributor beyond the intended epoch amount.

Controls live in the spec and constraints for this project: required review, signed release or attestation, reproducible settlement artifacts, Safe/manual execution policy, settlement manifest storage, and epoch-level publication records.

### What V0 explicitly defers

- USDC distribution (governance-voted, separate from automated equity distribution) (P1)
- Halvening emissions / era-based decay (P1)
- Tokenomics template system (P1)
- Retained equity / member capital accounts (P1)
- Reserve fund accounting (P1)
- Governance snapshot pinning (P1)
- Git-canonical finalized bundles (P2)
- Fork-inheritable credit history (P2)
- Federation royalty pool components (P2)
- Equity redemption schedules (P2)
- On-chain Merkle anchoring (P2)
- Voting thresholds / multisig quorum for settlement approval (P2)

## PR / Links

- Handoff: [handoff](../handoffs/proj.financial-ledger.handoff.md)
