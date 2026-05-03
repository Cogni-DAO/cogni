CREATE TABLE "work_item_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" text NOT NULL,
	"claimed_by_user_id" text NOT NULL,
	"claimed_by_display_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"deadline_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"last_command" text,
	"branch" text,
	"pr_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_sessions_status_check" CHECK ("work_item_sessions"."status" IN ('active','idle','stale','closed','superseded'))
);
--> statement-breakpoint
ALTER TABLE "work_item_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_item_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_item_sessions" ADD CONSTRAINT "work_item_sessions_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_sessions_work_item_id_idx" ON "work_item_sessions" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_sessions_claimed_by_user_idx" ON "work_item_sessions" USING btree ("claimed_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_sessions_one_open_claim_idx" ON "work_item_sessions" USING btree ("work_item_id") WHERE "work_item_sessions"."status" IN ('active','idle');
