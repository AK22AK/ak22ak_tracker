ALTER TABLE "github_sync_outbox" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "github_sync_outbox" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "github_sync_outbox_target_order_index" ON "github_sync_outbox" USING btree ("target_path","created_at","id");