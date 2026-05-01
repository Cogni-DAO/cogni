ALTER TABLE "poly_copy_trade_fills" ADD COLUMN "market_id" text;--> statement-breakpoint
UPDATE "poly_copy_trade_fills" SET "market_id" = "attributes"->>'market_id' WHERE "market_id" IS NULL;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "poly_copy_trade_fills" WHERE "market_id" IS NULL) THEN
    RAISE EXCEPTION 'poly_copy_trade_fills has rows with NULL market_id after backfill — refusing to set NOT NULL';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "poly_copy_trade_fills" ALTER COLUMN "market_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "poly_copy_trade_fills_one_open_per_market" ON "poly_copy_trade_fills" USING btree ("billing_account_id","target_id","market_id") WHERE "poly_copy_trade_fills"."status" IN ('pending','open','partial');
