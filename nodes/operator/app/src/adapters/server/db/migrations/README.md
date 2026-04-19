# Operator migrations

This directory is **operator-owned**. Each node has its own migrations dir after task.0322.

## Intentional shared-era duplicates

`0027_silent_nextwave.sql` (poly copy-trade tables) exists here **AND** in `nodes/poly/app/src/adapters/server/db/migrations/0027_silent_nextwave.sql`. This is intentional — the file was generated before task.0322 split the schema, so it landed in operator's dir and has been applied to every deployed DB (`cogni_template_dev`, `cogni_poly`, `cogni_resy`). Each DB's `__drizzle_migrations` table references the file by hash.

**Do not delete `0027_silent_nextwave.sql` from this directory** without first verifying that no deployed DB still has an `__drizzle_migrations` row pointing at its hash. Deleting it breaks `drizzle-kit migrate` on every DB that still has the row — the migrator errors with a missing-file hash mismatch.

The poly*copy_trade*\* tables exist in operator's DB as **harmless orphans** from the shared-schema era. Operator's app code never queries them (operator's runtime schema barrel excludes copy-trade). A future cleanup task can generate an explicit DROP migration here + drop the file, in that order.

## Generating new migrations

`drizzle-kit generate` runs against this dir via `drizzle.operator.config.ts`. Since operator's schema no longer includes poly-copy-trade, **any `drizzle-kit generate` will want to emit a DROP TABLE migration for `poly_copy_trade_*`**. Do not commit that drop — manually edit or discard the generated file. Orphan tables stay until the explicit cleanup task.
