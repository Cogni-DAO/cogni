---
id: bug.0243
type: bug
title: "Same-scope epoch selection re-selects receipts from prior epochs — credits double-counted"
status: needs_merge
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
pr: https://github.com/Cogni-DAO/node-template/pull/686
reviewer:
revision: 2
blocked_by:
deploy_verified: false
created: 2026-03-31
updated: 2026-04-01
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

1. **SCOPE_GATED_QUERIES does not help here** — `resolveEpochScoped(epochId)` (line 373) validates the current epoch belongs to this adapter's `scopeId`, but `getSelectionCandidates` never checks whether the receipt already has a selection row in a _different_ epoch of the _same_ scope.

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

## Design

### Outcome

Each receipt is selected for at most one epoch within a scope. The next `materializeSelection` run for epoch 2 will only see genuinely new receipts, not epoch 1 carryover.

### Approach

**Solution**: Add a `notInArray` pre-filter to `getSelectionCandidates()`. Before the main query, collect receipt IDs already selected in prior same-scope epochs, then exclude them. Uses `notInArray` — already imported and used in the adapter (line 91, used at line 1136).

Two-query pattern (follows existing adapter style — no subqueries used anywhere in db-client):

```typescript
// 1. Collect receipt IDs already claimed by other same-scope epochs
const priorEpochIds = await this.db
  .select({ id: epochs.id })
  .from(epochs)
  .where(and(eq(epochs.scopeId, this.scopeId), ne(epochs.id, epochId)));

const alreadySelected =
  priorEpochIds.length > 0
    ? await this.db
        .selectDistinct({ receiptId: epochSelection.receiptId })
        .from(epochSelection)
        .where(
          inArray(
            epochSelection.epochId,
            priorEpochIds.map((e) => e.id)
          )
        )
    : [];

const excludeIds = new Set(alreadySelected.map((r) => r.receiptId));

// 2. Existing query + filter
// Add to WHERE: excludeIds.size > 0 ? notInArray(ingestionReceipts.receiptId, [...excludeIds]) : undefined
```

**Reuses**: `notInArray` (already imported line 91, used at line 1136), `epochs` table join pattern, `this.scopeId` from adapter constructor (line 363).

**Rejected alternatives**:

1. **NOT EXISTS subquery** — cleaner SQL, but zero precedent in db-client. Every query in the adapter uses flat Drizzle builder chains with `inArray`/`notInArray`. Adding raw `sql` subqueries would be a style break.

2. **Pass prior-epoch context to SelectionContext** — changes the pipeline contract package (`attribution-pipeline-contracts`), requires updating all selection policy implementations, and adds complexity to `materializeSelection()`. Over-engineering for a query-level fix.

3. **Add `scope_id` column to `epoch_selection`** — schema migration + backfill for a column that's derivable via JOIN. Denormalization not justified.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] RECEIPT_SCOPE_AGNOSTIC: Cross-scope selection still works — filter is same-scope only (spec: attribution-ledger)
- [ ] SELECTION_POLICY_AUTHORITY: Updated docstring — query pre-filters same-scope prior selections, policy decides within remaining candidates (spec: plugin-attribution-pipeline)
- [ ] SELECTION_AUTO_POPULATE: No change to insert/update behavior — only candidate set is narrowed (spec: attribution-ledger)
- [ ] SELECTION_FREEZE_ON_FINALIZE: Untouched — finalized epochs still reject writes (spec: attribution-ledger)
- [ ] SCOPE_GATED_QUERIES: Preserved — `resolveEpochScoped` still validates epoch ownership (spec: attribution-ledger)
- [ ] PACKAGES_NO_SRC_IMPORTS: db-client imports only from `@cogni/*` packages and `drizzle-orm` (spec: packages-architecture)
- [ ] SIMPLE_SOLUTION: Two queries using existing `notInArray` pattern, no new abstractions
- [ ] ARCHITECTURE_ALIGNMENT: Change is adapter-internal, no port signature changes (spec: architecture)

### Files

- Modify: `packages/db-client/src/adapters/drizzle-attribution.adapter.ts` — add prior-epoch exclusion to `getSelectionCandidates()` (~15 lines), import `ne` from drizzle-orm
- Modify: `packages/attribution-ledger/src/store.ts` — update SELECTION_POLICY_AUTHORITY docstring (1 line)
- Test: `apps/web/tests/component/db/drizzle-attribution.adapter.int.test.ts` — add two tests: same-scope dedup + cross-scope preservation

### Data cleanup

Run once against production after deploy:

```sql
-- Delete epoch 2 selection rows for receipts that already exist in epoch 1 (same scope)
DELETE FROM epoch_selection
WHERE epoch_id = 2
  AND receipt_id IN (
    SELECT receipt_id FROM epoch_selection WHERE epoch_id = 1
  );
```

## Validation

**Command:**

```bash
pnpm dotenv -e .env.test -- vitest run --config vitest.component.config.mts apps/web/tests/component/db/drizzle-attribution.adapter.int.test.ts
```

**Expected:** "same-scope cross-epoch deduplication" test passes; "cross-scope selection preserved" test passes.

**Production verification after deploy + cleanup:**

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
