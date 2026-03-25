---
id: bug.0129
type: bug
title: "Finalization fails on approver set hash mismatch — approver check is scattered and fragile"
status: done
priority: 0
rank: 10
estimate: 3
summary: "The finalizeEpoch activity compares a freshly-computed approver set hash (from repo-spec at request time) against the hash pinned on the epoch at close. Any drift between the two causes permanent finalization failure. Approver validation is scattered across 5 call sites with no single source of truth."
outcome: "One function decides 'is this wallet an authorized signer for this epoch?' using the pinned approver set, used by UI, API guards, and finalization."
spec_refs:
  - attribution-ledger-spec
  - attribution-pipeline-overview-spec
assignees:
  - derekg1729
credit:
project: proj.transparent-credit-payouts
branch: fix/epoch-finalization
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-02
updated: 2026-03-24
labels: [governance, attribution, finalization]
external_refs:
---

# Finalization fails on approver set hash mismatch

## Observed

The `finalizeEpoch` activity fails with:

```
finalizeEpoch: approver set hash mismatch — epoch has 4db1b117..., current is d797614...
```

**Root cause:** The finalize API route (`finalize/route.ts:85`) reads `getLedgerApprovers()` from repo-spec at request time and passes the list to the Temporal workflow. The activity (`ledger.ts:984`) hashes that list and compares against the hash pinned on the epoch at close time. If repo-spec changed between close and finalize (or the close happened on a previous docker image build), finalization fails permanently — retries don't help because the hash never converges.

**Structural issue:** Approver validation is scattered across 5 independent call sites, each calling `getLedgerApprovers()` from repo-spec at request time:

| Call site         | File:line                                                     | What it does                       |
| ----------------- | ------------------------------------------------------------- | ---------------------------------- |
| UI page           | `src/app/(app)/gov/review/page.tsx:23`                        | Gates review page visibility       |
| API guard         | `src/app/api/v1/attribution/_lib/approver-guard.ts:35`        | Gates write endpoints (403)        |
| Review close      | `src/app/api/v1/attribution/epochs/[id]/review/route.ts:54`   | Pins `approverSetHash` on epoch    |
| Finalize route    | `src/app/api/v1/attribution/epochs/[id]/finalize/route.ts:85` | Passes approvers to workflow       |
| Finalize activity | `services/scheduler-worker/src/activities/ledger.ts:984`      | Hashes and compares against pinned |

None of these check against the epoch's pinned approver set. They all re-read repo-spec independently.

## Expected

One function: `isEpochApprover(epoch, walletAddress) → boolean` that checks against the **pinned** approver set stored on the epoch. Used everywhere.

## Design

### Outcome

Epoch finalization works reliably regardless of repo-spec changes between close and finalize. One function gates all approver checks for non-open epochs.

### Approach

**Solution**: Store the actual approver addresses on the epoch at close time (alongside the existing hash). The finalize activity loads approvers from the epoch row — no repo-spec read, no `input.approvers` passthrough.

**Key changes:**

1. **Add `approvers` column** to epochs table — `jsonb("approvers").$type<string[]>()`, nullable (null while open, set at close alongside `approver_set_hash`)

2. **Add `approvers` to domain type** — `AttributionEpoch.approvers: readonly string[] | null`

3. **Persist approvers at close** — `closeIngestion()` and `closeIngestionWithEvaluations()` accept the approver list, store both the list and the hash

4. **Remove `approvers` from finalize input** — `FinalizeEpochInput` and `FinalizeEpochWorkflowInput` drop the `approvers` field. The activity loads `epoch.approvers` from DB.

5. **Finalize activity uses epoch.approvers** — signer membership check and hash verification both use the pinned list from the epoch row. Hash check becomes self-consistent: `computeApproverSetHash(epoch.approvers) === epoch.approverSetHash`.

6. **API guard for non-open epochs** — `checkApprover()` gains an optional `epoch` param. If provided and epoch has pinned approvers, check against those. If epoch is open or no epoch provided, fall back to `getLedgerApprovers()`.

7. **Finalize route simplified** — just passes `{ epochId, signature, signerAddress }`. No `getLedgerApprovers()` call.

**Rejected:**

- _Remove hash, keep only list_ — the hash is cheap integrity verification and already used in tests. Keep both.
- _Store approvers only on statement_ — too late; need them at review time for API guards.
- _Derive approvers from hash at finalize_ — hashes are one-way. Can't recover the list.

### Invariants

- [ ] APPROVERS_PINNED_AT_REVIEW: approver list + hash pinned when epoch transitions open → review (attribution-ledger-spec)
- [ ] ADMIN_FINALIZES_ONCE: signer must be in the pinned approver set, not the current repo-spec set (attribution-ledger-spec)
- [ ] SIGNATURE_SCOPE_BOUND: EIP-712 typed data unchanged — doesn't include approvers (attribution-ledger-spec)

### Files

**Schema + domain:**

- Modify: `packages/db-schema/src/attribution.ts` — add `approvers` column to epochs table
- Modify: `packages/attribution-ledger/src/store.ts` — add `approvers` to `AttributionEpoch`, update `closeIngestion` + `CloseIngestionWithEvaluationsParams` signatures
- Create: DB migration for new column

**Store implementation:**

- Modify: `packages/db-client/src/adapters/drizzle-attribution.adapter.ts` — persist approvers in `closeIngestion()` and `closeIngestionWithEvaluations()`, read them back in all epoch queries

**Finalize flow:**

- Modify: `services/scheduler-worker/src/activities/ledger.ts` — remove `input.approvers`, use `epoch.approvers`
- Modify: `services/scheduler-worker/src/workflows/finalize-epoch.workflow.ts` — drop `approvers` from `FinalizeEpochWorkflowInput`
- Modify: `src/app/api/v1/attribution/epochs/[id]/finalize/route.ts` — stop passing approvers

**Close flow (passes approvers to store):**

- Modify: `services/scheduler-worker/src/activities/ledger.ts` — `autoCloseIngestion` passes approvers to `closeIngestionWithEvaluations`
- Modify: `src/app/api/v1/attribution/epochs/[id]/review/route.ts` — pass approvers to `closeIngestion`

**Guard:**

- Modify: `src/app/api/v1/attribution/_lib/approver-guard.ts` — accept optional epoch, check pinned approvers for non-open epochs

**Tests:**

- Modify: `services/scheduler-worker/tests/ledger-activities.test.ts` — update mocks, remove approvers from finalize input
- Modify: `tests/component/db/drizzle-attribution.adapter.int.test.ts` — verify approvers persisted at close
- Modify: `tests/unit/packages/attribution-ledger/finalize-validation.test.ts` — update fixtures

## Reproduction

1. Start `dev:stack`
2. Create an epoch, close ingestion (pins approverSetHash)
3. Change any approver address in `.cogni/repo-spec.yaml` (even casing)
4. Attempt to sign and finalize → "approver set hash mismatch"

Even without step 3, this can fail if the close happened on a previous docker image build with different repo-spec content.

## Impact

**Blocking** — no epoch can be finalized in local dev. The scheduler-worker was previously unable to reach the DB at all (`ECONNREFUSED`), masking this bug. Now that DB connectivity is fixed, this is the next failure.

## Validation

**Command:**

```bash
pnpm test
pnpm check
```

**Expected:** All tests pass. Finalization succeeds end-to-end after signing.

## Review Checklist

- [ ] **Work Item:** `bug.0129` linked in PR body
- [ ] **Spec:** APPROVERS_PINNED_AT_REVIEW invariant upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/bug.0129.handoff.md)

## Attribution

-
