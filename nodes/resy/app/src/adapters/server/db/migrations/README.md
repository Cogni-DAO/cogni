# Resy migrations

This directory is **resy-owned**. Each node has its own migrations dir after task.0322.

## Intentional shared-era duplicate

`0027_silent_nextwave.sql` (poly copy-trade tables) exists here and in operator's + poly's migrations dirs. Byte-identical across all three. The file was generated before task.0322 split the schema and was applied to `cogni_resy` along with every other deployed DB.

After the split, resy's config points `drizzle-kit` at this dir. Keeping the 0027 copy means:

- Existing `cogni_resy` DB has a 0027 row in `__drizzle_migrations` → hash matches file here → migrate is a no-op
- Fresh resy DBs will apply 0027 and create `poly_copy_trade_*` tables — **unused by resy, harmless orphans**. Same story as operator.

**Do not delete `0027_silent_nextwave.sql`** without coordinating across nodes. See sibling README in operator's migrations dir.

## Going forward

Resy has no node-local tables yet. When the first one arrives, add a schema file under `nodes/resy/app/src/shared/db/`, update `drizzle.resy.config.ts` schema glob to include it, run `pnpm db:generate:resy` → emits a new migration here numbered 0028+.

**Note on `drizzle-kit generate`:** since resy's schema glob does not include poly-copy-trade, the generator will want to emit a DROP TABLE migration for `poly_copy_trade_*`. Same situation as operator. Do not commit that drop — discard or edit the generated file. Orphan tables stay until the explicit cleanup task.
