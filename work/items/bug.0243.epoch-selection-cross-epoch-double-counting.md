---
id: bug.0243
type: bug
title: "Same-scope epoch selection re-selects receipts from prior epochs — credits double-counted"
status: needs_design
priority: 0
rank: 1
estimate: 2
summary: "getSelectionCandidates() LEFT JOINs epoch_selection scoped only to the current epochId, so receipts already selected by a prior same-scope epoch appear as candidates again. The selection policy has no prior-epoch context and re-includes them. Result: identical PRs appear in both epoch 1 and epoch 2 on the production dashboard."
outcome: "Within a single (node_id, scope_id), each receipt is selected for at most one epoch. Cross-scope selection remains allowed per RECEIPT_SCOPE_AGNOSTIC."
spec_refs: [plugin-attribution-pipeline]
assignees: []
credit:
project:
branch: fix/epoch-selection-cross-epoch-dedup
pr:
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-03-31
updated: 2026-03-31
labels: [attribution, correctness, idempotency, critical]
external_refs:
---

# Same-scope epoch selection re-selects receipts from prior epochs

## Requirements

### Observed

The production attribution dashboard shows identical PRs in both epoch 1 (3/22–3/29) and epoch 2 (3/29–4/5). All 13 contributions from epoch 1 reappear in epoch 2 with the same scores. Epoch 2 shows 16 items: the 13 duplicates plus 3 genuinely new PRs.

**Root cause:** `getSelectionCandidates()` at `packages/db-client/src/adapters/drizzle-attribution.adapter.ts:1772-1804` LEFT JOINs `epoch_selection` scoped only to the **current** `epochId`:

```sql
LEFT JOIN epoch_selection
  ON (epoch_selection.epoch_id = :currentEpochId
      AND epoch_selection.receipt_id = ingestion_receipts.receipt_id)
WHERE epoch_selection.id IS NULL   -- no row for THIS epoch
   OR epoch_selection.user_id IS NULL  -- unresolved for THIS epoch
```

A receipt selected for epoch 1 has no selection row for epoch 2, so the query returns it as a candidate again. The `UNIQUE(epochId, receiptId)` constraint (`packages/db-schema/src/attribution.ts:169`) is per-epoch, allowing the same receipt in multiple epochs — which is **by design** for cross-scope selection (RECEIPT_SCOPE_AGNOSTIC), but wrong when both epochs share the same `scope_id`.

**Contributing factors:**

1. **SCOPE_GATED_QUERIES does not help here** — `resolveEpochScoped(epochId)` (line 373) validates the current epoch belongs to this adapter's `scopeId`, but `getSelectionCandidates` never checks whether the receipt already has a selection row in a *different* epoch of the *same* scope.

2. **SelectionContext has no prior-epoch data** — `SelectionContext` (`packages/attribution-pipeline-contracts/src/selection.ts:32-37`) provides `receiptsToSelect` and `allReceipts` but no prior-epoch selection information. The policy cannot deduplicate even if it wanted to.

3. **SELECTION_POLICY_AUTHORITY tension** — The store docstring states "the selection policy decides epoch membership, not the query." But the policy receives no epoch context to make that decision. Either the query must pre-filter, or the policy must receive prior-epoch data.

### Expected

Within a single `(node_id, scope_id)`, each receipt is selected for at most one epoch. Cross-scope selection (same receipt in different projects' epochs) remains allowed per RECEIPT_SCOPE_AGNOSTIC.

### Reproduction

Visible on production dashboard right now:
- Epoch #1 (3/22–3/29): 13 PRs, all score 1000
- Epoch #2 (3/29–4/5): 16 PRs — the same 13 from epoch 1 plus 3 new ones

SQL verification:

```sql
SELECT es.receipt_id, COUNT(DISTINCT es.epoch_id) AS epoch_count
FROM epoch_selection es
JOIN epochs e ON e.id = es.epoch_id
WHERE e.scope_id = (SELECT scope_id FROM epochs WHERE id = 1)
GROUP BY es.receipt_id
HAVING COUNT(DISTINCT es.epoch_id) > 1;
```

### Impact

- **Data integrity:** Credits double-counted across same-scope epochs. Same PR earns attribution in multiple periods.
- **Financial:** If epochs finalize, same work is paid twice via DAO treasury.
- **Severity:** P0 — affects all nodes running multi-epoch attribution.

## Allowed Changes

- `packages/db-client/src/adapters/drizzle-attribution.adapter.ts` — `getSelectionCandidates()` query
- `packages/attribution-ledger/src/store.ts` — interface docstrings if needed
- `packages/attribution-pipeline-contracts/src/selection.ts` — `SelectionContext` if epoch context is added
- `services/scheduler-worker/src/activities/ledger.ts` — `materializeSelection()` if filtering moves here
- Tests for the above
- Migration or data-fix script to clean up existing duplicates

## Plan

### Option A: Query-level same-scope exclusion (recommended — simplest, no contract changes)

Add a NOT EXISTS subquery to `getSelectionCandidates()` that excludes receipts already selected in any other epoch with the same `scope_id`. The adapter already has `this.scopeId` available:

```sql
AND NOT EXISTS (
  SELECT 1 FROM epoch_selection es_prior
  JOIN epochs e_prior ON e_prior.id = es_prior.epoch_id
  WHERE es_prior.receipt_id = ingestion_receipts.receipt_id
    AND e_prior.epoch_id != :currentEpochId
    AND e_prior.scope_id = :scopeId
)
```

- [ ] Add NOT EXISTS subquery to `getSelectionCandidates()` scoped to `this.scopeId`
- [ ] Update SELECTION_POLICY_AUTHORITY docstring to note the query now pre-filters same-scope prior selections
- [ ] Add test: two same-scope epochs — epoch 2 candidates exclude epoch 1 receipts
- [ ] Add test: two different-scope epochs — epoch 2 candidates still include cross-scope receipts (RECEIPT_SCOPE_AGNOSTIC preserved)

### Option B: Pass prior-epoch context to selection policy

- [ ] Add `priorScopeSelections` (receipt IDs already claimed in same scope) to `SelectionContext`
- [ ] Update selection policies to filter out prior-epoch receipts
- [ ] More complex, but preserves SELECTION_POLICY_AUTHORITY literally

### Data cleanup

- [ ] Write a one-time SQL or migration to remove duplicate same-scope selections from epoch 2 (keep epoch 1 rows, delete epoch 2 duplicates)

## Validation

**Command:**

```bash
pnpm vitest run --config vitest.config.mts packages/db-client/src/adapters/__tests__/drizzle-attribution-selection.test.ts
```

**Expected:** "same-scope cross-epoch deduplication" test passes; "cross-scope selection preserved" test passes.

**Production verification after deploy:**

```sql
SELECT es.receipt_id, COUNT(DISTINCT es.epoch_id) AS epoch_count
FROM epoch_selection es
JOIN epochs e ON e.id = es.epoch_id
WHERE e.scope_id = (SELECT scope_id FROM epochs WHERE id = 1)
GROUP BY es.receipt_id
HAVING COUNT(DISTINCT es.epoch_id) > 1;
-- Expected: zero rows
```

## Observability Gap (separate issue)

Agent review of this bug was hampered because the public attribution API (`/api/v1/public/attribution/epochs`) only returns finalized epochs. Open/review epoch data (including selection details) is only visible via the authenticated dashboard or direct DB access. A service-token-authed endpoint or expanding the public API to include open epochs would enable programmatic verification.

## Review Checklist

- [ ] **Work Item:** `bug.0243` linked in PR body
- [ ] **Spec:** SELECTION_POLICY_AUTHORITY invariant updated to reflect query pre-filtering
- [ ] **Spec:** RECEIPT_SCOPE_AGNOSTIC preserved — cross-scope selection still works
- [ ] **Tests:** same-scope dedup + cross-scope preservation
- [ ] **Data cleanup:** duplicate selections removed from production
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
