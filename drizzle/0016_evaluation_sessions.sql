CREATE TABLE "evaluation_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"trigger_date" date NOT NULL,
	"target_date" date NOT NULL,
	"base_plan_version_id" uuid NOT NULL,
	"timeline_head_plan_version_id" uuid NOT NULL,
	"planning_time_zone" text NOT NULL,
	"calculation_version" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluation_sessions_kind_check" CHECK ("evaluation_sessions"."kind" IN ('stage', 'final')),
	CONSTRAINT "evaluation_sessions_status_check" CHECK ("evaluation_sessions"."status" IN ('open', 'expired')),
	CONSTRAINT "evaluation_sessions_range_check" CHECK ("evaluation_sessions"."trigger_date" >= "evaluation_sessions"."target_date")
);
--> statement-breakpoint
ALTER TABLE "evaluation_sessions" ADD CONSTRAINT "evaluation_sessions_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_sessions" ADD CONSTRAINT "evaluation_sessions_base_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("base_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_sessions" ADD CONSTRAINT "evaluation_sessions_timeline_head_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("timeline_head_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_sessions_target_head_unique" ON "evaluation_sessions" USING btree ("tracker_id","kind","target_date","timeline_head_plan_version_id");--> statement-breakpoint
CREATE INDEX "evaluation_sessions_tracker_created_index" ON "evaluation_sessions" USING btree ("tracker_id","created_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "assert_evaluation_session_context"(
	p_tracker_id uuid,
	p_target_date date,
	p_base_plan_version_id uuid,
	p_timeline_head_plan_version_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
	v_base_plan_version_id uuid;
	v_timeline_head_plan_version_id uuid;
BEGIN
	PERFORM 1
	FROM "trackers"
	WHERE "id" = p_tracker_id AND "active" = true
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'evaluation_context_changed' USING ERRCODE = '40001';
	END IF;

	SELECT "id"
	INTO v_timeline_head_plan_version_id
	FROM "plan_versions"
	WHERE "tracker_id" = p_tracker_id
	ORDER BY "version" DESC
	LIMIT 1;

	SELECT "id"
	INTO v_base_plan_version_id
	FROM "plan_versions"
	WHERE "tracker_id" = p_tracker_id
		AND "effective_from" <= p_target_date
	ORDER BY "effective_from" DESC, "version" DESC
	LIMIT 1;

	IF v_timeline_head_plan_version_id IS DISTINCT FROM p_timeline_head_plan_version_id OR
		v_base_plan_version_id IS DISTINCT FROM p_base_plan_version_id THEN
		RAISE EXCEPTION 'evaluation_context_changed' USING ERRCODE = '40001';
	END IF;
END;
$$;
