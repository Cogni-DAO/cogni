-- Race-safe + idempotent. Single DO block holds ACCESS EXCLUSIVE LOCK
-- on poly_copy_trade_fills for the full ADD COLUMN → backfill → DELETE
-- legacy NULLs → SET NOT NULL sequence, so a concurrent old-pod writer
-- cannot insert a NULL-market_id row between DELETE and SET NOT NULL.
-- Re-running on an already-applied env: every step is guarded; whole
-- block is a no-op.
DO $$
BEGIN
  LOCK TABLE "poly_copy_trade_fills" IN ACCESS EXCLUSIVE MODE;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'poly_copy_trade_fills'
      AND column_name = 'market_id'
  ) THEN
    EXECUTE 'ALTER TABLE "poly_copy_trade_fills" ADD COLUMN "market_id" text';
  END IF;

  UPDATE "poly_copy_trade_fills"
     SET "market_id" = "attributes"->>'market_id'
   WHERE "market_id" IS NULL;

  DELETE FROM "poly_copy_trade_fills"
   WHERE "market_id" IS NULL;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'poly_copy_trade_fills'
      AND column_name = 'market_id'
      AND is_nullable = 'YES'
  ) THEN
    EXECUTE 'ALTER TABLE "poly_copy_trade_fills" ALTER COLUMN "market_id" SET NOT NULL';
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "poly_copy_trade_fills_one_open_per_market" ON "poly_copy_trade_fills" USING btree ("billing_account_id","target_id","market_id") WHERE "poly_copy_trade_fills"."status" IN ('pending','open','partial');
