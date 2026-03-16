---
id: bug.0127
type: bug
title: Finalization pipeline ignores review-subject overrides — signed statement reflects unadjusted allocations
status: done
priority: 0
rank: 1
estimate: 3
summary: sign-data and finalizeEpoch both skip epoch_review_subject_overrides, so the signed statement never reflects admin weight adjustments. The review_overrides_json column on epoch_statements is always null.
outcome: Overrides are applied before allocation hashing in both sign-data and finalizeEpoch, and the override audit trail is persisted on the statement.
spec_refs:
  - attribution-ledger
assignees: []
credit:
project:
branch: fix/epochs-v0
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-02
updated: 2026-03-03
labels: [data-integrity, signing, finalization]
external_refs:
---

# Finalization pipeline ignores review-subject overrides

## Requirements

### Observed

Both the `sign-data` route and the `finalizeEpoch` Temporal activity compute `finalAllocationSetHash` from raw receipt weights without loading or applying review-subject overrides. The approver sees override-adjusted numbers in the Review UI (client-side via `applyOverridesToEpochView`), but the server-side finalization pipeline never consults `epoch_review_subject_overrides`.

**Result:** The approver signs numbers different from what they reviewed. The `review_overrides_json` column on `epoch_statements` is hardcoded to `null`.

#### Code pointers

1. **`sign-data` route** — `src/app/api/v1/attribution/epochs/[id]/sign-data/route.ts:82-99`
   - Loads `lockedClaimants` + `selections`, calls `computeReceiptWeights` → `explodeToClaimants` → `computeFinalClaimantAllocationSetHash`
   - Never calls `store.getReviewSubjectOverridesForEpoch()`
   - Never calls `applySubjectOverrides()`

2. **`finalizeEpoch` activity** — `services/scheduler-worker/src/activities/ledger.ts:971-1068`
   - Same flow: loads locked claimants + selections → receipt weights → explode → hash → sign → store
   - Line 1059: `reviewOverrides: null` hardcoded
   - Never calls `store.getReviewSubjectOverridesForEpoch()`
   - Never calls `applySubjectOverrides()` or `buildReviewOverrideSnapshots()`

3. **Dead code** — `packages/attribution-ledger/src/claimant-shares.ts:574-640`
   - `applySubjectOverrides()` and `buildReviewOverrideSnapshots()` exist, are unit-tested, exported from the package, but never called from any production code path
   - `toReviewSubjectOverrides()` in `store.ts:318-327` converts DB records to domain type — also unused in prod

4. **DB infrastructure is ready** — `packages/db-schema/src/attribution.ts` has `reviewOverridesJson` JSONB column on `epochStatements`. `drizzle-attribution.adapter.ts` has `toReviewOverridesJson()` serializer and reads the column back via `toStatement()`. All plumbing exists — just never receives non-null input.

### Expected

Per spec invariant `ADMIN_FINALIZES_ONCE`: "An admin reviews recomputable user projections, optionally records per-subject review overrides, then triggers finalize."

Per spec schema: `review_overrides_json — Snapshot of review overrides applied at finalize time`

Per spec verification step 3: "Read locked `epoch_receipt_claimants` + `epoch_review_subject_overrides`"

Both `sign-data` and `finalizeEpoch` must:

1. Load overrides via `store.getReviewSubjectOverridesForEpoch(epochId)`
2. Convert to domain type via `toReviewSubjectOverrides(records)`
3. Apply overrides to the claimant subjects before computing the allocation hash
4. `finalizeEpoch` must additionally call `buildReviewOverrideSnapshots()` and persist the result as `reviewOverrides` on the statement

Hash parity between the two paths is **critical** — both must apply overrides identically or the EIP-712 signature will fail verification at finalize time.

### Reproduction

1. Start dev stack, open an epoch, let collection run
2. Close ingestion (epoch → review)
3. On `/gov/review`, add a weight override on any receipt (e.g., set to 0)
4. Click "Sign & Finalize"
5. Observe: the `finalAllocationSetHash` in the signed typed data does **not** reflect the override. The statement's `review_overrides_json` is `null`.

### Impact

- **Severity: P0 (data integrity)** — The signed statement does not match what the approver reviewed. Overrides are functionally decorative.
- **Scope:** Every epoch finalized with overrides active has incorrect statements.
- **Blocked downstream:** Cannot surface override audit trail in the epoch history UI until this is fixed.

### Blocking note — validated-store.ts

The `createValidatedAttributionStore` function in `packages/attribution-ledger/src/validated-store.ts:25` uses object spread (`...inner`) on a class instance, which copies zero prototype methods. This causes `attributionStore.getEpoch is not a function` crashes on every Temporal activity invocation. This is a separate bug that blocks all ledger activity execution, including finalize. Fix: use `Proxy` to delegate, intercepting only the two validation methods.

## Allowed Changes

- `src/app/api/v1/attribution/epochs/[id]/sign-data/route.ts` — load + apply overrides before hash computation
- `services/scheduler-worker/src/activities/ledger.ts` (`finalizeEpoch` function) — load + apply overrides, build snapshots, pass to statement
- `packages/attribution-ledger/src/validated-store.ts` — Proxy fix for class instance spread bug
- `packages/attribution-ledger/src/claimant-shares.ts` — may need adapter to bridge `SubjectOverride` into the `computeReceiptWeights` pipeline
- Tests covering both paths

## Plan

- [ ] Fix `validated-store.ts` spread bug (Proxy approach) — unblocks all ledger activities
- [ ] Determine integration point: `applySubjectOverrides` operates on `ClaimantSharesSubject[]` (post-explode), but the pipeline is `computeReceiptWeights → explodeToClaimants`. Overrides with `overrideUnits` modify per-receipt weights _before_ exploding. Overrides with `overrideShares` modify claimant splits _after_ exploding. May need two-phase apply.
- [ ] Wire overrides into `sign-data` route (load → apply → hash)
- [ ] Wire overrides into `finalizeEpoch` activity (load → apply → hash → snapshot → persist)
- [ ] Add integration test: override present → hash differs from no-override case
- [ ] Add integration test: sign-data hash === finalizeEpoch hash when overrides are present

## Validation

**Command:**

```bash
pnpm test:unit -- --grep "override"
pnpm test:contract -- --grep "finalize"
```

**Expected:** All tests pass. New tests verify override-aware hashing.

## Review Checklist

- [ ] **Work Item:** `bug.0127` linked in PR body
- [ ] **Spec:** ADMIN_FINALIZES_ONCE, STATEMENT_DETERMINISTIC, ALLOCATION_PRESERVES_OVERRIDES invariants upheld
- [ ] **Tests:** new/updated tests cover sign-data + finalizeEpoch with overrides
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: `task.0119` (epoch signer UI — built the override UI but not the backend wiring)
- Related: `validated-store.ts` spread bug (separate root cause, same blast radius)
- Spec: `docs/spec/attribution-ledger.md` — ADMIN_FINALIZES_ONCE, ALLOCATION_PRESERVES_OVERRIDES

## Attribution

-
