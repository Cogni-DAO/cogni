---
id: bug.0125
type: bug
title: Claimant ownership is bolted on as an enricher — should be a first-class pipeline phase
status: needs_merge
priority: 1
rank: 10
estimate: 5
summary: >
  Claimant ownership resolution is modeled as an "enricher evaluation" but it is
  actually a fundamental pipeline phase. The allocation model speaks in userId,
  then claimant-shares is injected as a mandatory enricher to retrofit multi-claimant
  support. This creates a fake "core evaluations" concept in the contracts package
  (policy masquerading as contract) and prevents clean multi-actor attribution.
outcome: >
  Ownership resolution is a distinct, required pipeline phase with its own contract
  interface. Receipts stay immutable. The allocator receives claimant-scoped input
  natively. No mandatory-enricher hack. The contracts package defines only type shapes.
spec_refs:
  - plugin-attribution-pipeline-spec
  - attribution-ledger-spec
assignees: []
credit:
project: proj.transparent-credit-payouts
branch: fix/bug0125-claimants
pr: https://github.com/Cogni-DAO/node-template/pull/507
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-03-02
updated: 2026-03-02

labels: [architecture, attribution]
external_refs:
---

# Claimant ownership is bolted on as an enricher — should be a first-class pipeline phase

## Problem

The current pipeline has a structural misfit:

1. **Allocation is user-scoped.** `SelectedReceiptForAllocation` has `userId: string`. `ProposedAllocation` has `userId: string`. `weightSumV0` groups by `userId`. This is the core allocation contract (`allocation.ts`).

2. **Claimant resolution is bolted on after allocation.** The claimant-shares "enricher" produces a `ClaimantSharesPayload` with per-subject `claimantShares[]`. At finalization, `loadLockedClaimantSubjects()` reads this evaluation, then `computeFinalClaimantAllocations()` and `computeAttributionStatementLines()` produce claimant-scoped output. This entire path bypasses the allocator.

3. **The contracts package enforces policy.** `core-evaluations.ts` declares claimant-shares as "mandatory" and exports `getEffectiveEnricherRefs()` to inject it into every profile. This is a policy decision living in what should be a pure type-shapes package.

**Symptoms:**

- `attribution-pipeline-contracts` has a `core-evaluations.ts` file that isn't types — it's constants and merge logic
- `PipelineProfile` needs `pluginEnricherRefs` (awkward name) because "core" enrichers are handled separately
- The allocator contract (`AllocationContext`) doesn't know about claimants at all
- `ProposedAllocation` (user-scoped) is computed, then thrown away during finalization — the real output comes from the claimant-shares evaluation path
- Multi-actor receipts require a special enricher, not native pipeline support

**Root cause:** Claimant ownership resolution was treated as "just another enricher" when it's actually a distinct pipeline concern — parallel to enrichment, not inside it.

## Analysis

### What the pipeline phases actually are

```
ingest → select → resolve ownership → enrich → allocate → review → finalize
                   ^^^^^^^^^^^^^^^^
                   THIS IS MISSING AS A FIRST-CLASS PHASE
```

### Current (broken) model

```
Receipt (has userId) → Selection (has userId) → Allocation (groups by userId)
                                                         ↓
                              claimant-shares enricher bolted on at finalization
                                                         ↓
                              FinalClaimantAllocation / StatementLine (claimant-scoped)
```

### Correct model

```
Receipt (immutable fact, has platformUserId hint)
  → Selection (included/excluded)
  → Ownership Resolution (receipt → claimantShares[], versioned, lockable)
  → Enrichment (optional evaluations: echo, ai-scores, etc.)
  → Allocation (claimant-scoped natively — input is already per-claimant)
  → Review overrides → Final allocations → Statement
```

### Key design decisions needed

1. **Ownership resolution is a derived record, not baked into the receipt.**
   Receipts stay immutable facts. Ownership is determined separately and can evolve
   (enrichers could update it, review could override it). But it MUST be locked before
   allocation runs.

2. **The allocator contract must accept claimant-scoped input.**
   `SelectedReceiptForAllocation` should carry `claimantShares[]` instead of bare `userId`.
   Or: the pipeline explodes receipts into per-claimant rows before feeding the allocator.
   GitHub's 1-receipt-1-author is the degenerate case (single claimant, 100% share).

3. **Ownership resolution has its own contract interface in the contracts package.**
   It's a TYPE shape (what does an ownership record look like?), not a policy
   (which enrichers are mandatory). The contracts package stays pure types.

4. **`core-evaluations.ts` gets deleted from contracts.**
   No mandatory enrichers. No `getEffectiveEnricherRefs()`. Profiles list ALL enrichers
   they want (back to `enricherRefs`, no `plugin` prefix needed).

## Affected files

### Contracts package (`packages/attribution-pipeline-contracts/`)

- `src/core-evaluations.ts` — **DELETE** (policy, not contract)
- `src/profile.ts` — `pluginEnricherRefs` → `enricherRefs` (no core/plugin split)
- `src/allocator.ts` — `AllocationContext` needs ownership-aware input type
- `src/index.ts` — remove core-evaluations exports, add ownership resolution types

### Ledger package (`packages/attribution-ledger/`)

- `src/allocation.ts` — `SelectedReceiptForAllocation` needs claimant awareness
- `src/claimant-shares.ts` — domain types stay; builder functions may move/change
- `src/store.ts` — ownership resolution storage (new or evolved from evaluation pattern)

### Plugins package (`packages/attribution-pipeline-plugins/`)

- Remove claimant-shares as core evaluation reference
- Profile uses plain `enricherRefs` again

### Worker (`services/scheduler-worker/`)

- `src/activities/enrichment.ts` — ownership resolution becomes its own phase
- `src/activities/ledger.ts` — `computeAllocations` and `finalizeEpoch` consume claimant-scoped data natively

## Requirements

- [ ] Ownership resolution is a distinct pipeline phase with its own contract interface
- [ ] Receipts remain immutable — no claimant data on the receipt itself
- [ ] Ownership records are versioned (draft/locked), like evaluations
- [ ] The allocator receives claimant-scoped input natively
- [ ] `core-evaluations.ts` deleted from contracts package
- [ ] Contracts package contains only type shapes, no policy
- [ ] Single-claimant receipts (GitHub) work as the degenerate case
- [ ] Multi-claimant receipts are natively supported
- [ ] `pnpm check` passes

## Review Feedback

### Blocking: upsertDraftClaimants conflict target mismatch

**File:** `packages/db-client/src/adapters/drizzle-attribution.adapter.ts:1707`

The `onConflictDoUpdate` targets `(nodeId, epochId, receiptId, inputsHash)` matching the `inputs_uniq` index. When the same receipt gets a different `inputsHash` (identity resolves between runs — userId goes from null to a real UUID), the INSERT has no conflict on `inputs_uniq` but violates the `draft_uniq` partial index. Since ON CONFLICT doesn't cover that constraint, Postgres throws an unhandled unique constraint violation, crashing `materializeSelection`.

**Fix:** Use raw SQL to target the partial index:

```sql
INSERT INTO epoch_receipt_claimants (...) VALUES (...)
ON CONFLICT (node_id, epoch_id, receipt_id) WHERE status = 'draft'
DO UPDATE SET resolver_ref = EXCLUDED.resolver_ref, algo_ref = EXCLUDED.algo_ref,
  inputs_hash = EXCLUDED.inputs_hash, claimants_json = EXCLUDED.claimants_json,
  created_by = EXCLUDED.created_by
```

### Non-blocking suggestions

1. **lockClaimantsForEpoch N+1 + missing draft deletion** (`drizzle-attribution.adapter.ts:1723`): Replace per-row loop with batch `INSERT...SELECT`, then delete drafts. Comment says "then delete the draft" but delete is missing.
2. **computeAllocations O(n\*m)** (`ledger.ts:655`): Build a Map from receiptWeights before the loop.
3. **Dead code**: `buildDefaultReceiptClaimantSharesPayload`, `parseClaimantSharesPayload`, `expandClaimantUnits`, `computeFinalClaimantAllocations`, `computeProposedAllocations`, `ProposedAllocation` have zero external consumers. Follow-up task.
4. **Missing test**: `materializeSelection` should verify `upsertDraftClaimants` is called for each receipt.

## Plan

_Needs design spike — this is an architectural change that affects the core pipeline model._

- [ ] Design the ownership resolution contract interface
- [ ] Design the claimant-scoped allocator input type
- [ ] Plan the migration path from current enricher-based model
- [ ] Break into implementation tasks

## Validation

```bash
pnpm check
```

## Review Checklist

- [ ] **Work Item:** `bug.0125` linked in PR body
- [ ] **Spec:** plugin-attribution-pipeline spec updated with ownership resolution phase
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
