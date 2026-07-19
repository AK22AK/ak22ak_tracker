CREATE TABLE "resumption_assessments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_id" uuid NOT NULL,
	"base_plan_version_id" uuid NOT NULL,
	"planning_time_zone" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"decision" text,
	"applied_plan_version_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resumption_assessments_trigger_type_check" CHECK ("resumption_assessments"."trigger_type" IN ('execution_context', 'pause')),
	CONSTRAINT "resumption_assessments_status_check" CHECK ("resumption_assessments"."status" IN ('pending', 'kept_original', 'shifted', 'expired')),
	CONSTRAINT "resumption_assessments_decision_check" CHECK ("resumption_assessments"."decision" IS NULL OR "resumption_assessments"."decision" IN ('keep_original', 'shift'))
);
--> statement-breakpoint
CREATE TABLE "resumption_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"base_plan_version_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"applied_plan_version_id" uuid,
	"decided_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resumption_decisions_decision_check" CHECK ("resumption_decisions"."decision" IN ('keep_original', 'shift'))
);
--> statement-breakpoint
ALTER TABLE "resumption_assessments" ADD CONSTRAINT "resumption_assessments_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumption_assessments" ADD CONSTRAINT "resumption_assessments_base_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("base_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumption_assessments" ADD CONSTRAINT "resumption_assessments_applied_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("applied_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumption_decisions" ADD CONSTRAINT "resumption_decisions_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumption_decisions" ADD CONSTRAINT "resumption_decisions_assessment_id_resumption_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."resumption_assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumption_decisions" ADD CONSTRAINT "resumption_decisions_base_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("base_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumption_decisions" ADD CONSTRAINT "resumption_decisions_applied_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("applied_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resumption_assessments_trigger_unique" ON "resumption_assessments" USING btree ("tracker_id","trigger_type","trigger_id","base_plan_version_id");--> statement-breakpoint
CREATE INDEX "resumption_assessments_tracker_status_index" ON "resumption_assessments" USING btree ("tracker_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "resumption_decisions_assessment_unique" ON "resumption_decisions" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "resumption_decisions_tracker_index" ON "resumption_decisions" USING btree ("tracker_id");