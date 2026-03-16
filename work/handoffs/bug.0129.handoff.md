---
id: bug.0129
type: handoff
work_item_id: bug.0129
status: active
created: 2026-03-03
updated: 2026-03-03
branch: fix/epochs-v0
last_commit: 0ce62aee
---

# Handoff: Approver set hash mismatch blocks finalization

## Context

- `finalizeEpoch` compares a fresh approver hash (from repo-spec at request time) against the hash pinned at close — any drift causes permanent failure
- Fix: store the actual approver address list on the epoch at close time; finalize reads from the epoch row, not repo-spec
- Invariant: APPROVERS_PINNED_AT_REVIEW — approver list + hash pinned when epoch transitions open → review
- All changes are on `fix/epochs-v0`, uncommitted on top of `0ce62aee`

## Current State

- **Done:** All source code changes implemented — schema, domain types, store interface, adapter, finalize flow, workflow, API route, guard, migration, and test updates
- **Not done:** Changes are uncommitted. `pnpm check` has not been run to final validation. Docker image not rebuilt. No end-to-end verification with a fresh epoch post-migration.
- **Migration:** `0019_wet_calypso.sql` adds `approvers jsonb` column to `epochs` table (nullable)
- **Existing epochs:** Epochs closed before migration have `approvers = NULL` — finalization will fail with `Cannot read properties of undefined (reading 'map')`. Must create a new epoch post-migration or backfill via SQL.

## Decisions Made

- Approvers stored as JSONB array (not normalized table) — matches existing `approverSetHash` pattern, see bug.0129 Design section
- No scope_id gating on approvers column — epoch rows are already scope-gated via `SCOPE_GATED_QUERIES`
- `closeIngestion` signature adds `approvers: string[]` as second parameter (breaking change to store interface)
- `FinalizeEpochInput` and `FinalizeEpochWorkflowInput` no longer carry `approvers` — activity loads from epoch row
- `checkApprover()` guard gains optional `epoch` param: pinned approvers for non-open epochs, repo-spec fallback for open

## Next Actions

- [ ] Run `pnpm check` — fix any lint/type/test failures
- [ ] Commit all bug.0129 changes (exclude unrelated files: `tokenomics.md`, `repo-spec.yaml`, `financial-ledger.md`, `task.0130`, `proj.financial-ledger.md`)
- [ ] Rebuild Docker image (`docker compose build scheduler-worker` or full `dev:stack`)
- [ ] Run `pnpm db:migrate` to apply `0019_wet_calypso.sql`
- [ ] Create a new epoch, close ingestion, sign + finalize — verify end-to-end success
- [ ] Optionally backfill existing epochs: `UPDATE epochs SET approvers = '["0x..."]'::jsonb WHERE approver_set_hash IS NOT NULL AND approvers IS NULL`
- [ ] Update work item to `needs_closeout`, run `/closeout`

## Risks / Gotchas

- **NULL approvers on old epochs** — `epoch.approvers.map()` throws if approvers is NULL. Old epochs need backfill or must be ignored.
- **Breaking store interface** — `closeIngestion` signature changed (new second param). All callers in tests updated, but any external callers would break.
- **Pre-existing check failures** — `pnpm check` had pre-existing failures (format issues, `check:docs` errors on `tokenomics.md` / `task.0130`) unrelated to this bug. Don't confuse with bug.0129 regressions.
- **27 test call sites** — `closeIngestion` is called 27 times in `drizzle-attribution.adapter.int.test.ts`; all updated with `[]` as second arg via scripted edit. Verify no missed calls.

## Pointers

| File / Resource                                                  | Why it matters                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/db-schema/src/attribution.ts`                          | Added `approvers` JSONB column to epochs table                         |
| `packages/attribution-ledger/src/store.ts`                       | Domain type + store interface changes                                  |
| `packages/db-client/src/adapters/drizzle-attribution.adapter.ts` | Adapter: mapper, closeIngestion, closeIngestionWithEvaluations         |
| `services/scheduler-worker/src/activities/ledger.ts`             | Core fix: `finalizeEpoch` uses `epoch.approvers` not `input.approvers` |
| `src/app/api/v1/attribution/epochs/[id]/review/route.ts`         | Close flow: passes approvers to `closeIngestion`                       |
| `src/app/api/v1/attribution/_lib/approver-guard.ts`              | Guard: optional epoch param for pinned approvers                       |
| `src/adapters/server/db/migrations/0019_wet_calypso.sql`         | Migration: `ALTER TABLE epochs ADD COLUMN approvers jsonb`             |
| `work/items/bug.0129.approver-set-finalization-mismatch.md`      | Work item with full design rationale                                   |
