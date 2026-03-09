---
id: bug.0121
type: bug
title: "Allocation adjustment API only supports per-user granularity — must support per-claimant/line-item editing for ledger review"
status: done
priority: 1
rank: 1
estimate: 5
summary: "The PATCH /epochs/[id]/allocations endpoint and underlying updateAllocationFinalUnits() operate at user-level granularity (one override per userId per epoch). The signed payout statement operates at claimant-level granularity (per-claimant line items, where one receipt can split across multiple claimants). Approvers reviewing a ledger before signing have no way to adjust individual statement line items — only the rolled-up user total."
outcome: "Approvers can edit individual statement line items (claimant-level or receipt-level) during review. The review UI renders editable rows at the correct granularity matching what gets signed."
spec_refs:
assignees: []
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-02
updated: 2026-03-02
labels: [governance, attribution, backend, data-model]
external_refs:
---

# Allocation adjustment API only supports per-user granularity — must support per-claimant/line-item editing for ledger review

## Observed

The `PATCH /api/v1/attribution/epochs/[id]/allocations` endpoint accepts `{ userId, finalUnits }` — one override per user per epoch. The store method `updateAllocationFinalUnits()` (`packages/attribution-ledger/src/store.ts:391-396`) updates `epoch_allocations.final_units` keyed by `(epoch_id, user_id)`.

But the **signed payout statement** operates at **claimant granularity**:

- `ClaimantSharesSubject.claimantShares[]` (`packages/attribution-ledger/src/claimant-shares.ts`) splits one receipt across **multiple claimants** via `sharePpm`
- `ClaimantCreditLineItem` is the actual line item in the signed statement — one per unique claimant
- Unresolved identities (`identity:github:12345`) are claimants with **no userId** — completely unreachable through the current PATCH endpoint
- `buildClaimantAllocations()` (`packages/attribution-ledger/src/claimant-shares.ts:444-501`) applies `final_units` overrides only to resolved `user` kind claimants

## Expected

An approver reviewing a ledger before signing should be able to:

1. See every **statement line item** (the same rows that go into the signed hash)
2. Edit the units/weight for any individual line item — linked user or unresolved identity
3. Save edits (distinct from signing) so they persist across page reloads
4. See the impact of edits on shares and credit amounts before signing

The review UI must present the same granularity that the signature covers. This is a ledger — every row must be inspectable and adjustable.

## Reproduction

1. `pnpm db:seed` (creates epochs with linked + unlinked contributors)
2. Navigate to `/gov/review` as an approver
3. EpochDetail table shows per-contributor rows with rolled-up Score
4. Expanding shows individual receipts — read-only
5. Unlinked/identity claimants have no userId → completely uneditable via PATCH

## Impact

**Blocker for task.0119** (epoch approver UI). The review page cannot present editable line items because the backend has no API for it. Without row-level edit capability, the review step is cosmetic only.

## Data Model Gap

| Layer                  | Granularity                  | Editable during review?    | Method                         |
| ---------------------- | ---------------------------- | -------------------------- | ------------------------------ |
| `activity_curation`    | Per-receipt                  | No (only while open)       | `upsertSelection()`            |
| `epoch_allocations`    | Per-user                     | Yes, but wrong granularity | `updateAllocationFinalUnits()` |
| `claimant_shares` eval | Per-receipt x claimant split | No (locked at review)      | N/A                            |
| Statement line items   | Per-claimant                 | No (derived, read-only)    | N/A                            |

Nothing is editable at the claimant/line-item level during review.

## Design Questions

- Override granularity: **claimant level** (one override per claimant key per epoch) or **receipt level** (per-receipt weight override during review)?
- Claimant-level: needs new table (e.g. `claimant_allocation_overrides`) keyed by `(epoch_id, claimant_key)`
- Receipt-level: could extend `activity_curation` to allow edits during review status
- Multi-claimant receipt splits: does the approver edit the split ratio, or absolute units per claimant?

## Allowed Changes

- `packages/attribution-ledger/src/store.ts` — new port method(s) for line-item-level overrides
- `packages/attribution-ledger/src/claimant-shares.ts` — override application at claimant level
- `packages/db-client/src/adapters/drizzle-attribution.adapter.ts` — implementation
- `src/app/api/v1/attribution/epochs/[id]/allocations/route.ts` — update or new endpoint
- `src/contracts/attribution.update-allocations.v1.contract.ts` — contract update
- Database migration for new override table/columns
- `services/scheduler-worker/src/activities/ledger.ts` — finalization to consume new overrides

## Plan

- [ ] Design: decide override granularity (claimant-level vs receipt-level)
- [ ] Schema: new migration for override storage
- [ ] Store: new port method + adapter implementation
- [ ] API: update PATCH contract or create new endpoint
- [ ] Worker: update `buildClaimantAllocations` to apply new overrides
- [ ] UI: update EpochDetail to present editable line items at correct granularity

## Validation

**Command:**

```bash
pnpm check && pnpm test && pnpm test:contract
```

**Expected:** New contract/unit tests verify line-item-level overrides applied correctly in the finalization flow. Review UI renders editable rows at claimant granularity.

## Review Checklist

- [ ] **Work Item:** `bug.0121` linked in PR body
- [ ] **Spec:** SIGNATURE_SCOPE_BOUND, APPROVERS_PINNED_AT_REVIEW upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Blocks: task.0119 (epoch approver UI depends on this fix)
- Key files: `packages/attribution-ledger/src/claimant-shares.ts`, `packages/attribution-ledger/src/store.ts:391-396`

## Attribution

-
