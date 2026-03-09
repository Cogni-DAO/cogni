---
id: spike.0082
type: spike
title: Design transparency log storage, receipt signing, and distribution engine
status: done
priority: 1
estimate: 2
summary: Research and design the WorkReceipt schema, transparency log storage strategy, signing approach, Merkle integrity model, and distribution engine inputs/outputs before implementation begins.
outcome: Design doc with concrete schema definitions, storage choice rationale, signing scheme selection, Merkle tree strategy, and distribution engine contract — ready for task decomposition.
spec_refs:
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
created: 2026-02-17
updated: 2026-02-17
labels: [governance, transparency, research]
external_refs: docs/research/transparency-log-receipt-design.md
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Design: Transparency Log, Receipt Signing, and Distribution Engine

## Context

story.0081 introduces WorkReceipts, a transparency log, and a deterministic distribution engine. Before implementation, several design decisions need resolution. This spike produces a design doc answering the questions below.

## Requirements

### Research questions

1. **Receipt schema**: What exact fields, types, and constraints? How does `rule_version` reference versioned config? How do `artifact_refs` accommodate different artifact types (PR, governance run, manual approval)?

2. **Signing approach**: Ed25519 vs EIP-191 vs EIP-712 for receipt signatures? Must the signer be an Ethereum wallet (reuse SIWE key) or a separate service key? How do co-signatures work (multi-sig threshold or additive)?

3. **Transparency log storage**:
   - Postgres append-only table: what constraints enforce append-only (triggers? RBAC? application-level)?
   - Merkle tree: per-epoch batch tree or incremental (RFC 6962-style)? Stored in DB or computed on-demand?
   - Inclusion proof format: what does the API return? How does a client verify?
   - Future portability: what abstraction boundary keeps the consumer API stable if we swap to Trillian/Rekor later?

4. **Distribution engine contract**:
   - Weight rules format: YAML/JSON in repo? How is `rule_version` determined (git SHA, semver, epoch-specific)?
   - Edge cases: what if treasury is insufficient? What if a contributor has no wallet? What if rules change mid-epoch (must be forbidden — how is this enforced)?
   - Output format: payout table schema, DistributionStatement fields, how is it signed?

5. **Epoch model**: What defines an epoch boundary? Cron-based, manual trigger, block-based? What happens to receipts issued between epochs?

6. **Integration with existing systems**:
   - How does governance run approval (task.0054) feed into receipt issuance?
   - How does this relate to existing billing/charge_receipts tables?
   - Can the existing system tenant act as the receipt issuer?

### OSS landscape scan

- Evaluate Sigstore Rekor (transparency log) — useful as reference, but likely too heavy for MVP
- Evaluate merkle-tree libraries for Node/TypeScript
- Evaluate existing DAO payout tools (Coordinape, SourceCred) for schema inspiration — adopt conventions, not dependencies

## Allowed Changes

- New design doc in `docs/research/`
- No code changes — this is research only

## Plan

- [x] Survey existing receipt/payout schemas (Coordinape, SourceCred, Gitcoin)
- [x] Evaluate signing schemes (Ed25519 vs EIP-191) for receipt signatures
- [x] Design Postgres append-only table schema with Merkle integrity
- [x] Define epoch model and distribution engine contract
- [x] Write design doc with decisions, rationale, and diagrams
- [x] Identify task decomposition for story.0081 implementation

## Validation

**Command:**

```bash
# Design doc exists and passes docs validation
pnpm check:docs
```

**Expected:** Design doc in `docs/research/` with clear answers to all research questions. Ready for `/task` decomposition of story.0081.

## Review Checklist

- [ ] **Work Item:** `spike.0082` linked in PR body
- [ ] **Spec:** N/A (research only)
- [ ] **Tests:** N/A (research only)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Parent: [story.0081 — Work receipts, transparency log, and deterministic epoch payouts](story.0081.work-receipts-transparency-payouts.md)
- Related: [proj.decentralized-identity](../projects/proj.decentralized-identity.md)
- Related: [spike.0080 — DID identity research](spike.0080.did-identity-research.md)

## Attribution

- derekg1729
