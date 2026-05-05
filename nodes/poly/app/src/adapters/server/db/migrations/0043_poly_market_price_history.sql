-- task.5018 (CP7): mirror Polymarket /prices-history into a per-asset DB read model so
-- getExecutionSlice's per-position timeline chart no longer hits CLOB on page-load.
-- Closes the PAGE_LOAD_DB_ONLY_EXCEPT_PRICE_HISTORY exception introduced in CP5.
-- PK (asset, fidelity, ts) mirrors poly_trader_user_pnl_points; reader picks '1h' for
-- short windows (≤~1 month) and '1d' for longer.

CREATE TABLE "poly_market_price_history" (
	"asset" text NOT NULL,
	"fidelity" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"price" numeric(18, 8) NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poly_market_price_history_asset_fidelity_ts_pk" PRIMARY KEY("asset","fidelity","ts"),
	CONSTRAINT "poly_market_price_history_fidelity_check" CHECK ("poly_market_price_history"."fidelity" IN ('1h','1d'))
);
--> statement-breakpoint
CREATE INDEX "poly_market_price_history_read_idx" ON "poly_market_price_history" USING btree ("asset","fidelity","ts");