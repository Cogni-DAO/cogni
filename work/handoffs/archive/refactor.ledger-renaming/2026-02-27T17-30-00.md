---
id: refactor.ledger-renaming.handoff
type: handoff
work_item_id: refactor.ledger-renaming
status: active
created: 2026-02-27
updated: 2026-02-27
branch: refactor/ledger-renaming
last_commit: 4ac95ece
---

# Handoff: Ledger Pipeline Rename (Phases 5–8 Remaining)

## Context

- The epoch ledger pipeline had inconsistent naming — "activity events," "curation," "artifacts," "payout statements" didn't map to clear pipeline stages.
- The rename aligns the entire codebase to five stages: **Ingestion → Selection → Evaluation → Allocation → Finalization**.
- Nothing is shipped (no production DB, no users), so this is a clean rename across ~38 files with no migration risk.
- A new DB trigger is needed: `EVALUATION_LOCKED_IMMUTABLE` — `epoch_evaluations` with `status='locked'` must be immutable.
- `RECEIPT_SCOPE_AGNOSTIC`: `ingestion_receipts` has no `scope_id` column. Scope is assigned at selection via epoch membership.

## Current State

- **Phases 1–2 committed** (`10d0242c`): Drizzle schema (`db-schema/ledger.ts`) and domain types/port interface (`ledger-core/src/`) fully renamed.
- **Phase 3 committed** (`36b44331`): Drizzle adapter (`db-client/drizzle-ledger.adapter.ts`, 1265 lines) fully renamed — all methods, row mappers, JOIN conditions updated.
- **Phase 4 committed** (`4ac95ece`): App layer — ports, container, DTOs, contracts, routes, governance UI types/components. 27 files.
- **Phases 5–8 NOT started**: scheduler-worker, tests, migrations, spec doc. `pnpm check` will have test failures in `packages/ledger-core/tests/` (Phase 6 scope) and scheduler-worker won't compile until Phase 5.

## Decisions Made

- **Receipts are scope-agnostic**: `ingestion_receipts` PK = `(node_id, receipt_id)`. No `scope_id`. JOINs to `epochSelection` use `(node_id, receipt_id)` only.
- **Port interface**: `ActivityLedgerStore` → `EpochLedgerStore`. Container property: `epochLedgerStore`.
- **Wire format renamed**: API contracts updated — `receiptId` (not `id`), `selection` (not `curation`), `supersedesPayoutId` (not `supersedesStatementId`).
- **UI types renamed**: `ActivityEvent` → `IngestionReceipt`, `ApiActivityEvent` → `ApiIngestionReceipt`, `activities` field → `receipts`.
- **Ingestion-core `ActivityEvent` left as-is**: This is a different domain concept (raw source adapter output), not part of the ledger rename.

## Next Actions

- [ ] **Phase 5**: Rename scheduler-worker (4 files — see rename map below)
  - `services/scheduler-worker/src/ports/index.ts` — `ActivityLedgerStore` → `EpochLedgerStore`
  - `services/scheduler-worker/src/bootstrap/container.ts` — same type rename in `LedgerContainer`
  - `services/scheduler-worker/src/activities/ledger.ts` — `insertActivityEvents` → `insertIngestionReceipts`, `getUncuratedEvents` → `getUnselectedReceipts`, `insertCurationDoNothing` → `insertSelectionDoNothing`, `updateCurationUserId` → `updateSelectionUserId`, `getCuratedEventsForAllocation` → `getSelectedReceiptsForAllocation`, `getStatementForEpoch` → `getPayoutForEpoch`, `closeIngestionWithArtifacts` → `closeIngestionWithEvaluations`, `hasExistingCuration` → `hasExistingSelection`, `event.id` → `receipt.receiptId`, `scopeId` removed from `insertIngestionReceipts` params, `statement:` → `payout:` in `finalizeEpochAtomic`, `statementId` → `payoutId` in `FinalizeEpochOutput`, `artifacts` → `evaluations` in `AutoCloseIngestionInput`, `artifactRef` → `evaluationRef`
  - `services/scheduler-worker/src/activities/enrichment.ts` — `ActivityLedgerStore` → `EpochLedgerStore`, `getCuratedEventsWithMetadata` → `getSelectedReceiptsWithMetadata`, `upsertDraftArtifact` → `upsertDraftEvaluation`, `ECHO_ARTIFACT_REF` → `ECHO_EVALUATION_REF`, `UpsertArtifactParamsWire` → `UpsertEvaluationParamsWire`, `artifactRef` → `evaluationRef`, `eventId` → `receiptId` in enricher inputs
- [ ] **Phase 6**: Rename tests + fixtures (~5 files)
  - `packages/ledger-core/tests/artifact-envelope.test.ts` — field renames
  - `packages/ledger-core/tests/hashing.test.ts` — `artifactRef` → `evaluationRef`
  - `tests/_fixtures/ledger/seed-ledger.ts` — type/field renames
  - `services/scheduler-worker/tests/ledger-activities.test.ts` — mirror Phase 5 renames
  - `services/scheduler-worker/tests/enrichment-activities.test.ts` — mirror Phase 5 renames
- [ ] **Phase 7**: Delete all 17 migrations in `src/adapters/server/db/migrations/`, run `pnpm db:generate`, add 4 triggers including new `epoch_evaluations_locked_immutable`
- [ ] **Phase 8**: Update `docs/spec/epoch-ledger.md` (750 lines) — rename tables/columns/invariants, fix scope docs
- [ ] Run `pnpm check` — must be fully clean

## Risks / Gotchas

- **`insertIngestionReceipts` must NOT pass `scopeId`**: The column doesn't exist on `ingestion_receipts`. The `ledger.ts` activities file currently passes `scopeId` — remove it.
- **`UncuratedEvent` → `UnselectedReceipt`**: Import from `@cogni/ledger-core`, field `event.id` → `receipt.receiptId`, `hasExistingCuration` → `hasExistingSelection`.
- **`finalizeEpochAtomic` params changed**: `statement:` key → `payout:`, `supersedesStatementId` → `supersedesPayoutId`.
- **Hash shape changed**: `eventId` → `receiptId` in `computeEnricherInputsHash` inputs changes hash outputs. Safe (no production data) but existing draft evaluations will have stale hashes.
- **Locked evaluation trigger**: Must allow INSERT during atomic `closeIngestionWithEvaluations` transaction but block mutations on locked evaluations otherwise.

## Pointers

| File / Resource                                             | Why it matters                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/ledger-core/src/store.ts`                         | Source of truth for all new method/type names (already renamed)         |
| `packages/db-schema/src/ledger.ts`                          | Source of truth for all new table/column names (already renamed)        |
| `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` | Reference implementation — shows correct JOIN patterns with no scope_id |
| `services/scheduler-worker/src/activities/ledger.ts`        | 996-line file — largest remaining rename target                         |
| `services/scheduler-worker/src/activities/enrichment.ts`    | 230-line file — enricher activities with artifact → evaluation renames  |
| `docs/spec/epoch-ledger.md`                                 | 750-line spec needing full terminology update                           |
| `src/adapters/server/db/migrations/`                        | 17 migrations to delete + regenerate                                    |
