---
id: task.0119.handoff
type: handoff
work_item_id: task.0119
status: active
created: 2026-03-01
updated: 2026-03-02
branch: feat/epoch-signing-ui
last_commit: 2e74fd67
---

# Handoff: Epoch Approver UI — Subject-Level Review Overrides (bug.0121 unblock)

## Context

- task.0119 is blocked by bug.0121: the old `PATCH /epochs/[id]/allocations` only supports per-user overrides, which can't reach unresolved identity claimants or adjust individual contribution weights
- Solution: new subject-level override system — two knobs per contribution: `overrideUnits` (change weight) and `overrideShares` (re-split among existing claimants only)
- Overrides are mutable during review, snapshotted into the statement at finalization for transparency
- The old PATCH allocations endpoint is deprecated (410 Gone); editing happens via new `PATCH /epochs/[id]/subject-overrides`
- Prior work (steps 1-3 of task.0119): EIP-712 migration, sign-data endpoint, review page scaffolding — done by previous devs

## Current State

- **Done (uncommitted)**: DB schema + migration, pure functions, store port+adapter, API contract+route, finalization flow update, sign-data update, allocations PATCH deprecation, unit tests for pure functions
- **Not committed**: All bug.0121 changes are unstaged working tree modifications — nothing committed yet
- **`pnpm packages:build` passes**, `npx tsc --noEmit` passes at root
- **`pnpm check` has failures**: typecheck/lint/format/check:docs — some may be pre-existing on this branch (view.tsx broken import from prior dev), some may need file header fixes on new files
- **Migration generated** via `pnpm db:generate` — `0020_omniscient_blackheart.sql`
- **Not done**: integration/contract tests, stack-level e2e verification, review page UI wiring to new endpoints

## Decisions Made

- **Subject-ref as canonical key**: overrides reference `subjectRef` from locked `ClaimantSharesPayload.subjects[]`, validated at write time
- **Shares validation**: must sum to `1_000_000` PPM, claimant keys lexicographically sorted, only existing claimants allowed
- **`buildClaimantAllocations` simplified**: old `userUnitOverrides` 2nd param removed — overrides pre-applied via `applySubjectOverrides()` before calling it
- **Editing gated to review status**: both new and old endpoints check `epoch.status === "review"`
- **Audit trail**: `epoch_statements.review_overrides_json` stores override snapshot at finalize time, pairing original + overridden values

## Next Actions

- [ ] Fix `pnpm check` failures — file headers on new files, possibly pre-existing view.tsx broken import
- [ ] Run `pnpm test` and fix any broken tests
- [ ] Verify `claimants.server.ts` facade works (replaced old `allocations.finalUnits` path with subject override loading)
- [ ] Wire review page UI (`src/app/(app)/gov/review/view.tsx`) to use new subject-overrides endpoints
- [ ] Add integration tests for subject-overrides route (GET/PATCH/DELETE + status gates + validation)
- [ ] Test full sign+finalize flow: override → sign-data → finalize → verify `review_overrides_json` in statement
- [ ] Consider adding `SELECT ... FOR UPDATE` row locking in `upsertSubjectOverride` for race safety with finalize
- [ ] Commit, update bug.0121 and task.0119 statuses, closeout

## Risks / Gotchas

- `sign-data` and `finalizeEpoch` must produce identical `allocationSetHash` — both now use the same override chain, but needs stack verification
- `claimants.server.ts` previously used `allocations.finalUnits` for preview — now uses subject overrides instead; preview path needs testing
- `upsertSubjectOverride` adapter checks epoch status but doesn't use `SELECT ... FOR UPDATE` — simpler but has a theoretical race with finalize
- `view.tsx` has a pre-existing broken import (`onSaveAdjustment`) from prior dev work — needs removal before check passes
- The `scripts/db/seed.mts` was modified by another dev (adds review epoch) — avoid touching it

## Pointers

| File / Resource                                                     | Why it matters                                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/db-schema/src/attribution.ts`                             | New `epochSubjectOverrides` table + `reviewOverridesJson` column on `epochStatements`                |
| `packages/attribution-ledger/src/claimant-shares.ts`                | `applySubjectOverrides()`, `buildReviewOverrideSnapshots()`, simplified `buildClaimantAllocations()` |
| `packages/attribution-ledger/src/store.ts`                          | New port methods + `SubjectOverrideRecord`/`UpsertSubjectOverrideParams` types                       |
| `packages/db-client/src/adapters/drizzle-attribution.adapter.ts`    | Adapter impl + `toReviewOverridesJson` boundary converter                                            |
| `src/contracts/attribution.subject-overrides.v1.contract.ts`        | New Zod contract (PATCH/GET/DELETE)                                                                  |
| `src/app/api/v1/attribution/epochs/[id]/subject-overrides/route.ts` | New API route with subject-ref + claimant validation                                                 |
| `services/scheduler-worker/src/activities/ledger.ts`                | Updated `finalizeEpoch` — loads overrides, applies, snapshots into statement                         |
| `src/app/api/v1/attribution/epochs/[id]/sign-data/route.ts`         | Updated to mirror finalization with subject overrides                                                |
| `src/app/api/v1/attribution/epochs/[id]/allocations/route.ts`       | PATCH deprecated (410 Gone), GET unchanged                                                           |
| `src/app/_facades/attribution/claimants.server.ts`                  | Read-side preview updated to use subject overrides                                                   |
| `packages/attribution-ledger/tests/claimant-shares.test.ts`         | Unit tests for new pure functions                                                                    |
| `work/items/bug.0121.allocation-edit-granularity.md`                | The bug this work resolves                                                                           |
