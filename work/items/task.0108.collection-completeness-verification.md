---
id: task.0108
type: task
title: "Collection completeness verification for epoch ingestion"
status: needs_triage
priority: 1
rank:
estimate: 2
summary: "Add a verification step that compares collected event counts against GitHub API totals before closing ingestion. Detect under-collection from rate limits, API failures, or pagination truncation."
outcome: "Each epoch collection run logs a completeness report (expected vs actual event counts). closeIngestion warns or blocks when discrepancy exceeds threshold."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-24
updated: 2026-02-24
labels: [governance, ledger, reliability]
external_refs:
---

# Collection Completeness Verification

## Problem

The epoch collection pipeline trusts that the GitHub adapter's GraphQL queries returned all events within the epoch window. There is no verification step. Under-collection (from rate limit exhaustion, API errors during pagination, or `maxEventsPerCall` caps) is indistinguishable from a quiet week.

SourceCred avoids this because its mirror incrementally catches up — missed data appears on the next run. Our windowed model has no catch-up mechanism after finalization.

## Design

### Verification Activity

Add a `verifyCollectionCompleteness` Temporal activity that runs after collection, before `closeIngestion`:

1. Query GitHub API for **total counts** within the epoch window:
   - `repository.pullRequests(states: MERGED, orderBy: {field: CREATED_AT}).totalCount` filtered to `mergedAt` within window
   - `repository.pullRequests.reviews.totalCount` filtered to `submittedAt` within window
   - Similar for closed issues
2. Compare against `SELECT COUNT(*) FROM activity_events WHERE event_time BETWEEN periodStart AND periodEnd GROUP BY event_type`
3. Log completeness report: `{ expected: { pr_merged: 12, review_submitted: 8 }, actual: { pr_merged: 12, review_submitted: 7 }, discrepancy: { review_submitted: -1 } }`

### Threshold Behavior

- Discrepancy = 0: proceed normally
- Discrepancy > 0, ≤ 10%: warn in logs + epoch metadata, allow closeIngestion
- Discrepancy > 10%: block closeIngestion, require manual override or re-collection

### Scope

- [ ] Add `verifyCollectionCompleteness` activity to scheduler-worker
- [ ] Add GitHub count queries (separate from collection queries — lightweight)
- [ ] Store completeness report in epoch metadata (JSONB field or separate table)
- [ ] Wire into `CollectEpochWorkflow` after collection, before auto-close
- [ ] Surface discrepancy in epoch detail API

## Validation

```bash
pnpm check
pnpm --filter scheduler-worker build
pnpm test
```

- [ ] Completeness report logged after each collection run
- [ ] closeIngestion warns when discrepancy > 0
- [ ] closeIngestion blocks when discrepancy > 10% (without manual override)

## Research

- [Gap Analysis](../../docs/research/ledger-collection-gap-analysis.md) — section 2b, 2e
