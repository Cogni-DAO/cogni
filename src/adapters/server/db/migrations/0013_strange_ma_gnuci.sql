ALTER TABLE "epochs" DROP CONSTRAINT "epochs_status_check";--> statement-breakpoint
ALTER TABLE "epochs" ADD COLUMN "approver_set_hash" text;--> statement-breakpoint
ALTER TABLE "epochs" ADD COLUMN "allocation_algo_ref" text;--> statement-breakpoint
ALTER TABLE "epochs" ADD COLUMN "weight_config_hash" text;--> statement-breakpoint
ALTER TABLE "epochs" ADD CONSTRAINT "epochs_status_check" CHECK ("epochs"."status" IN ('open', 'review', 'finalized'));