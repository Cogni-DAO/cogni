-- bug.5074 — complete 0002's tail end. 0002 statement 11 (INSERT ... ON CONFLICT
-- (col, col) DO NOTHING) is rejected by Doltgres 0.56's wire layer (per
-- docs/spec/databases.md §5.2 — ON CONFLICT is flagged unreliable). When it
-- throws, statements 12–14 (CREATE INDEX + DROP COLUMN ×2) never run. The DB
-- ends up with new + old columns side-by-side and no commit_hash index.
--
-- This migration carries the same final shape as 0003_snapshot.json on
-- already-fully-applied envs (fully idempotent via IF EXISTS / IF NOT EXISTS).
-- Backfill of knowledge_contribution_commits is intentionally NOT re-attempted
-- here — the SELECT would reference commit_hash which may already be dropped.
-- Operational backfill via psql is the path for any env that needs it.

CREATE INDEX IF NOT EXISTS "idx_kcc_commit_hash" ON "knowledge_contribution_commits" USING btree ("commit_hash");
--> statement-breakpoint
ALTER TABLE "knowledge_contributions" DROP COLUMN IF EXISTS "entry_count";
--> statement-breakpoint
ALTER TABLE "knowledge_contributions" DROP COLUMN IF EXISTS "commit_hash";
