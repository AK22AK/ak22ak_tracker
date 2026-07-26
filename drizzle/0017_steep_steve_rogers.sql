CREATE TABLE "evaluation_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"base_plan_version_id" uuid NOT NULL,
	"timeline_head_plan_version_id" uuid NOT NULL,
	"submitted_on" date NOT NULL,
	"result_version" text NOT NULL,
	"document" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluation_results_version_check" CHECK ("evaluation_results"."result_version" = 'evaluation-result-v1')
);
--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_session_id_evaluation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."evaluation_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_base_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("base_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_timeline_head_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("timeline_head_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_results_session_unique" ON "evaluation_results" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "evaluation_results_tracker_index" ON "evaluation_results" USING btree ("tracker_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "assert_evaluation_result_context"(
	p_tracker_id uuid,
	p_session_id uuid,
	p_base_plan_version_id uuid,
	p_timeline_head_plan_version_id uuid,
	p_expected_context_revision integer,
	p_submitted_on date
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
	v_context_revision integer;
	v_session "evaluation_sessions"%ROWTYPE;
	v_base_plan_version_id uuid;
	v_timeline_head_plan_version_id uuid;
BEGIN
	SELECT "ai_context_revision"
	INTO v_context_revision
	FROM "trackers"
	WHERE "id" = p_tracker_id AND "active" = true
	FOR UPDATE;

	IF NOT FOUND OR v_context_revision IS DISTINCT FROM p_expected_context_revision THEN
		RAISE EXCEPTION 'evaluation_result_context_changed' USING ERRCODE = '40001';
	END IF;

	SELECT *
	INTO v_session
	FROM "evaluation_sessions"
	WHERE "id" = p_session_id AND "tracker_id" = p_tracker_id
	FOR UPDATE;

	IF NOT FOUND OR v_session."status" <> 'open' OR
		v_session."base_plan_version_id" IS DISTINCT FROM p_base_plan_version_id OR
		v_session."timeline_head_plan_version_id" IS DISTINCT FROM p_timeline_head_plan_version_id THEN
		RAISE EXCEPTION 'evaluation_result_context_changed' USING ERRCODE = '40001';
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
		AND "effective_from" <= v_session."target_date"
	ORDER BY "effective_from" DESC, "version" DESC
	LIMIT 1;

	IF v_timeline_head_plan_version_id IS DISTINCT FROM p_timeline_head_plan_version_id OR
		v_base_plan_version_id IS DISTINCT FROM p_base_plan_version_id OR
		EXISTS (
			SELECT 1
			FROM "events"
			WHERE "tracker_id" = p_tracker_id
				AND "kind" = 'symptom_check_in'
				AND "local_date" = p_submitted_on
				AND "document" #>> '{payload,safetyLevel}' = 'red'
		) THEN
		RAISE EXCEPTION 'evaluation_result_context_changed' USING ERRCODE = '40001';
	END IF;
END;
$$;
