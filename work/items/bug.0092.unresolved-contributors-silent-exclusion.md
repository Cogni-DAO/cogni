---
id: bug.0092
type: bug
title: "Unresolved contributors silently excluded from epoch allocations"
status: done
priority: 1
rank: 99
estimate: 2
summary: "Contributors without user_bindings get user_id=NULL in activity_curation and are silently excluded from allocations. No UI visibility, no finalization warning. First-time contributors get zero credit with no feedback."
outcome: "Unresolved contributors visible in epoch UI. Finalization blocked or warned when unresolved contributors have activity in the epoch. Admin can manually resolve or acknowledge exclusion."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: fix/bug-0092-unresolved-visibility
pr: https://github.com/Cogni-DAO/node-template/pull/475
reviewer: derekg1729
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-24
updated: 2026-02-24
labels: [governance, ledger, identity, ux]
external_refs:
---

# Unresolved Contributors Silently Excluded from Epoch Allocations

## Problem

When the `CollectEpochWorkflow` ingests activity events, it runs identity resolution via `resolveIdentities()` to map `platform_user_id → user_id` through the `user_bindings` table. Contributors who haven't linked their platform account:

1. Have `activity_events` rows ingested (raw data exists)
2. Get `activity_curation` rows with `user_id = NULL`
3. Are **excluded from `getCuratedEventsForAllocation()`** which requires resolved `user_id`
4. Receive zero credit in the epoch with no notification or UI visibility

This is the single biggest operational blindspot for onboarding new contributors.

## Reproduction

1. Have a GitHub user contribute a PR to a tracked repo
2. Ensure that user has NO `user_bindings` entry
3. Run `CollectEpochWorkflow` for the epoch window containing that PR
4. Observe: the PR appears in `activity_events`, `activity_curation` has `user_id = NULL`, allocations table has no row for this contributor

## Expected Behavior

- Unresolved contributors should be **visible** in the epoch detail UI (e.g., "3 events from 1 unresolved contributor")
- Finalization should **warn or block** when unresolved contributors exist with activity in the epoch
- Admin should be able to manually resolve (link identity) or explicitly acknowledge exclusion

## Root Cause

`getCuratedEventsForAllocation()` in `DrizzleAttributionAdapter` filters to `user_id IS NOT NULL`. This is correct for allocation math but the system has no compensating visibility mechanism.

## Scope

- [ ] Add `getUnresolvedContributors(epochId)` query to `ActivityLedgerStore`
- [ ] Surface unresolved contributors in epoch detail API response
- [ ] Add finalization guard: warn/block when unresolved count > 0
- [ ] UI: show unresolved contributor count with platform identities

## Validation

```bash
pnpm check
pnpm test
```

- [ ] Unresolved contributors visible in epoch detail API response
- [ ] Finalization warns/blocks when unresolved contributors have activity
- [ ] UI shows unresolved contributor count with platform identities

## Research

- [Gap Analysis](../../docs/research/ledger-collection-gap-analysis.md) — section 2d
