CREATE TABLE IF NOT EXISTS "poly_trader_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"active_for_research" boolean DEFAULT true NOT NULL,
	"first_observed_at" timestamp with time zone DEFAULT now(),
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poly_trader_wallets_wallet_shape" CHECK ("poly_trader_wallets"."wallet_address" ~ '^0x[a-fA-F0-9]{40}$'),
	CONSTRAINT "poly_trader_wallets_kind_check" CHECK ("poly_trader_wallets"."kind" IN ('copy_target','cogni_wallet'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "poly_trader_ingestion_cursors" (
	"trader_wallet_id" uuid NOT NULL,
	"source" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_seen_native_id" text,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
		CONSTRAINT "poly_trader_ingestion_cursors_trader_wallet_id_source_pk" PRIMARY KEY("trader_wallet_id","source"),
		CONSTRAINT "poly_trader_ingestion_cursors_source_check" CHECK ("poly_trader_ingestion_cursors"."source" IN ('data-api','data-api-trades','data-api-positions','clob-ws')),
	CONSTRAINT "poly_trader_ingestion_cursors_status_check" CHECK ("poly_trader_ingestion_cursors"."status" IN ('pending','ok','partial','stale','error'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "poly_trader_fills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trader_wallet_id" uuid NOT NULL,
	"source" text NOT NULL,
	"native_id" text NOT NULL,
	"condition_id" text NOT NULL,
	"token_id" text NOT NULL,
	"side" text NOT NULL,
	"price" numeric(18, 8) NOT NULL,
	"shares" numeric(20, 8) NOT NULL,
	"size_usdc" numeric(20, 8) NOT NULL,
	"tx_hash" text,
	"observed_at" timestamp with time zone NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
		CONSTRAINT "poly_trader_fills_source_check" CHECK ("poly_trader_fills"."source" IN ('data-api','clob-ws')),
	CONSTRAINT "poly_trader_fills_side_check" CHECK ("poly_trader_fills"."side" IN ('BUY','SELL')),
	CONSTRAINT "poly_trader_fills_price_positive" CHECK ("poly_trader_fills"."price" > 0),
	CONSTRAINT "poly_trader_fills_shares_positive" CHECK ("poly_trader_fills"."shares" > 0),
	CONSTRAINT "poly_trader_fills_size_positive" CHECK ("poly_trader_fills"."size_usdc" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "poly_trader_position_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trader_wallet_id" uuid NOT NULL,
	"condition_id" text NOT NULL,
	"token_id" text NOT NULL,
	"shares" numeric(20, 8) NOT NULL,
	"cost_basis_usdc" numeric(20, 8) NOT NULL,
	"current_value_usdc" numeric(20, 8) NOT NULL,
	"avg_price" numeric(18, 8) NOT NULL,
	"content_hash" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb,
	CONSTRAINT "poly_trader_position_snapshots_shares_nonnegative" CHECK ("poly_trader_position_snapshots"."shares" >= 0),
	CONSTRAINT "poly_trader_position_snapshots_cost_nonnegative" CHECK ("poly_trader_position_snapshots"."cost_basis_usdc" >= 0),
	CONSTRAINT "poly_trader_position_snapshots_value_nonnegative" CHECK ("poly_trader_position_snapshots"."current_value_usdc" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "poly_trader_current_positions" (
	"trader_wallet_id" uuid NOT NULL,
	"condition_id" text NOT NULL,
	"token_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"shares" numeric(20, 8) NOT NULL,
	"cost_basis_usdc" numeric(20, 8) NOT NULL,
	"current_value_usdc" numeric(20, 8) NOT NULL,
	"avg_price" numeric(18, 8) NOT NULL,
	"content_hash" text NOT NULL,
	"last_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb,
	CONSTRAINT "poly_trader_current_positions_trader_wallet_id_condition_id_token_id_pk" PRIMARY KEY("trader_wallet_id","condition_id","token_id"),
	CONSTRAINT "poly_trader_current_positions_shares_nonnegative" CHECK ("poly_trader_current_positions"."shares" >= 0),
	CONSTRAINT "poly_trader_current_positions_cost_nonnegative" CHECK ("poly_trader_current_positions"."cost_basis_usdc" >= 0),
	CONSTRAINT "poly_trader_current_positions_value_nonnegative" CHECK ("poly_trader_current_positions"."current_value_usdc" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "poly_copy_trade_attribution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_trader_wallet_id" uuid NOT NULL,
	"cogni_trader_wallet_id" uuid,
	"target_fill_id" uuid,
	"cogni_fill_id" uuid,
	"copy_trade_target_id" uuid,
	"copy_trade_fill_id" text,
	"copy_trade_decision_id" uuid,
	"condition_id" text NOT NULL,
	"token_id" text NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"target_vwap" numeric(18, 8),
	"cogni_vwap" numeric(18, 8),
	"target_size_usdc" numeric(20, 8),
	"cogni_size_usdc" numeric(20, 8),
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb,
	CONSTRAINT "poly_copy_trade_attribution_status_check" CHECK ("poly_copy_trade_attribution"."status" IN ('copied','partial','missed','resting','skipped','error','no_response_yet'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "poly_market_outcomes" (
	"condition_id" text NOT NULL,
	"token_id" text NOT NULL,
	"outcome" text NOT NULL,
	"payout" numeric(18, 8),
	"resolved_at" timestamp with time zone,
	"raw" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poly_market_outcomes_condition_id_token_id_pk" PRIMARY KEY("condition_id","token_id"),
	CONSTRAINT "poly_market_outcomes_outcome_check" CHECK ("poly_market_outcomes"."outcome" IN ('winner','loser','unknown'))
);
--> statement-breakpoint
ALTER TABLE "poly_trader_ingestion_cursors" ADD CONSTRAINT "poly_trader_ingestion_cursors_trader_wallet_id_poly_trader_wallets_id_fk" FOREIGN KEY ("trader_wallet_id") REFERENCES "public"."poly_trader_wallets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "poly_trader_fills" ADD CONSTRAINT "poly_trader_fills_trader_wallet_id_poly_trader_wallets_id_fk" FOREIGN KEY ("trader_wallet_id") REFERENCES "public"."poly_trader_wallets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "poly_trader_position_snapshots" ADD CONSTRAINT "poly_trader_position_snapshots_trader_wallet_id_poly_trader_wallets_id_fk" FOREIGN KEY ("trader_wallet_id") REFERENCES "public"."poly_trader_wallets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "poly_trader_current_positions" ADD CONSTRAINT "poly_trader_current_positions_trader_wallet_id_poly_trader_wallets_id_fk" FOREIGN KEY ("trader_wallet_id") REFERENCES "public"."poly_trader_wallets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "poly_copy_trade_attribution" ADD CONSTRAINT "poly_copy_trade_attribution_target_trader_wallet_id_poly_trader_wallets_id_fk" FOREIGN KEY ("target_trader_wallet_id") REFERENCES "public"."poly_trader_wallets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "poly_copy_trade_attribution" ADD CONSTRAINT "poly_copy_trade_attribution_cogni_trader_wallet_id_poly_trader_wallets_id_fk" FOREIGN KEY ("cogni_trader_wallet_id") REFERENCES "public"."poly_trader_wallets"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "poly_copy_trade_attribution" ADD CONSTRAINT "poly_copy_trade_attribution_target_fill_id_poly_trader_fills_id_fk" FOREIGN KEY ("target_fill_id") REFERENCES "public"."poly_trader_fills"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "poly_copy_trade_attribution" ADD CONSTRAINT "poly_copy_trade_attribution_cogni_fill_id_poly_trader_fills_id_fk" FOREIGN KEY ("cogni_fill_id") REFERENCES "public"."poly_trader_fills"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "poly_trader_wallets_wallet_address_idx" ON "poly_trader_wallets" USING btree ("wallet_address");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "poly_trader_wallets_observe_idx" ON "poly_trader_wallets" USING btree ("active_for_research","disabled_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "poly_trader_ingestion_cursors_status_idx" ON "poly_trader_ingestion_cursors" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "poly_trader_fills_trader_source_native_idx" ON "poly_trader_fills" USING btree ("trader_wallet_id","source","native_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "poly_trader_fills_trader_observed_idx" ON "poly_trader_fills" USING btree ("trader_wallet_id","observed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "poly_trader_fills_market_token_idx" ON "poly_trader_fills" USING btree ("condition_id","token_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "poly_trader_position_snapshots_hash_idx" ON "poly_trader_position_snapshots" USING btree ("trader_wallet_id","condition_id","token_id","content_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "poly_trader_position_snapshots_latest_idx" ON "poly_trader_position_snapshots" USING btree ("trader_wallet_id","captured_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "poly_trader_current_positions_active_idx" ON "poly_trader_current_positions" USING btree ("trader_wallet_id","active","current_value_usdc");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "poly_trader_current_positions_market_idx" ON "poly_trader_current_positions" USING btree ("condition_id","token_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "poly_copy_trade_attribution_target_window_idx" ON "poly_copy_trade_attribution" USING btree ("target_trader_wallet_id","window_start","window_end");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "poly_copy_trade_attribution_market_idx" ON "poly_copy_trade_attribution" USING btree ("condition_id","token_id");
--> statement-breakpoint
INSERT INTO "poly_trader_wallets" ("wallet_address", "kind", "label", "active_for_research")
VALUES
	('0x2005d16a84ceefa912d4e380cd32e7ff827875ea', 'copy_target', 'RN1', true),
	('0x204f72f35326db932158cba6adff0b9a1da95e14', 'copy_target', 'swisstony', true)
ON CONFLICT ("wallet_address") DO UPDATE SET
	"kind" = EXCLUDED."kind",
	"label" = EXCLUDED."label",
	"active_for_research" = EXCLUDED."active_for_research",
	"disabled_at" = NULL,
	"updated_at" = now();
