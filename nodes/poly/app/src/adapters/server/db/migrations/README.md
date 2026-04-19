# Poly migrations

This directory is **poly-owned**. Each node has its own migrations dir after task.0322.

## Intentional shared-era duplicate

`0027_silent_nextwave.sql` (poly copy-trade tables) exists here **AND** in `nodes/operator/app/src/adapters/server/db/migrations/0027_silent_nextwave.sql`. Byte-identical copies. The file was generated before task.0322 split the schema and was applied to `cogni_poly` (via the root config) as well as every other deployed DB.

After the split, poly's config points `drizzle-kit` at this dir. For fresh `cogni_poly` DBs to get the copy-trade tables, the file must be here. For existing DBs with the 0027 hash already in `__drizzle_migrations`, the file must still be here (same hash) so migrate is a no-op.

**Do not delete `0027_silent_nextwave.sql`** without coordinating across nodes. See sibling README in operator's migrations dir.

## Going forward

New poly-local tables land in `nodes/poly/app/src/shared/db/copy-trade.ts` (or new files alongside). `drizzle-kit generate` via `drizzle.poly.config.ts` emits new migration files here, numbered sequentially (0028*\*, 0029*\*, ...).
