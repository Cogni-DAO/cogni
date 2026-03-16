---
id: task.0119.handoff
type: handoff
work_item_id: task.0119
status: active
created: 2026-03-01
updated: 2026-03-01
branch: feat/epoch-signing-ui
last_commit: 628b32b7
---

# Handoff: Epoch Approver UI — EIP-712 Signing + Review Admin Panel

## Context

- task.0119 builds `/gov/review` — an approver-gated admin page where an authorized approver can review attribution epochs, adjust individual contribution weights, sign with EIP-712, and finalize
- The backend epoch lifecycle (open → review → finalized) was already complete (task.0100, task.0102); this task adds the frontend admin workflow and migrates signing from EIP-191 to EIP-712
- bug.0121 was resolved along the way: the old per-user allocation PATCH couldn't reach unresolved identity claimants, so a new subject-level override system was built
- The dev seed script (`scripts/db/seed.mts`) now seeds 4 epochs: 2 finalized, 1 review, 1 open — the review epoch is ready for walking through the full workflow

## Current State

- **Steps 1–6 complete and committed** (18 commits on branch): EIP-712 type definitions, backend verification migration, sign-data endpoint, subject-override CRUD, review page UI with inline editing, nav link, dev seed expansion
- **UI is functional**: approver can expand contributor rows, see PR titles + artifact links, edit weights with inline form, see live-updated sums/shares/pie chart, and trigger Sign & Finalize
- **Subject override system complete**: `epoch_subject_overrides` table, store methods with row-locking, API routes (GET/PATCH/DELETE) with validation, finalization applies overrides and snapshots them in `review_overrides_json`
- **`pnpm check` passes** on committed code (typecheck, lint, format)
- **Step 7 (Tests) is NOT done** — this is the primary remaining work
- **Step 8 (Cleanup)** partially done via closeout pass (`af83a133`)

## Decisions Made

- **EIP-712 over EIP-191**: structured wallet popup, Safe multi-sig forward-compat, domain-bound chainId — see `work/items/task.0119.epoch-signer-ui.md#Design Notes`
- **Subject-ref = receiptId**: overrides key on receipt IDs from the locked evaluation's `ClaimantSharesPayload.subjects[]`
- **Client-side sum recompute**: `applyOverridesToEpochView()` in compose-epoch.ts recalculates Score, Share %, and pie chart from override data without refetching — override units are display-scale (e.g. "2"), converted to milli (\* 1000) for parity with `receipt.units`
- **Column-aligned sub-rows**: replaced the old colSpan blob expansion in `ExpandableTableRow` with proper `<TableRow>` siblings via `expandedRows` prop
- **`renderExpandedRows` over `renderExpandedContent`**: review page injects editable table rows; read-only pages use default `ContributionRow`

## Next Actions

- [ ] Add unit tests for `applyOverridesToEpochView()` — scale conversion, partial overrides, share recalculation, empty map passthrough
- [ ] Add EIP-712 round-trip test — sign with `viem/accounts` test wallet, verify with `verifyTypedData()`
- [ ] Add DB adapter tests for `upsertSubjectOverride`, `deleteSubjectOverride`, `getSubjectOverridesForEpoch`
- [ ] Add contract/stack test for sign-data endpoint — seed review epoch, call endpoint, verify EIP-712 payload shape
- [ ] Add contract/stack test for subject-overrides endpoint — CRUD + status gate + validation errors
- [ ] Expand `finalizeEpoch` activity tests — signature verification failure, non-approver signer, config lock validation
- [ ] Verify `sign-data` and `finalizeEpoch` produce identical `allocationSetHash` (stack-level)
- [ ] Run `/closeout` when tests pass

## Risks / Gotchas

- **Override unit scale**: the override input stores display-scale units (e.g. "2"), while `receipt.units` are milli-units (e.g. "8000"). `applyOverridesToEpochView` multiplies by 1000 — a mismatch here shows wrong sums. The `8 → 2` display in the Score column uses the raw override value, not the milli conversion.
- **Hash parity**: `sign-data` and `finalizeEpoch` must produce identical `allocationSetHash` — both apply overrides via `applySubjectOverrides()` but this is only verified by inspection, not by test
- **`derekg1729` is unlinked in seed data**: deliberately changed so the real GitHub account can bind via OAuth without conflicting — if you re-seed, Derek's contributions appear as unresolved
- **`overrideShares` UI not built**: backend supports re-splitting among claimants via `overrideShares`, but the UI only exposes `overrideUnits`
- **No tests for any API endpoints** in the signing/review flow — sign-data, subject-overrides, and finalize routes all have zero test coverage

## Pointers

| File / Resource                                                     | Why it matters                                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `work/items/task.0119.epoch-signer-ui.md`                           | Full requirements, plan, and design notes                                                     |
| `src/app/(app)/gov/review/view.tsx`                                 | Review page — `ReviewReceiptRow` with inline editing, `applyOverridesToEpochView` integration |
| `src/features/governance/lib/compose-epoch.ts`                      | `composeEpochView()` + `applyOverridesToEpochView()` — the composition layer                  |
| `src/features/governance/components/ContributionRow.tsx`            | Column-aligned sub-rows, exports `TYPE_ICONS`, `TYPE_LABELS`, `receiptTitle`                  |
| `src/features/governance/components/EpochDetail.tsx`                | Shared epoch detail — `renderExpandedRows` prop for custom sub-rows                           |
| `src/components/kit/data-display/ExpandableTableRow.tsx`            | `expandedRows` prop for proper table-row expansion                                            |
| `packages/attribution-ledger/src/signing.ts`                        | `buildEIP712TypedData()` — EIP-712 typed data builder                                         |
| `tests/unit/packages/attribution-ledger/signing.test.ts`            | Existing EIP-712 unit tests (structure only, no viem round-trip)                              |
| `packages/attribution-ledger/src/claimant-shares.ts`                | `applySubjectOverrides()` — pure function used by sign-data + finalize                        |
| `src/app/api/v1/attribution/epochs/[id]/sign-data/route.ts`         | Sign-data endpoint — **zero tests**                                                           |
| `src/app/api/v1/attribution/epochs/[id]/subject-overrides/route.ts` | Subject-overrides CRUD — **zero tests**                                                       |
| `services/scheduler-worker/src/activities/ledger.ts`                | `finalizeEpoch` activity — applies overrides, verifies EIP-712 signature                      |
| `scripts/db/seed.mts`                                               | Dev seed — 4 epochs (2 finalized, 1 review, 1 open), `derekg1729` unlinked                    |
