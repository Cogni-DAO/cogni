---
id: task.0119.handoff
type: handoff
work_item_id: task.0119
status: active
created: 2026-03-01
updated: 2026-03-02
branch: feat/epoch-signing-ui
last_commit: 54825d6f
---

# Handoff: Epoch Approver UI — Review Page Editing + Final Lint Fix

## Context

- task.0119 builds `/gov/review` — an approver-gated admin page for reviewing, editing, and finalizing attribution epochs via EIP-712 signing
- bug.0121 blocked this work: the old per-user `PATCH /epochs/[id]/allocations` couldn't reach unresolved identity claimants or adjust individual contributions. Now resolved with subject-level overrides
- The backend subject-override system is **complete and committed** (4 commits on branch): DB schema, pure functions, store port/adapter, API routes, finalization flow, sign-data mirroring, old path pruned
- The review page UI editing is **in progress (uncommitted)** — inline override controls are wired but have 8 ESLint violations (raw Tailwind colors + arbitrary value) that need design-token substitution
- `pnpm check` passes on committed code; only the uncommitted `view.tsx` changes cause lint failures

## Current State

- **Committed — backend complete**: `8e3c5298` through `54825d6f` (4 commits)
  - `epoch_subject_overrides` table + migration `0020_omniscient_blackheart.sql`
  - `applySubjectOverrides()`, `buildReviewOverrideSnapshots()` pure functions with unit tests
  - Store port: `upsertSubjectOverride`, `deleteSubjectOverride`, `getSubjectOverridesForEpoch`
  - API: `GET/PATCH/DELETE /epochs/[id]/subject-overrides` with full validation
  - Finalization + sign-data updated to use subject overrides
  - Old `updateAllocationFinalUnits` removed from port/adapter, PATCH allocations returns 410 Gone
  - Old `attribution.update-allocations.v1.contract.ts` deleted
- **Uncommitted — UI in progress** (3 files):
  - `src/features/governance/hooks/useSubjectOverrides.ts` — new CRUD hook (React Query + fetch)
  - `src/features/governance/components/EpochDetail.tsx` — added `renderExpandedContent` prop for custom expanded row rendering
  - `src/app/(app)/gov/review/view.tsx` — `ReviewReceiptRow` with inline editing (pencil → input → save/cancel), override indicator badge, reset button
- **`pnpm check` on committed code**: all pass (typecheck, lint, format, check:docs, arch:check, test:services)
- **`pnpm lint` on uncommitted view.tsx**: 8 errors — raw amber colors (`border-amber-500/30`, `bg-amber-500/5`, etc.) and `flex-[2]` arbitrary value violate `ui-governance/no-raw-colors` and `ui-governance/no-arbitrary-non-token-values` ESLint rules

## Decisions Made

- **Subject-ref = receiptId**: overrides use `subjectRef` from locked evaluation's `ClaimantSharesPayload.subjects[]`, which equals the receipt ID from `buildDefaultReceiptClaimantSharesPayload`
- **Two knobs per subject**: `overrideUnits` (change weight) and `overrideShares` (re-split among existing claimants only) — the UI currently only exposes `overrideUnits`
- **EpochDetail extensibility**: added optional `renderExpandedContent` prop instead of forking the component — keeps it reusable for read-only views while allowing the review page to inject editing controls
- **Inline editing UX**: each receipt in expanded contributor row shows a pencil icon → inline form with units input + reason + save/cancel. Active overrides show amber highlight + badge + reset button
- **`buildClaimantAllocations` simplified**: removed old `userUnitOverrides` parameter — overrides pre-applied via `applySubjectOverrides()` before calling it
- **Audit trail**: `epoch_statements.review_overrides_json` stores snapshot at finalize, pairing original + overridden values

## Next Actions

- [ ] Fix 8 lint errors in `view.tsx` — replace raw amber colors with design tokens from `src/styles/tailwind.css` (e.g., `border-warning`, `bg-warning/5`, `text-warning`), replace `flex-[2]` with `flex-2` or a CSS variable
- [ ] Commit the 3 uncommitted UI files (`useSubjectOverrides.ts`, `EpochDetail.tsx`, `view.tsx`)
- [ ] Run `pnpm test` — verify all unit tests pass (especially `claimant-shares.test.ts`)
- [ ] Add integration tests for subject-overrides route (GET/PATCH/DELETE + status gates + validation)
- [ ] Test full sign+finalize flow end-to-end: set override → GET sign-data → sign → finalize → verify `review_overrides_json` in statement
- [ ] Consider `SELECT ... FOR UPDATE` row locking in `upsertSubjectOverride` for race safety with concurrent finalize
- [ ] Run `/closeout` — update bug.0121 and task.0119 statuses

## Risks / Gotchas

- **Lint rule `ui-governance/no-raw-colors`**: project forbids raw Tailwind colors — must use design tokens. Check `src/styles/tailwind.css` for available tokens (e.g., `--warning`, `--destructive`, `--accent`). The override highlight uses amber which may need a `--warning` token mapping.
- **`sign-data` and `finalizeEpoch` hash parity**: both must produce identical `allocationSetHash` — they use the same override chain but this needs stack-level verification
- **`upsertSubjectOverride` race**: adapter checks `epoch.status === "review"` but doesn't use `SELECT ... FOR UPDATE` — theoretical race with concurrent finalize
- **`overrideShares` UI not built**: the shares knob (re-splitting among claimants) has backend support but no UI — only `overrideUnits` is exposed in the current review page
- The `scripts/db/seed.mts` was modified by another dev (adds review epoch) — avoid touching it

## Pointers

| File / Resource                                                     | Why it matters                                                       |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/app/(app)/gov/review/view.tsx`                                 | **Active work** — `ReviewReceiptRow` has 8 lint errors to fix        |
| `src/features/governance/hooks/useSubjectOverrides.ts`              | **New (uncommitted)** — CRUD hook for subject overrides API          |
| `src/features/governance/components/EpochDetail.tsx`                | **Modified (uncommitted)** — added `renderExpandedContent` prop      |
| `src/styles/tailwind.css`                                           | Design tokens — find the right replacements for amber colors         |
| `src/app/api/v1/attribution/epochs/[id]/subject-overrides/route.ts` | API route with subject-ref + claimant validation                     |
| `src/contracts/attribution.subject-overrides.v1.contract.ts`        | Zod contract (PATCH/GET/DELETE)                                      |
| `packages/attribution-ledger/src/claimant-shares.ts`                | `applySubjectOverrides()`, `buildReviewOverrideSnapshots()`          |
| `packages/attribution-ledger/tests/claimant-shares.test.ts`         | Unit tests for pure functions                                        |
| `services/scheduler-worker/src/activities/ledger.ts`                | `finalizeEpoch` — loads overrides, applies, snapshots into statement |
| `work/items/bug.0121.allocation-edit-granularity.md`                | The bug this work resolves                                           |
