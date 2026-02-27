---
id: refactor.attribution-ledger-rename.handoff
type: handoff
work_item_id: refactor.ledger-renaming
status: needs_merge
pr: https://github.com/Cogni-DAO/node-template/pull/494
created: 2026-02-28
updated: 2026-02-28
branch: refactor/attribution-ledger
last_commit: ea695186
---

# Handoff: Rename Epoch Ledger → Attribution Ledger

## Context

- The "Epoch Ledger" system is being renamed to "Attribution Ledger" to separate work attribution from a future Financial Ledger
- The pipeline stage rename (activity→ingestion, curation→selection, artifact→evaluation, payout→statement) was completed in `4c11e429` on a prior branch
- This branch (`refactor/attribution-ledger`) renames the system concept itself: package, types, files, routes, contracts, DB column, and API surface
- Design constraints: no migration wipe, ingestion types stay domain-neutral, route paths change to `/api/v1/attribution/`
- Original plan: `~/.claude/plans/sunny-singing-balloon.md` (7 phases)

## Current State

**All 7 phases complete** across 6 commits. `pnpm check` and `pnpm check:docs` pass. PR #494 open to `staging`.

| Commit     | Phase | Scope                                                                                                          |
| ---------- | ----- | -------------------------------------------------------------------------------------------------------------- |
| `56f468e7` | 1-3   | Spec update, package rename (`@cogni/ledger-core` → `@cogni/attribution-ledger`), all type renames (100 files) |
| `ada73e4b` | 4-5   | File/dir renames (`git mv`), route dirs, test file renames, all import paths (53 files)                        |
| `79028f0d` | 6     | Additive migration 0018: `ALTER TABLE epoch_statements RENAME COLUMN payouts_json TO statement_items_json`     |
| `45a8a403` | 7     | JSDoc `Module:`/`Links:` headers + AGENTS.md content updates (76 files)                                        |
| `ea695186` | 7     | Two missed doc headers (adapter + schema)                                                                      |

## Decisions Made

- **`IngestionReceipt`/`IngestionCursor`** — domain-neutral, shared spine for future Treasury
- **`statementItems`** (not `payouts`/`distributions`) — JSON blob is statement line items, not payments
- **DB column** `payouts_json` → `statement_items_json` via additive migration (no wipe)
- **API wire field** `payouts` → `items` in `StatementSchema` (Zod contract)
- **Routes** `/api/v1/ledger/` → `/api/v1/attribution/` — no users yet
- **Temporal workflow IDs** (`ledger-collect-*`) and config key (`ledger.approvers`) intentionally NOT renamed — runtime identifiers

## Next Actions

- [x] All phases complete
- [ ] Merge PR #494 to `staging`
- [ ] Run `pnpm db:migrate` in deployed environment to apply migration 0018

## Notes

- Archive handoffs and work items in `work/` contain historical `ledger-core` references — left as-is (historical record)
- Migration 0017 already contained the 4 DB triggers from the plan's Phase 6 — only the column rename was new in 0018

## Pointers

| File / Resource                                                        | Why it matters                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| `packages/attribution-ledger/src/store.ts`                             | Source of truth for all Attribution\* type definitions      |
| `packages/attribution-ledger/src/index.ts`                             | Barrel exports — canonical public surface                   |
| `packages/db-schema/src/attribution.ts`                                | DB schema with `statementItemsJson` column                  |
| `packages/db-client/src/adapters/drizzle-attribution.adapter.ts`       | `DrizzleAttributionAdapter` — implements `AttributionStore` |
| `src/contracts/attribution.epoch-statement.v1.contract.ts`             | Wire format with `items` field                              |
| `src/adapters/server/db/migrations/0018_attribution_column_rename.sql` | Column rename migration                                     |
| `docs/spec/attribution-ledger.md`                                      | Spec (content already updated)                              |
| `~/.claude/plans/sunny-singing-balloon.md`                             | Full 7-phase plan with all rename maps                      |
