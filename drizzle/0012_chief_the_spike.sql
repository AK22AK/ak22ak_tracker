CREATE TABLE "ai_analysis_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"base_plan_version_id" uuid NOT NULL,
	"timeline_head_plan_version_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"context_version" text NOT NULL,
	"context_hash" text NOT NULL,
	"context_from" date NOT NULL,
	"context_through" date NOT NULL,
	"safety_level" text NOT NULL,
	"response_hash" text,
	"last_error_code" text,
	"requested_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_analysis_jobs_status_check" CHECK ("ai_analysis_jobs"."status" IN ('pending', 'running', 'succeeded', 'failed')),
	CONSTRAINT "ai_analysis_jobs_safety_check" CHECK ("ai_analysis_jobs"."safety_level" IN ('green', 'yellow', 'red')),
	CONSTRAINT "ai_analysis_jobs_range_check" CHECK ("ai_analysis_jobs"."context_through" >= "ai_analysis_jobs"."context_from")
);
--> statement-breakpoint
ALTER TABLE "plan_change_proposals" ADD COLUMN "analysis_job_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_change_proposals" ADD COLUMN "timeline_head_plan_version_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_change_proposals" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "plan_change_proposals" ADD COLUMN "context_version" text;--> statement-breakpoint
ALTER TABLE "plan_change_proposals" ADD COLUMN "context_hash" text;--> statement-breakpoint
ALTER TABLE "plan_change_proposals" ADD COLUMN "context_from" date;--> statement-breakpoint
ALTER TABLE "plan_change_proposals" ADD COLUMN "context_through" date;--> statement-breakpoint
ALTER TABLE "ai_analysis_jobs" ADD CONSTRAINT "ai_analysis_jobs_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analysis_jobs" ADD CONSTRAINT "ai_analysis_jobs_base_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("base_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analysis_jobs" ADD CONSTRAINT "ai_analysis_jobs_timeline_head_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("timeline_head_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_analysis_jobs_tracker_requested_index" ON "ai_analysis_jobs" USING btree ("tracker_id","requested_at");--> statement-breakpoint
ALTER TABLE "plan_change_proposals" ADD CONSTRAINT "plan_change_proposals_analysis_job_id_ai_analysis_jobs_id_fk" FOREIGN KEY ("analysis_job_id") REFERENCES "public"."ai_analysis_jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_change_proposals" ADD CONSTRAINT "plan_change_proposals_timeline_head_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("timeline_head_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_change_proposals" ADD CONSTRAINT "plan_change_proposals_analysis_job_id_unique" UNIQUE("analysis_job_id");