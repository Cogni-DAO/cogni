ALTER TABLE "poly_copy_trade_fills" ADD COLUMN IF NOT EXISTS "market_id" text;--> statement-breakpoint
UPDATE "poly_copy_trade_fills" SET "market_id" = "attributes"->>'market_id' WHERE "market_id" IS NULL;--> statement-breakpoint
DELETE FROM "poly_copy_trade_fills" WHERE "market_id" IS NULL;--> statement-breakpoint
ALTER TABLE "poly_copy_trade_fills" ALTER COLUMN "market_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "poly_copy_trade_fills_one_open_per_market" ON "poly_copy_trade_fills" USING btree ("billing_account_id","target_id","market_id") WHERE "poly_copy_trade_fills"."status" IN ('pending','open','partial');
