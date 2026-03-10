---
id: bug.0150
type: bug
title: "getAllReceipts query is unbounded — will degrade at scale"
status: needs_triage
priority: 3
rank: 99
estimate: 1
summary: "getAllReceipts(nodeId) in DrizzleAttributionAdapter loads all receipts for a node into memory with no pagination or time-bound. At ~50 receipts/week this is fine, but at scale (1000+ receipts) it will cause memory pressure and slow queries. The promotion-selection plugin needs the full set in memory for buildPromotedShas, so pagination alone doesn't help — the real fix is either a lookback window or pre-computed promoted SHAs."
outcome: "Receipt loading for selection policy has a bounded memory footprint. Either via a configurable lookback window (e.g., 90 days) or a materialized promoted_shas cache updated at ingestion time."
spec_refs: [plugin-attribution-pipeline]
assignees: []
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-10
updated: 2026-03-10
labels: [attribution, performance, scale]
external_refs:
---

# getAllReceipts query is unbounded — will degrade at scale

## Observed

`getAllReceipts(nodeId)` was added in PR #536 (bug.0148 fix) to enable cross-epoch promotion matching. The query has no LIMIT, no time filter, and no pagination:

```typescript
// packages/db-client/src/adapters/drizzle-attribution.adapter.ts:976
async getAllReceipts(nodeId: string): Promise<IngestionReceipt[]> {
  const rows = await this.db
    .select()
    .from(ingestionReceipts)
    .where(eq(ingestionReceipts.nodeId, nodeId))
    .orderBy(ingestionReceipts.eventTime);
  return rows.map(toIngestionReceipt);
}
```

The consumer (`materializeSelection` in `ledger.ts:608`) passes the full array as `allReceipts` to `SelectionContext`. The promotion-selection plugin iterates the entire set to build `promotedShas`.

## Impact

- At current volume (~50 receipts/week, ~2,600/year): no issue
- At 10K+ receipts: noticeable query latency + memory pressure in the worker
- The plugin needs all release PRs (baseBranch=main) visible — not all receipts

## Possible fixes (choose one)

1. **Lookback window** (simplest): `getReceiptsWithLookback(nodeId, days: 90)` — 5-line change. Cross-epoch matching rarely needs more than 2 epochs of history.
2. **Pre-computed promoted SHAs table**: Materialize `promoted_shas` at ingestion time. Plugin does a set lookup instead of a full scan. Better long-term, bigger change.
3. **Filtered query**: Only load release PRs (baseBranch=main) for the `allReceipts` set. Requires the plugin to declare what it needs from the context.

## Validation

**Command:**

```bash
pnpm test packages/attribution-pipeline-plugins/tests/
pnpm test services/scheduler-worker/tests/ledger-activities.test.ts
```

**Expected:** Existing promotion-selection tests pass with bounded query.

## Review Checklist

- [ ] **Work Item:** `bug.0150` linked in PR body
- [ ] **Spec:** plugin-attribution-pipeline invariants upheld
- [ ] **Tests:** verify cross-epoch matching still works with bounded query
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Introduced by: PR #536 (bug.0148 attribution pipeline correctness fix)

## Attribution

- derekg1729 — identified during bug.0148 review
