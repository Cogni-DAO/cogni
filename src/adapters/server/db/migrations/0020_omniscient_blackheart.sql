CREATE TABLE "epoch_subject_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"epoch_id" bigint NOT NULL,
	"subject_ref" text NOT NULL,
	"override_units" bigint,
	"override_shares_json" jsonb,
	"override_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "epoch_statements" ADD COLUMN "review_overrides_json" jsonb;--> statement-breakpoint
ALTER TABLE "epoch_subject_overrides" ADD CONSTRAINT "epoch_subject_overrides_epoch_id_epochs_id_fk" FOREIGN KEY ("epoch_id") REFERENCES "public"."epochs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "epoch_subject_overrides_epoch_ref_unique" ON "epoch_subject_overrides" USING btree ("epoch_id","subject_ref");--> statement-breakpoint
CREATE INDEX "epoch_subject_overrides_epoch_idx" ON "epoch_subject_overrides" USING btree ("epoch_id");