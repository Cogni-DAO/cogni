-- task.0423 v0-of-v0: error_reports table for "Send to Cogni" UI submissions.
--
-- v0-of-v0 (this migration): table created with loki_window/loki_status
-- columns present but unused. The intake API inserts rows synchronously
-- with loki_status='pending'; no worker fills loki_window yet.
--
-- v1 (task.0420): a Temporal worker pulls the matching Loki window and
-- updates loki_window + loki_status. No schema change; same row.
--
-- SYSTEM_OWNED: no RLS on this table. The intake route is anonymous-allowed
-- (so `(public)/error.tsx` can submit), so a per-user RLS policy doesn't
-- make sense. Reads are admin-only via direct queries. Same precedent as
-- poly_copy_trade_* tables.
--
-- Note on drift: drizzle-kit also proposed DROP TABLE for
-- poly_copy_trade_{config,decisions,fills} (relocated to poly's node-local
-- schema in task.0322 but never dropped from operator's DB). That drop is
-- *not* part of this PR's scope — see follow-up to clean up that drift in
-- a dedicated migration. Do not add DROPs here.

CREATE TABLE "error_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"node" text NOT NULL,
	"build_sha" text,
	"user_id" text,
	"digest" text,
	"route" text NOT NULL,
	"error_name" text NOT NULL,
	"error_message" text NOT NULL,
	"error_stack" text,
	"component_stack" text,
	"user_note" text,
	"user_agent" text,
	"client_ts" timestamp with time zone,
	"loki_window" jsonb,
	"loki_status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "error_reports_created_at_idx" ON "error_reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "error_reports_digest_idx" ON "error_reports" USING btree ("digest");--> statement-breakpoint
CREATE INDEX "error_reports_user_id_idx" ON "error_reports" USING btree ("user_id");
