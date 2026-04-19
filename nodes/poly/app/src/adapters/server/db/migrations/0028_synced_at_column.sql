-- ============================================================================
-- task.0328 CP3 — add synced_at freshness column to poly_copy_trade_fills
--
-- INVARIANTS (source: work/items/task.0328.poly-sync-truth.md CP3)
--
--   SYNCED_AT_WRITTEN_ON_EVERY_SYNC
--     Any reconciler tick that received a typed response from CLOB (found OR
--     not_found) stamps `synced_at = now()` for that row via `markSynced`.
--     Rows never re-checked will have `synced_at IS NULL` until the reconciler
--     first touches them — that is the correct "unknown freshness" semantics.
--
--   STALENESS_VISIBLE_IN_UI
--     The Active Orders dashboard card renders a staleness badge when
--     `synced_at IS NULL` or `staleness_ms > 60_000`.
--
--   SYSTEM_OWNED — no RLS (single-operator prototype; see migration 0027).
-- ============================================================================

ALTER TABLE "poly_copy_trade_fills" ADD COLUMN "synced_at" timestamptz;
--> statement-breakpoint
CREATE INDEX "idx_poly_copy_trade_fills_synced_at" ON "poly_copy_trade_fills" ("synced_at" NULLS FIRST);
-- The index supports fast "oldest unsynced" queries for the sync-health endpoint (CP4).
