DROP INDEX "resumption_assessments_trigger_unique";--> statement-breakpoint
ALTER TABLE "resumption_assessments" ADD COLUMN "timeline_head_plan_version_id" uuid;--> statement-breakpoint
UPDATE "resumption_assessments"
SET "timeline_head_plan_version_id" = "base_plan_version_id"
WHERE "timeline_head_plan_version_id" IS NULL;--> statement-breakpoint
ALTER TABLE "resumption_assessments" ALTER COLUMN "timeline_head_plan_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "resumption_assessments" ADD CONSTRAINT "resumption_assessments_timeline_head_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("timeline_head_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resumption_assessments_trigger_unique" ON "resumption_assessments" USING btree ("tracker_id","trigger_type","trigger_id","base_plan_version_id","timeline_head_plan_version_id");
