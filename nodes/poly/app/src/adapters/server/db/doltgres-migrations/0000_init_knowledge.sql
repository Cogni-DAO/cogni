CREATE TABLE "knowledge" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"entity_id" text,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"confidence_pct" integer,
	"source_type" text NOT NULL,
	"source_ref" text,
	"tags" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_knowledge_domain" ON "knowledge" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "idx_knowledge_entity" ON "knowledge" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "idx_knowledge_source_type" ON "knowledge" USING btree ("source_type");