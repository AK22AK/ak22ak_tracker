ALTER TABLE "events" ADD COLUMN "occurred_time_zone" text DEFAULT 'Asia/Shanghai' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "occurred_utc_offset_minutes" integer DEFAULT 480 NOT NULL;--> statement-breakpoint
ALTER TABLE "trackers" ADD COLUMN "planning_time_zone" text DEFAULT 'Asia/Shanghai' NOT NULL;--> statement-breakpoint
UPDATE "events"
SET "document" = "document" || jsonb_build_object(
  'occurredTimeZone', "occurred_time_zone",
  'occurredUtcOffsetMinutes', "occurred_utc_offset_minutes"
)
WHERE NOT ("document" ? 'occurredTimeZone')
   OR NOT ("document" ? 'occurredUtcOffsetMinutes');--> statement-breakpoint
CREATE INDEX "plan_versions_tracker_effective_index" ON "plan_versions" USING btree ("tracker_id","effective_from");
