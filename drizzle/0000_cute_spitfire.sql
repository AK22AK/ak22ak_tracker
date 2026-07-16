CREATE TYPE "public"."external_link_status" AS ENUM('suggested', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('idle', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('planned', 'completed', 'skipped');--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"local_date" date NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"document" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_record_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_record_id" uuid NOT NULL,
	"task_instance_id" uuid NOT NULL,
	"status" "external_link_status" DEFAULT 'suggested' NOT NULL,
	"confidence" integer,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "external_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_record_id" text NOT NULL,
	"kind" text NOT NULL,
	"local_date" date NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"document" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_sync_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"target_path" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracker_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" "sync_status" DEFAULT 'idle' NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_succeeded_at" timestamp with time zone,
	"cursor" jsonb,
	"last_error_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_change_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"base_plan_version_id" uuid NOT NULL,
	"status" text NOT NULL,
	"safety_level" text NOT NULL,
	"document" jsonb NOT NULL,
	"decided_at" timestamp with time zone,
	"applied_plan_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"effective_from" date NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracker_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"task_definition_id" text NOT NULL,
	"scheduled_on" date NOT NULL,
	"status" "task_status" DEFAULT 'planned' NOT NULL,
	"completed_at" timestamp with time zone,
	"confirmed_by_user" boolean DEFAULT false NOT NULL,
	"subjective_note" text
);
--> statement-breakpoint
CREATE TABLE "trackers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"module" text NOT NULL,
	"started_on" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trackers_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_record_links" ADD CONSTRAINT "external_record_links_external_record_id_external_records_id_fk" FOREIGN KEY ("external_record_id") REFERENCES "public"."external_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_record_links" ADD CONSTRAINT "external_record_links_task_instance_id_task_instances_id_fk" FOREIGN KEY ("task_instance_id") REFERENCES "public"."task_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_records" ADD CONSTRAINT "external_records_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_state" ADD CONSTRAINT "integration_sync_state_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_change_proposals" ADD CONSTRAINT "plan_change_proposals_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_change_proposals" ADD CONSTRAINT "plan_change_proposals_base_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("base_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_change_proposals" ADD CONSTRAINT "plan_change_proposals_applied_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("applied_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_instances" ADD CONSTRAINT "task_instances_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_instances" ADD CONSTRAINT "task_instances_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_idempotency_key_unique" ON "events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "events_tracker_date_index" ON "events" USING btree ("tracker_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "external_record_links_pair_unique" ON "external_record_links" USING btree ("external_record_id","task_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_records_provider_id_unique" ON "external_records" USING btree ("provider","provider_record_id");--> statement-breakpoint
CREATE INDEX "external_records_tracker_date_index" ON "external_records" USING btree ("tracker_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "github_sync_outbox_aggregate_unique" ON "github_sync_outbox" USING btree ("aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "github_sync_outbox_status_retry_index" ON "github_sync_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_state_tracker_provider_unique" ON "integration_sync_state" USING btree ("tracker_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_versions_tracker_version_unique" ON "plan_versions" USING btree ("tracker_id","version");--> statement-breakpoint
CREATE INDEX "task_instances_tracker_date_index" ON "task_instances" USING btree ("tracker_id","scheduled_on");