ALTER TABLE "poly_copy_trade_fills"
  ADD COLUMN IF NOT EXISTS "position_lifecycle" text;--> statement-breakpoint
UPDATE "poly_copy_trade_fills"
SET "position_lifecycle" = CASE
  WHEN "attributes"->>'closed_at' IS NOT NULL THEN 'closed'
  WHEN "status" IN ('filled','partial') THEN 'open'
  WHEN ("attributes"->>'filled_size_usdc') ~ '^[0-9]+(\.[0-9]+)?$'
    AND ("attributes"->>'filled_size_usdc')::numeric > 0 THEN 'open'
  ELSE NULL
END
WHERE "position_lifecycle" IS NULL;--> statement-breakpoint
ALTER TABLE "poly_copy_trade_fills"
  DROP CONSTRAINT IF EXISTS "poly_copy_trade_fills_position_lifecycle_check";--> statement-breakpoint
ALTER TABLE "poly_copy_trade_fills"
  ADD CONSTRAINT "poly_copy_trade_fills_position_lifecycle_check"
  CHECK (
    "position_lifecycle" IS NULL OR "position_lifecycle" IN (
      'unresolved', 'open', 'closing', 'closed', 'resolving',
      'winner', 'redeem_pending', 'redeemed', 'loser', 'dust', 'abandoned'
    )
  );--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "poly_copy_trade_fills_position_lifecycle_idx"
  ON "poly_copy_trade_fills" USING btree ("billing_account_id","position_lifecycle");--> statement-breakpoint
DROP INDEX IF EXISTS "poly_copy_trade_fills_one_open_per_market";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "poly_copy_trade_fills_one_open_per_market"
  ON "poly_copy_trade_fills" USING btree ("billing_account_id","target_id","market_id")
  WHERE "poly_copy_trade_fills"."status" IN ('pending','open','partial')
    AND (
      "poly_copy_trade_fills"."position_lifecycle" IS NULL
      OR "poly_copy_trade_fills"."position_lifecycle" IN ('unresolved','open','closing')
    )
    AND "poly_copy_trade_fills"."attributes"->>'closed_at' IS NULL;
