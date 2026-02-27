---
id: refactor.ledger-renaming.handoff
type: handoff
work_item_id: refactor.ledger-renaming
status: active
created: 2026-02-27
updated: 2026-02-27
branch: refactor/ledger-renaming
last_commit: 10d0242c
---

# Handoff: Ledger Pipeline Rename + Spec Cleanup

## Context

- The epoch ledger pipeline had inconsistent naming across tables, types, and docs — "activity events," "curation," "artifacts," and "payout statements" didn't map to clear pipeline stages.
- The spec (`docs/spec/epoch-ledger.md`) had a hard PK contradiction: `activity_events` PK was `(node_id, id)` but the spec claimed events could exist in multiple scopes. Scope must be assigned at selection, not ingestion.
- Nothing is shipped (no production DB, no users), making this the ideal time to do a clean rename across ~38 files.
- The rename aligns the entire codebase to five pipeline stages: **Ingestion → Selection → Evaluation → Allocation → Finalization**.
- A new DB trigger is needed: `EVALUATION_LOCKED_IMMUTABLE` — `epoch_evaluations` with `status='locked'` must be immutable (UPDATE/DELETE blocked by trigger, like `activity_events` and `epoch_pool_components` already have).

## Current State

- **Phases 1–2 are committed** on `refactor/ledger-renaming` (commit `10d0242c`): Drizzle schema (`db-schema/ledger.ts`) and all domain types/port interface (`ledger-core/src/`) are fully renamed.
- `pnpm --filter @cogni/ledger-core build` passes.
- **Phases 3–8 are NOT started**: drizzle adapter, app layer, scheduler-worker, tests, migrations, and spec still reference old names. `pnpm check` will fail with type errors until these phases complete.
- The approved plan with complete rename maps lives at `.claude/plans/golden-shimmying-spindle.md`.

## Decisions Made

- **Receipts are scope-agnostic** (`RECEIPT_SCOPE_AGNOSTIC`): `ingestion_receipts` has no `scope_id` column. PK = `(node_id, receipt_id)`. Scope is assigned at the selection layer via epoch membership. This resolves the multi-scope PK contradiction.
- **Ingestion cursors stay scoped**: `ingestion_cursors` keeps `scope_id` in its PK because scoped collection is fine — receipt inserts are idempotent.
- **Port interface renamed**: `ActivityLedgerStore` → `EpochLedgerStore`.
- **Activity function renames**: `curateAndResolve` → `materializeSelection`, `enrichEpochDraft` → `evaluateEpochDraft`, `buildFinalArtifacts` → `buildLockedEvaluations`, etc. Full map in the plan file.
- **Invariant consolidation**: `WEIGHTS_INTEGER_ONLY` merges into `ALL_MATH_BIGINT`. New: `RECEIPT_SCOPE_AGNOSTIC`, `EVALUATION_LOCKED_IMMUTABLE`.

## Next Actions

- [ ] **Phase 3**: Rename drizzle adapter (`packages/db-client/src/adapters/drizzle-ledger.adapter.ts`, 1265 lines) — imports, row mappers, 51 methods, JOIN conditions. Critical: audit all joins now that receipts have no `scope_id`.
- [ ] **Phase 4**: Rename app layer (~12 files) — ports, DTOs, API routes, contracts
- [ ] **Phase 5**: Rename scheduler-worker (~6 files) — activities, workflows, container bootstrap. Rename activity functions per plan map.
- [ ] **Phase 6**: Rename tests + fixtures + seed (~7 files)
- [ ] **Phase 7**: Delete all 17 migrations + meta, run `pnpm db:generate`, add 4 triggers to generated SQL (including new `epoch_evaluations_locked_immutable`)
- [ ] **Phase 8**: Update `docs/spec/epoch-ledger.md` — rename tables/columns/invariants, fix scope docs, rename pipeline stages
- [ ] Run `pnpm check && pnpm test && pnpm test:component && pnpm check:docs`

## Risks / Gotchas

- **Adapter JOIN audit is critical**: With `scope_id` gone from receipts, JOINs between `ingestionReceipts` and `epochSelection` use `(node_id, receipt_id)` only. Any join referencing `ingestionReceipts.scopeId` will be a compile error (column doesn't exist). Methods to audit: `getSelectedReceiptsForAllocation`, `getSelectedReceiptsWithMetadata`, `getUnselectedReceipts`.
- **Scope removal from receipt insertion**: `insertIngestionReceipts` and `InsertIngestionReceiptParams` no longer include `scope_id`. The GitHub adapter and `ingestFromSource` activity must stop passing it. The `getReceiptsForWindow` query also loses its scope filter — it now returns all receipts for a node in the time window.
- **Locked evaluation trigger**: Must allow INSERT during the atomic `closeIngestionWithEvaluations` transaction (epoch is still `'open'` at that point in the transaction) but block INSERT of locked evaluations otherwise.
- **Hash shape changed**: `eventId`→`receiptId` in `enricher-inputs.ts` changes hash outputs. Safe (no production data) but dev draft evaluations will have stale hashes after migration reset.

## Pointers

| File / Resource                                             | Why it matters                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `.claude/plans/golden-shimmying-spindle.md`                 | Complete rename maps (tables, columns, types, methods, activities, invariants) |
| `packages/db-schema/src/ledger.ts`                          | Source of truth for all table definitions (DONE)                               |
| `packages/ledger-core/src/store.ts`                         | Port interface with all 35+ methods (DONE)                                     |
| `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` | 1265-line adapter — biggest remaining file                                     |
| `services/scheduler-worker/src/activities/ledger.ts`        | 996-line activities file — second biggest                                      |
| `docs/spec/epoch-ledger.md`                                 | 750-line spec needing full rename + scope fix                                  |
| `src/adapters/server/db/migrations/`                        | 17 migrations to nuke + regenerate                                             |
