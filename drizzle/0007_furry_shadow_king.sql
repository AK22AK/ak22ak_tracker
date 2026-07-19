CREATE TYPE "public"."execution_context_kind" AS ENUM('travel', 'equipment_limited');--> statement-breakpoint
CREATE TYPE "public"."execution_safety_disposition" AS ENUM('normal', 'stop_reassess');--> statement-breakpoint
CREATE TABLE "execution_alternative_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"option_key" text NOT NULL,
	"version" integer NOT NULL,
	"effective_from" date NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_contexts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"kind" "execution_context_kind" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"ended_on" date,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_contexts_date_range_check" CHECK ("execution_contexts"."end_date" >= "execution_contexts"."start_date")
);
--> statement-breakpoint
CREATE TABLE "execution_day_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracker_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"conditions" jsonb NOT NULL,
	"selected_alternative_id" uuid,
	"selected_alternative_version" integer,
	"safety_disposition" "execution_safety_disposition" DEFAULT 'normal' NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_day_decisions_selection_check" CHECK (("execution_day_decisions"."selected_alternative_id" IS NULL AND "execution_day_decisions"."selected_alternative_version" IS NULL) OR ("execution_day_decisions"."selected_alternative_id" IS NOT NULL AND "execution_day_decisions"."selected_alternative_version" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "execution_alternative_versions" ADD CONSTRAINT "execution_alternative_versions_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_contexts" ADD CONSTRAINT "execution_contexts_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_day_decisions" ADD CONSTRAINT "execution_day_decisions_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_day_decisions" ADD CONSTRAINT "execution_day_decisions_context_id_execution_contexts_id_fk" FOREIGN KEY ("context_id") REFERENCES "public"."execution_contexts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_day_decisions" ADD CONSTRAINT "execution_day_decisions_selected_alternative_id_execution_alternative_versions_id_fk" FOREIGN KEY ("selected_alternative_id") REFERENCES "public"."execution_alternative_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "execution_alternatives_tracker_key_version_unique" ON "execution_alternative_versions" USING btree ("tracker_id","option_key","version");--> statement-breakpoint
CREATE INDEX "execution_alternatives_tracker_effective_index" ON "execution_alternative_versions" USING btree ("tracker_id","effective_from");--> statement-breakpoint
CREATE INDEX "execution_contexts_tracker_range_index" ON "execution_contexts" USING btree ("tracker_id","start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_day_decisions_context_date_unique" ON "execution_day_decisions" USING btree ("context_id","local_date");--> statement-breakpoint
CREATE INDEX "execution_day_decisions_tracker_date_index" ON "execution_day_decisions" USING btree ("tracker_id","local_date");
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "btree_gist";
--> statement-breakpoint
ALTER TABLE "execution_contexts" ADD CONSTRAINT "execution_contexts_no_open_overlap" EXCLUDE USING gist ("tracker_id" WITH =, daterange("start_date", "end_date", '[]') WITH &&) WHERE ("ended_at" IS NULL);
