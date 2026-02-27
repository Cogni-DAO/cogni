---
id: refactor.attribution-ledger-rename.handoff
type: handoff
work_item_id: refactor.ledger-renaming
status: active
created: 2026-02-28
updated: 2026-02-28
branch: refactor/ledger-renaming
last_commit: 4c11e429
---

# Handoff: Rename Epoch Ledger → Attribution Ledger

## Context

The epoch ledger pipeline rename (activity→ingestion, curation→selection, artifact→evaluation, payout→statement) is **complete and merged** (`4c11e429`). Now we rename the **system concept** from "Ledger" to "Attribution Ledger" — separating the work attribution system from a future Financial Ledger.

**Design constraints** (from user review):

1. **No migration wipe.** Additive migrations only.
2. **Ingestion types stay domain-neutral.** `IngestionReceipt`, `IngestionCursor` — shared spine for Treasury later.
3. **Payout terminology fully cleaned.** `PayoutLineItem` → `StatementLineItem`, `computePayouts` → `computeStatementItems`, `payoutsJson` → `statementItems` (domain) / `statement_items_json` (DB column), API wire field `payouts` → `items`.
4. **Route paths rename to `/api/v1/attribution/`.** No users yet.

Plan: `.claude/plans/sunny-singing-balloon.md` (7 phases, full type/file rename maps).

## Current State

- **Phases 1–3 are DONE but UNCOMMITTED** (~98 files changed in working tree).
- Pre-commit hook failed on pre-existing biome lint errors (`result!` → `result?` in `tests/component/db/drizzle-ledger.adapter.int.test.ts` lines 1278-1283). Fix those, then commit.
- `pnpm packages:build` passes. Full `pnpm check` not yet run.
- **Phases 4–7 NOT started.**

### What's done (uncommitted):

| Phase | Scope                                                                                                                                                  | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1     | Spec update (`docs/spec/epoch-ledger.md`) — title, tables, invariants, file pointers, routes                                                           | Done   |
| 2     | Package rename (`packages/ledger-core/` → `packages/attribution-ledger/`, `@cogni/ledger-core` → `@cogni/attribution-ledger`) + all imports + lockfile | Done   |
| 3     | Type renames (see map below) + container props + wire format                                                                                           | Done   |

### What's left:

| Phase | Scope                                                                                                                 | Notes                   |
| ----- | --------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 4     | File/dir renames (`git mv`): schema, adapter, ports, core, routes, contracts, fixtures, spec                          | See plan for full table |
| 5     | Test file renames + import path updates                                                                               | ~15 test files          |
| 6     | Additive migration: `ALTER TABLE epoch_statements RENAME COLUMN payouts_json TO statement_items_json` + 4 DB triggers | No wipe                 |
| 7     | AGENTS.md (~7 files) + doc comment headers + cross-references                                                         | `pnpm check:docs`       |

## Decisions Made

- **`IngestionReceipt`/`IngestionCursor`** (not `Attribution*`) — domain-neutral shared spine for future Treasury.
- **`statementItems`** (not `payouts`/`distributions`) — the JSON blob contains line items of a statement, not executed payments.
- **DB column** `payouts_json` → `statement_items_json` via additive `ALTER TABLE RENAME COLUMN`.
- **API wire field** `payouts` → `items` in `StatementSchema`.
- **Routes** rename to `/api/v1/attribution/` — no stable API surface concern (no users).
- **Temporal workflow IDs** (`ledger-collect-*`, `ledger-finalize-*`) and repo-spec config key (`ledger.approvers`) stay as-is — runtime identifiers, renaming would break schedules.

## Next Actions

1. Fix biome lint in `tests/component/db/drizzle-ledger.adapter.int.test.ts` (replace `result!` with `result?` at lines 1278-1283)
2. Commit phases 1-3: `refactor(attribution): rename Ledger → Attribution Ledger (phases 1-3)`
3. Execute Phase 4 (file renames — see plan for git mv table)
4. Execute Phase 5 (test fixes)
5. Execute Phase 6 (additive migration + triggers)
6. Execute Phase 7 (AGENTS.md + docs)
7. `pnpm check` — must be fully clean
8. `pnpm check:docs` — must pass

## Pointers

| File / Resource                                             | Why it matters                                                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `.claude/plans/sunny-singing-balloon.md`                    | Full plan with type rename maps, file rename tables, phase details                        |
| `packages/attribution-ledger/src/store.ts`                  | Source of truth for all type names (already renamed)                                      |
| `packages/attribution-ledger/src/rules.ts`                  | `computeStatementItems()` (was `computePayouts`)                                          |
| `packages/attribution-ledger/src/model.ts`                  | `StatementLineItem` (was `PayoutLineItem`)                                                |
| `packages/db-schema/src/ledger.ts`                          | DB schema — `statementItemsJson` field (file to be renamed → `attribution.ts` in Phase 4) |
| `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` | `DrizzleAttributionAdapter` class (file to be renamed in Phase 4)                         |
| `src/contracts/ledger.epoch-statement.v1.contract.ts`       | Wire format: `items` field (file to be renamed in Phase 4)                                |
| `services/scheduler-worker/src/activities/ledger.ts`        | `createAttributionActivities()` (file rename deferred to Phase 4)                         |
| `docs/spec/epoch-ledger.md`                                 | Spec content updated, file to be renamed → `attribution-ledger.md` in Phase 4             |
