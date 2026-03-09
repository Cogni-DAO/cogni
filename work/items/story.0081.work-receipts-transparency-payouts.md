---
id: story.0081
type: story
title: Work receipts, transparency log, and deterministic epoch payouts
status: needs_triage
priority: 1
estimate: 5
summary: Replace ad-hoc contribution tracking with signed WorkReceipts appended to a transparency log, enabling deterministic, auditable payouts computed from receipts plus published weight rules.
outcome: Every payout can be independently verified from receipts, inclusion proofs, and published scoring rules — no admin trust required.
spec_refs:
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
created: 2026-02-17
updated: 2026-02-17
labels: [governance, transparency, payments, web3]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 25
---

# Work Receipts, Transparency Log, and Deterministic Epoch Payouts

## Context

CogniDAO currently tracks contributions informally. Payouts lack a verifiable chain from "work approved" to "funds distributed." This story introduces three primitives that make the entire contribution-to-payout pipeline auditable and trustless:

1. **WorkReceipt** — a signed artifact proving specific work was approved by an authorized party
2. **TransparencyLog** — an append-only ledger of receipts with Merkle integrity (inclusion proofs)
3. **DistributionEngine** — a deterministic job that computes payouts from receipts + versioned weight rules

### Relationship to Decentralized Identity (proj.decentralized-identity)

This story is designed to compose with the DID-first identity project:

- **MVP**: `subject_id` = SIWE wallet address (works today, no DID dependency)
- **Later**: `subject_id` = `did:pkh` once proj.decentralized-identity ships P0
- WorkReceipts can evolve into Verifiable Credentials (proj.decentralized-identity P1)
- Receipt portability across orgs aligns with federation goals (P2+)

The two efforts are independent in P0 but converge at P1+.

### Who benefits

- **Contributors**: Can verify their work is recorded and payouts are correct
- **DAO members**: Can audit any payout without trusting administrators
- **External observers**: Can independently verify the integrity of the log
- **Future forks**: Other DAOs can adopt the receipt + payout pipeline

## Requirements

### WorkReceipt object

- Unique `receipt_id` (UUID)
- `subject_id` — wallet address (MVP), later DID
- `artifact_refs` — PR URL, commit SHA, work item path, governance run ID (at least one required)
- `approved_by` (key ID) + `approved_at` (timestamp) — explicit approval, not implicit
- `units` (points/weight), `category`, `rule_version` — scoring metadata
- `signatures` — Ed25519 or EIP-191: issuer signature required, optional co-signers
- Schema is strict and versioned; changing scoring rules mid-epoch is forbidden

### Transparency log

- Append-only storage (Postgres MVP — monotonic index, no updates/deletes)
- Merkle tree computed over entries per epoch
- Publish `merkle_root` + signed root statement at epoch close
- Generate inclusion proof for any individual receipt
- Path to swap underlying store later (Trillian-style, Rekor-like) without changing consumer API

### Distribution engine

- Inputs: receipt set for epoch (by log range + root), weight rules (versioned config in repo), treasury balances
- Output: payout table (`subject_id` -> amount) + signed `DistributionStatement` referencing log root + `rule_version`
- Deterministic: same inputs always produce same outputs
- Epoch boundary is explicit (not wall-clock drift)

### UI surfaces (can be separate tasks)

- `/receipts` — filter by subject, epoch, category
- `/epoch/:id` — root, rules, payouts, inclusion proofs
- `/contributors/:id` — history, receipts, payouts

### Non-goals for MVP

- Full DID onboarding (use wallet address)
- On-chain storage of all events (anchor roots only, if at all)
- Complex reputation scores (receipts are the primitive; scores are derived later)
- Blockchain as primary data plane — use only for anchoring or settlement

## Allowed Changes

- New DB tables for receipts and transparency log
- New domain modules for receipt issuance, log management, distribution computation
- New API routes for receipt queries, epoch views, contributor history
- New UI pages/components for transparency surfaces
- Integration with existing governance approval flows (system tenant)
- Weight rules config files in repo

## Plan

- [ ] spike.0082 — design transparency log storage, receipt schema, signing approach
- [ ] Define WorkReceipt schema + DB migration
- [ ] Implement append-only transparency log with Merkle integrity
- [ ] Build receipt issuance flow (approval -> signed receipt -> log append)
- [ ] Build distribution engine (receipts + rules -> payout table + signed statement)
- [ ] Wire UI surfaces for receipts, epochs, and contributor history
- [ ] Integration with existing governance run outputs

## Validation

**Command:**

```bash
# After implementation — exact test paths TBD by spike.0082
pnpm test -- --grep "receipt|transparency|distribution"
```

**Expected:**

- Receipt issuance produces valid signed artifacts
- Log append is truly append-only (no mutation of existing entries)
- Merkle inclusion proofs verify correctly
- Distribution engine is deterministic (same inputs -> same outputs)
- UI surfaces render receipt and epoch data

## Review Checklist

- [ ] **Work Item:** `story.0081` linked in PR body
- [ ] **Spec:** all invariants of linked specs are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: [proj.decentralized-identity](../projects/proj.decentralized-identity.md)
- Related: [story.0063 — Governance visibility dashboard](story.0063.governance-visibility-dashboard.md)

## Attribution

- derekg1729
