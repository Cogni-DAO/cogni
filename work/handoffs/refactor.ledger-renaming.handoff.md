---
id: refactor.ledger-renaming.handoff
type: handoff
work_item_id: refactor.ledger-renaming
status: complete
created: 2026-02-27
updated: 2026-02-27
branch: refactor/ledger-renaming
last_commit: d25399f2
---

# Handoff: Ledger Pipeline Rename — Complete

## Context

The epoch ledger pipeline had inconsistent naming — "activity events," "curation," "artifacts," "payout statements" didn't map to clear pipeline stages. The rename aligns the codebase to: **Ingestion → Selection → Evaluation → Allocation → Statement → (future: Settlement/Payout)**.

## What Was Done

All 8 phases completed across 9 commits:

| Phase | Scope                                                                 | Commit           |
| ----- | --------------------------------------------------------------------- | ---------------- |
| 1–2   | Schema (`packages/db-schema`) + domain types (`packages/ledger-core`) | `10d0242c`       |
| 3     | Drizzle adapter (`packages/db-client`)                                | `36b44331`       |
| 4     | App layer (contracts, routes, features, ports)                        | `4ac95ece`       |
| 5     | Scheduler-worker (activities, workflows, ports, container)            | `103b2b18`       |
| —     | payout → statement rename across all layers                           | `716a78c4`       |
| 6     | Tests, fixtures, seed scripts, reference data                         | `30806d3e`       |
| 7     | Migration 0017 (ALTER TABLE RENAME + triggers) + drizzle snapshot     | `d25399f2`       |
| 8     | Spec update (`docs/spec/epoch-ledger.md`)                             | (pending commit) |

## Decisions

- **Statement, not payout**: The finalization entity is a deterministic distribution plan. "Payout" reserved for future settlement layer.
- **`payoutsJson` stays**: The JSON blob contains payout line items — "payouts" as a noun for the math output is correct.
- **Migration approach**: Handwritten `ALTER TABLE RENAME` migration (0017) with drizzle-kit `--name` interactive snapshot generation. Preserves data, preserves all prior handwritten migrations.
- **`RECEIPT_SCOPE_AGNOSTIC`**: `ingestion_receipts` has no `scope_id` — scope assigned at selection via epoch membership.
- **New trigger**: `epoch_evaluations_locked_immutable` — allows INSERT but blocks UPDATE/DELETE on `status='locked'` rows.

## Key Files

| File / Resource                                                     | Role                                      |
| ------------------------------------------------------------------- | ----------------------------------------- |
| `packages/ledger-core/src/store.ts`                                 | Source of truth for all method/type names |
| `packages/db-schema/src/ledger.ts`                                  | Source of truth for table/column names    |
| `packages/db-client/src/adapters/drizzle-ledger.adapter.ts`         | All store port implementations            |
| `docs/spec/epoch-ledger.md`                                         | Full spec with pipeline vocabulary        |
| `src/adapters/server/db/migrations/0017_ledger_pipeline_rename.sql` | Rename migration + trigger updates        |
