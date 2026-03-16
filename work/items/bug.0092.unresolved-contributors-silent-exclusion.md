---
id: bug.0092
type: bug
title: "Unresolved contributors silently excluded from epoch allocations"
status: done
priority: 1
rank: 99
estimate: 2
summary: "Contributors without user_bindings get user_id=NULL in epoch selection and disappear from user-only allocation views. First-time contributors lose attribution visibility unless the system preserves unresolved identities explicitly."
outcome: "Unlinked contributors remain visible in epoch UI and finalized claimant reads, and late account linking can resolve their attribution without rewriting receipt history."
spec_refs: attribution-ledger-spec
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
updated: 2026-03-01
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
4. Observe: the PR appears in `ingestion_receipts`, `epoch_selection.user_id` stays `NULL`, and user-only allocations omit that contributor unless claimant-aware attribution preserves the identity

## Expected Behavior

- Unlinked contributors should remain visible in epoch detail UI as normal contributor rows
- Finalization should preserve unresolved identities as claimants instead of silently dropping them
- Linking the account later should update presentation and ownership reads without mutating receipt history

## Root Cause

`getCuratedEventsForAllocation()` in `DrizzleAttributionAdapter` filters to resolved `user_id`s. That is correct for the resolved-user override surface, but it is insufficient as the only economic truth because unresolved contributors disappear unless claimant-aware evaluations and finalized statement items preserve them.

## Scope

- [x] Surface unlinked contributors in epoch detail reads
- [x] Preserve unresolved identities in claimant-aware finalized statement items
- [x] Resolve display names and linked/unlinked state at read time
- [ ] Optimize ownership summary query shape (follow-up: bug.0093)

## Validation

```bash
pnpm check
pnpm test
```

- [x] Unlinked contributors visible in epoch detail API response and UI rows
- [x] Finalized claimant reads preserve unresolved identity claimants
- [ ] Ownership summary query count no longer grows with epoch count

## Research

- [Gap Analysis](../../docs/research/ledger-collection-gap-analysis.md) — section 2d
