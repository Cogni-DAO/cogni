CREATE TABLE "content_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"billing_account_id" text NOT NULL,
	"body" text NOT NULL,
	"title" text,
	"media_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_platforms" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_message_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"optimized_body" text NOT NULL,
	"optimized_title" text,
	"media_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"platform_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending_optimization' NOT NULL,
	"risk_level" text,
	"risk_reason" text,
	"review_decision" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"external_id" text,
	"external_url" text,
	"error_message" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_messages" ADD CONSTRAINT "content_messages_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_messages" ADD CONSTRAINT "content_messages_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_posts" ADD CONSTRAINT "platform_posts_content_message_id_content_messages_id_fk" FOREIGN KEY ("content_message_id") REFERENCES "public"."content_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_messages_owner_idx" ON "content_messages" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "content_messages_status_idx" ON "content_messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "content_messages_billing_account_idx" ON "content_messages" USING btree ("billing_account_id");--> statement-breakpoint
CREATE INDEX "platform_posts_content_message_idx" ON "platform_posts" USING btree ("content_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_posts_platform_unique" ON "platform_posts" USING btree ("content_message_id","platform");--> statement-breakpoint
CREATE INDEX "platform_posts_status_idx" ON "platform_posts" USING btree ("status");--> statement-breakpoint

-- Handwritten appendix: RLS enforcement + policies for broadcasting tables.
-- Pattern: content_messages uses direct FK (owner_user_id → users.id).
-- platform_posts uses transitive FK (content_message_id → content_messages → users.id).

ALTER TABLE "content_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "content_messages" AS PERMISSIVE FOR ALL TO public
  USING ("owner_user_id" = current_setting('app.current_user_id', true))
  WITH CHECK ("owner_user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint

ALTER TABLE "platform_posts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "platform_posts" AS PERMISSIVE FOR ALL TO public
  USING ("content_message_id" IN (
    SELECT "id" FROM "content_messages"
    WHERE "owner_user_id" = current_setting('app.current_user_id', true)
  ))
  WITH CHECK ("content_message_id" IN (
    SELECT "id" FROM "content_messages"
    WHERE "owner_user_id" = current_setting('app.current_user_id', true)
  ));