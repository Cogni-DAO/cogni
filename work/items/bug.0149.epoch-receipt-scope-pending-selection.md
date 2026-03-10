---
id: bug.0149
type: bug
title: "Epoch receipt scope too narrow + pendingSelectionDto fabricates inclusion"
status: done
priority: 0
rank: 10
estimate: 2
summary: "Two bugs cause incorrect epoch data: (1) getUnselectedReceipts filters by eventTime window, preventing cross-epoch promotion; (2) pendingSelectionDto fabricates included:true for receipts with no selection row."
outcome: "Selection policy is sole authority on epoch membership. Activity route shows UNION of window + epoch-selected receipts. No fabricated selection state."
spec_refs: []
assignees: []
credit:
project:
branch: fix/bug-0149-epoch-receipt-scope
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-10
updated: 2026-03-10
labels: [attribution, correctness]
external_refs:
---

# Epoch receipt scope too narrow + pendingSelectionDto fabricates inclusion

## Observed

Two bugs cause incorrect epoch data on preview:

1. **Epoch receipt scope is too narrow**: `getUnselectedReceipts` filters by `eventTime ∈ [periodStart, periodEnd]`. Selection policies can only see/select receipts from the current epoch's time window. The promotion policy needs to select staging PRs from previous epochs when their release PR appears in the current epoch.

2. **`pendingSelectionDto` bypasses selection policy**: When a receipt has no selection row but identity resolves at read-time, the activity API fabricates `included: true`, making unmerged PRs appear as included.

## Expected

1. Selection policy — not the time window — is the authority on which receipts belong to an epoch.
2. `selection: null` means "pending" (already in contract schema). No fabricated selection state.

## Design

### Fix 1: Delete `pendingSelectionDto`

**File**: `src/app/api/v1/attribution/epochs/[id]/activity/route.ts`

Replace branching with simple: if selection exists, map it (with resolved userId if available); else null.

**File**: `src/app/api/v1/public/attribution/_lib/attribution-dto.ts`

Delete `pendingSelectionDto` entirely — zero other callers.

### Fix 2: Unbounded selection candidates + UNION display

**Change A**: Rename `getUnselectedReceipts` → `getSelectionCandidates`, remove `periodStart`/`periodEnd` params. The leftJoin on epoch_selection already scopes to the specific epoch.

**Change B**: Activity route — UNION display. Load both window receipts (may be pending) + epoch-selected receipts (may be cross-epoch). Deduplicate by receiptId.

**Change C**: Add `getReceiptsForEpoch` method — returns all receipts that have a selection row for the given epoch.

**Change D**: Update all callers of renamed method.

## Allowed Changes

- `src/app/api/v1/attribution/epochs/[id]/activity/route.ts`
- `src/app/api/v1/public/attribution/_lib/attribution-dto.ts`
- `packages/attribution-ledger/src/store.ts`
- `packages/db-client/src/adapters/drizzle-attribution.adapter.ts`
- `services/scheduler-worker/src/activities/ledger.ts`
- Tests (mock/integration) for above files

## Plan

- [x] **Checkpoint 1**: Delete `pendingSelectionDto`
  - Milestone: No fabricated selection state; `selection: null` for pending receipts
  - Todos:
    - [ ] Remove `pendingSelectionDto` from activity route import and usage
    - [ ] Simplify selection logic in activity route
    - [ ] Delete `pendingSelectionDto` function from attribution-dto.ts
  - Validation:
    - [ ] `pnpm check` passes

- [x] **Checkpoint 2**: Rename `getUnselectedReceipts` → `getSelectionCandidates`
  - Milestone: Selection candidates are no longer filtered by time window
  - Todos:
    - [ ] Rename in store.ts interface (SelectionWriter), remove periodStart/periodEnd params
    - [ ] Rename + update implementation in drizzle-attribution.adapter.ts
    - [ ] Update call site in ledger.ts materializeSelection
    - [ ] Update all test mocks
  - Validation:
    - [ ] `pnpm check` passes
    - [ ] `pnpm test` passes

- [x] **Checkpoint 3**: Add `getReceiptsForEpoch` + UNION display in activity route
  - Milestone: Activity route shows both window receipts and cross-epoch promoted receipts
  - Todos:
    - [ ] Add `getReceiptsForEpoch` to ReceiptStore interface in store.ts
    - [ ] Implement in drizzle-attribution.adapter.ts
    - [ ] Update activity route to UNION window + epoch-selected receipts
    - [ ] Update test mocks for new method
  - Validation:
    - [ ] `pnpm check` passes
    - [ ] `pnpm test` passes

## Validation

```bash
pnpm check
pnpm test
```

## Review Checklist

- [ ] **Work Item:** `bug.0149` linked in PR body
- [ ] **Tests:** updated mocks and assertions
- [ ] **No schema migrations** — pure interface + query changes
