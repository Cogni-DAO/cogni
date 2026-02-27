---
id: task.0104
type: task
title: "Ledger production hardening — upsert batching, connection pooling, activity tests"
status: needs_design
priority: 2
rank: 99
estimate: 2
summary: "Address V0 pragmatism items from task.0102 review: batch upsertAllocations, pool Temporal connections in finalize route, add activity-level unit tests for compound activities."
outcome: "Ledger write path is production-ready: batched DB writes, pooled Temporal connections, and comprehensive activity test coverage."
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
created: 2026-02-23
updated: 2026-02-23
labels: [governance, ledger, hardening]
external_refs:
---

# Ledger Production Hardening

## Requirements

- `upsertAllocations` in `DrizzleAttributionAdapter` batches inserts instead of one-at-a-time loop (N sequential round-trips → single batch or chunked batch)
- Finalize API route (`src/app/api/v1/ledger/epochs/[id]/finalize/route.ts`) uses a pooled/shared Temporal `Connection` + `Client` instead of creating + closing per request
- Activity-level unit tests for `computeAllocations`, `ensurePoolComponents`, `autoCloseIngestion`, and `finalizeEpoch` covering key code paths (empty inputs, idempotency, error cases)
- Extract duplicated `zBigint` Zod helper from two contract files into a shared utility

## Context

These items were identified during the task.0102 implementation review as non-blocking V0 pragmatism that should be addressed before production load:

1. **Upsert batching** (`drizzle-ledger.adapter.ts:568-591`): Currently iterates allocations one-by-one. For epochs with many contributors this becomes a performance bottleneck.
2. **Temporal connection pooling** (`finalize/route.ts:79-111`): Creates a new `Connection.connect()` + `Client` per HTTP request, then closes in `finally`. Should use a container-scoped singleton (same pattern as `ScheduleControlAdapter`).
3. **Activity unit tests**: The compound activities (`finalizeEpoch` especially) have many code paths but are only tested indirectly via stack tests. Need isolated unit tests with mocked store.
4. **`zBigint` duplication**: Same helper in `ledger.record-pool-component.v1.contract.ts` and `ledger.update-allocations.v1.contract.ts`. Extract to `src/contracts/_lib/zod-bigint.ts`.

## Allowed Changes

- `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` — batch upsert
- `src/app/api/v1/ledger/epochs/[id]/finalize/route.ts` — connection pooling
- `src/bootstrap/` — Temporal client singleton if needed
- `src/contracts/_lib/` — shared zBigint helper (new)
- `src/contracts/ledger.*.contract.ts` — import from shared
- `tests/unit/services/scheduler-worker/` — activity unit tests (new)

## Plan

- [ ] Step 1: Batch `upsertAllocations` using chunked multi-row insert
- [ ] Step 2: Extract `zBigint` to shared contract utility
- [ ] Step 3: Pool Temporal connection in finalize route via container
- [ ] Step 4: Add activity-level unit tests with mocked store

## Validation

**Command:**

```bash
pnpm check
pnpm test
```

**Expected:** All tests pass, no regressions.

## Review Checklist

- [ ] **Work Item:** `task.0104` linked in PR body
- [ ] **Spec:** all invariants of epoch-ledger-spec upheld
- [ ] **Tests:** new activity unit tests cover compound activity code paths
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
