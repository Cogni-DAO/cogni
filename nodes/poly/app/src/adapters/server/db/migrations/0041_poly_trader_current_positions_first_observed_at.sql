-- bug.5008: dashboard `Held` column was using sync time, not entry time.
-- Add `first_observed_at` set once on insert; backfill from `last_observed_at`
-- so existing rows render with their best-available historical entry stamp.

ALTER TABLE "poly_trader_current_positions"
  ADD COLUMN IF NOT EXISTS "first_observed_at" timestamp with time zone NOT NULL DEFAULT now();
--> statement-breakpoint

UPDATE "poly_trader_current_positions"
   SET "first_observed_at" = "last_observed_at"
 WHERE "last_observed_at" IS NOT NULL;
