---
id: bug.0146
type: bug
title: "Epoch transition deadlock: grace period prevents new epoch creation, halting all collection"
status: done
priority: 0
rank: 1
estimate: 2
summary: "CollectEpochWorkflow deadlocks at epoch window boundaries. The previous epoch's auto-close grace period (24h default) extends past the window boundary, but computeEpochWindowV1 has already moved to the next window. ensureEpochForWindow crashes on epochs_one_open_per_node constraint, and the auto-close step (step 10) is never reached. All collection halts."
outcome: "Epoch close happens at the start of a new epoch window (not on a timer). Grace period concept removed entirely. No deadlock at epoch transitions."
spec_refs:
  - attribution-ledger-spec
assignees: []
credit:
project:
branch: fix/bug-0146-epoch-transition-deadlock
pr: https://github.com/Cogni-DAO/node-template/pull/532
reviewer:
revision: 2
blocked_by:
deploy_verified: false
created: 2026-03-09
updated: 2026-03-24
labels: [attribution, scheduler, p0-outage]
external_refs:
---

# Epoch transition deadlock: grace period prevents new epoch creation, halting all collection

## Requirements

**Observed**: Every `CollectEpochWorkflow` run since 2026-03-09T00:00:00Z fails with `epochs_one_open_per_node` constraint violation. The workflow is permanently stuck — no GitHub events are collected into any epoch. Temporal retries the activity indefinitely.

The failure chain:

1. Epoch 1 (window: Mar 2-9, status: `open`) was never auto-closed because the 24h grace period pushes the close deadline to Mar 10 (`collect-epoch.workflow.ts:211`, `ledger.ts:912`).
2. On Mar 9 00:00 UTC the schedule fires. `computeEpochWindowV1` returns Mar 9-16 (new window).
3. `ensureEpochForWindow` at `ledger.ts:302` queries `getEpochByWindow(Mar 9-16)` — no match.
4. INSERT at `ledger.ts:339` hits `epochs_one_open_per_node` constraint (epoch 1 is still open).
5. Race recovery at `ledger.ts:360` re-queries `getEpochByWindow(Mar 9-16)` — still null (the open epoch is for a _different_ window).
6. Error rethrown. Workflow crashes at step 4 of 10. Auto-close (step 10) is never reached.
7. Temporal retries. Same result. Permanent deadlock.

**Root causes** (three compounding issues):

1. **Grace period creates an impossible timeline**: `autoCloseIngestion` (`ledger.ts:912-922`) delays close by 24h past `periodEnd`. But `computeEpochWindowV1` moves to the next window at exactly `periodEnd`. So the old epoch can never be closed by the workflow that would close it — that workflow now operates on the new window.

2. **Auto-close is positionally unreachable**: Auto-close is step 10 (`collect-epoch.workflow.ts:216`), but `ensureEpochForWindow` is step 4 (`collect-epoch.workflow.ts:150`). Even with `gracePeriodMs=0`, the workflow computes the NEW window, tries to create a new epoch, hits the constraint, and crashes before reaching auto-close.

3. **`ensureEpochForWindow` has no epoch transition awareness**: It handles races (two workers creating the same epoch) but not transitions (old epoch still open when new window starts). The catch block at `ledger.ts:358-380` only recovers `EPOCH_WINDOW_UNIQUE` violations, not `epochs_one_open_per_node`.

**Code pointers**:

| What                                       | Where                                         |
| ------------------------------------------ | --------------------------------------------- |
| Grace period default (24h)                 | `collect-epoch.workflow.ts:211`               |
| Grace period interface field               | `collect-epoch.workflow.ts:99-100`            |
| Grace deadline check                       | `ledger.ts:912-922`                           |
| ensureEpochForWindow (no transition logic) | `ledger.ts:292-381`                           |
| Auto-close step (unreachable at boundary)  | `collect-epoch.workflow.ts:209-226`           |
| DB constraint                              | migration `0012_add_scope_id.sql:19`          |
| Epoch schema                               | `packages/db-schema/src/attribution.ts:89-92` |

**Expected**: When a new epoch window begins, the previous epoch closes and the new one opens atomically. No grace period. No deadlock.

**Reproduction**: Observe preview environment — every hourly `CollectEpochWorkflow` run since Mar 9 00:00 UTC fails:

```
{app="cogni-template", env="preview", service="scheduler-worker"} |~ "epochs_one_open_per_node"
```

16+ GitHub `pull_request` webhooks received today are not being ingested.

**Impact**: P0 — complete collection halt on all nodes. No epochs advance, no activity is recorded, no allocations computed. Affects every node in every environment at every epoch boundary. Self-healing is impossible without manual DB intervention.

## Allowed Changes

- `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` — restructure to close previous epoch before creating new one; remove grace period
- `services/scheduler-worker/src/activities/ledger.ts` — add "close previous epoch" activity or enhance `ensureEpochForWindow`; remove grace period from `autoCloseIngestion`
- `packages/db-client/src/adapters/drizzle-attribution.adapter.ts` — add method to find/close stale open epochs
- Tests covering epoch transition
- Remove `autoCloseGracePeriodMs` from `AttributionIngestRunV1` interface

## Plan

- [ ] Design fix (see `/design`)
- [ ] Implement
- [ ] Test epoch transition (old epoch closes, new epoch opens, collection proceeds)
- [ ] Verify in preview

## Validation

**Command:**

```bash
pnpm test services/scheduler-worker
```

**Expected:** All tests pass, including new test covering epoch boundary transition.

## Review Checklist

- [ ] **Work Item:** `bug.0146` linked in PR body
- [ ] **Spec:** attribution-ledger-spec invariants upheld
- [ ] **Tests:** new tests cover epoch boundary transition
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: `bug.0139` (schedule coupling — separate issue, same workflow)
- Loki query: `{app="cogni-template", env="preview", service="scheduler-worker"} |~ "epochs_one_open_per_node"`

## Review Feedback

### R1 — REQUEST CHANGES (2026-03-09)

**Blocking:**

1. **Lint failures (3 errors)**:
   - `drizzle-attribution.adapter.ts:25` — import sorting (Biome `organizeImports`)
   - `ledger.ts:996` — `let closeParams;` implicit any → add type annotation
   - `collect-epoch.workflow.ts:159` — `let epoch;` implicit any → add type annotation

2. **Missing tests**: No coverage for `findStaleOpenEpoch` or `transitionEpochForWindow` activities. Required tests:
   - Stale epoch detection (different window → stale; same window → not stale; no open epoch → null)
   - Atomic transition (close stale + create new; returns closedStaleEpochId)
   - No-approvers path (empty approvers array)
   - Idempotent rerun (epoch already exists for window → returns existing)

3. **Dead code**: `activity-profiles.ts`, `stages/collect-sources.workflow.ts`, `stages/enrich-and-allocate.workflow.ts` are orphaned by revert to inline activities. Delete or retain child workflow pattern.

4. **Spec not updated**: `docs/spec/attribution-ledger.md` still documents 24h grace period. Must reflect close-on-transition semantics.

**Non-blocking suggestions:**

- Move `lockClaimantsForEpoch` into adapter's `transitionEpochForWindow` transaction for full `EVALUATION_FINAL_ATOMIC` atomicity
- Add `FOR UPDATE` on stale epoch SELECT or catch-and-re-query on INSERT for race safety
- Simplify `closedStaleEpochId` assignment (L746-750) — redundant conditional

## Attribution

-
