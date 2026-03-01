CREATE TABLE "link_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_transactions_provider_check" CHECK ("link_transactions"."provider" IN ('github', 'discord', 'google'))
);
--> statement-breakpoint
ALTER TABLE "link_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "link_transactions" ADD CONSTRAINT "link_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "link_transactions_user_id_idx" ON "link_transactions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "link_transactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "link_transactions"
  USING ("user_id" = current_setting('app.current_user_id', true))
  WITH CHECK ("user_id" = current_setting('app.current_user_id', true));