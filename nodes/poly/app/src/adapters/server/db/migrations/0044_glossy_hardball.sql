CREATE TABLE "poly_market_metadata" (
	"condition_id" text PRIMARY KEY NOT NULL,
	"event_title" text,
	"event_slug" text,
	"market_title" text,
	"market_slug" text,
	"end_date" timestamp with time zone,
	"raw" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "poly_market_metadata_event_slug_idx" ON "poly_market_metadata" USING btree ("event_slug");--> statement-breakpoint
CREATE INDEX "poly_market_metadata_end_date_idx" ON "poly_market_metadata" USING btree ("end_date");