ALTER TABLE "integration_sync_state" ADD COLUMN "cooldown_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_sync_state" ADD COLUMN "cooldown_kind" text;