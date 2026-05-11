---
id: refactor.attribution-ledger-rename.handoff
type: handoff
work_item_id: refactor.ledger-renaming
status: needs_merge
pr: https://github.com/Cogni-DAO/cogni/pull/494
created: 2026-02-28
updated: 2026-02-28
branch: refactor/attribution-ledger
last_commit: e3659d33
---

# Handoff: Rename Epoch Ledger → Attribution Ledger

## Context

The "Epoch Ledger" work attribution system is renamed to "Attribution Ledger" to separate it from a future Financial Ledger (`proj.financial-ledger`). The pipeline stage rename (activity→ingestion, curation→selection, artifact→evaluation, payout→statement) was completed in `4c11e429` on a prior branch (#492). This branch renames the system concept itself.

PR #494 is open to `staging`. CI has 1 known failure in stack tests (now fixed in `50f43d59`).

## Current State

**All 7 phases complete.** `pnpm check` and `pnpm check:docs` pass locally.

| Commit     | Scope                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `56f468e7` | Spec update, package rename (`@cogni/ledger-core` → `@cogni/attribution-ledger`), type renames             |
| `ada73e4b` | File/dir renames, route renames (`/ledger/` → `/attribution/`), test renames                               |
| `79028f0d` | Additive migration 0018: `ALTER TABLE epoch_statements RENAME COLUMN payouts_json TO statement_items_json` |
| `45a8a403` | JSDoc `Module:`/`Links:` headers + AGENTS.md content updates (76 files)                                    |
| `50f43d59` | Fix stack test: `statement.payouts` → `statement.items`                                                    |

### Remaining `payout` references (NOT bugs — intentional or out-of-scope)

The word "payout" still appears in ~40 locations. These fall into 3 categories:

1. **Research docs** (`docs/research/*.md`) — historical analysis docs using "payout" in prose. Not renamed because research docs describe the conceptual domain, not code identifiers. ~25 hits.

2. **Test invariant names** — `PAYOUT_DETERMINISTIC` invariant name in test file headers (`tests/unit/core/attribution/rules.test.ts`, `hashing.test.ts`). The spec renamed this to `STATEMENT_DETERMINISTIC` but the test headers weren't updated. **Fix needed** (3 files).

3. **Spec cross-reference** — `docs/spec/vcs-integration.md:247` mentions "payout domain" in prose. `docs/spec/attribution-ledger.md:10` has `implements: proj.transparent-credit-payouts` (correct — that's the project name).

## Decisions Made

- **`IngestionReceipt`/`IngestionCursor`** — domain-neutral, shared spine for future Treasury
- **`statementItems`** (not `payouts`/`distributions`) — JSON blob is statement line items, not payments
- **DB column** `payouts_json` → `statement_items_json` via additive migration (no wipe)
- **API wire field** `payouts` → `items` in `StatementSchema` (Zod contract)
- **Routes** `/api/v1/attribution/` → `/api/v1/attribution/` — no users yet
- **Temporal workflow IDs** (`ledger-collect-*`) and config key (`ledger.approvers`) intentionally NOT renamed — runtime identifiers

## Next Actions

- [x] Fix 3 test headers: `PAYOUT_DETERMINISTIC` → `STATEMENT_DETERMINISTIC` in test JSDoc
- [ ] Merge PR #494 to `staging`
- [ ] Run `pnpm db:migrate` in deployed environment to apply migration 0018

## Pointers

| File / Resource                                                        | Why it matters                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| `packages/attribution-ledger/src/store.ts`                             | Source of truth for all Attribution\* type definitions      |
| `packages/attribution-ledger/src/index.ts`                             | Barrel exports — canonical public surface                   |
| `packages/db-schema/src/attribution.ts`                                | DB schema with `statementItemsJson` column                  |
| `packages/db-client/src/adapters/drizzle-attribution.adapter.ts`       | `DrizzleAttributionAdapter` — implements `AttributionStore` |
| `src/contracts/attribution.epoch-statement.v1.contract.ts`             | Wire format with `items` field                              |
| `src/adapters/server/db/migrations/0018_attribution_column_rename.sql` | Column rename migration                                     |
| `docs/spec/attribution-ledger.md`                                      | Spec (content updated)                                      |
