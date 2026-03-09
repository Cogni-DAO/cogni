---
id: bug.0093
type: bug
title: Ownership facade N+1 — sequential DB queries per epoch
status: needs_design
priority: 2
estimate: 1
summary: readOwnershipSummary issues sequential DB queries per epoch, causing latency that scales linearly with epoch count
outcome: Ownership summary query count independent of epoch count
spec_refs: []
assignees: []
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
created: 2026-03-01
updated: 2026-03-01
labels: [performance, attribution]
external_refs: []
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Ownership facade N+1 — sequential DB queries per epoch

## Observed

`readOwnershipSummary` in `src/app/_facades/users/ownership.server.ts` loops over all epochs and calls `loadClaimantShareSubjectsForEpoch` sequentially for each one. Each call issues 1–2 DB queries (getEvaluation + possibly getSelectedReceiptsForAttribution as fallback).

## Expected

Ownership summary computation should not degrade linearly with epoch count.

## Impact

Low today (few epochs). Becomes a real latency problem as the system accumulates finalized epochs over months.

## File Pointers

- `src/app/_facades/users/ownership.server.ts` — the N+1 loop
- `src/app/_facades/attribution/claimants.server.ts:loadClaimantShareSubjectsForEpoch` — per-epoch helper

## Validation

- [ ] Ownership endpoint latency does not grow with epoch count
