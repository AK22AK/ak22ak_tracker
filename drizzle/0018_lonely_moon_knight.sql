CREATE TABLE "evaluation_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"result_id" uuid NOT NULL,
	"base_plan_version_id" uuid NOT NULL,
	"timeline_head_plan_version_id" uuid NOT NULL,
	"decided_on" date NOT NULL,
	"decision_version" text NOT NULL,
	"branch" text NOT NULL,
	"document" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evaluation_decisions_version_check" CHECK ("evaluation_decisions"."decision_version" = 'evaluation-decision-v1'),
	CONSTRAINT "evaluation_decisions_branch_check" CHECK ("evaluation_decisions"."branch" IN ('maintain', 'progress', 'extend', 'professional_review'))
);
--> statement-breakpoint
ALTER TABLE "evaluation_decisions" ADD CONSTRAINT "evaluation_decisions_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_decisions" ADD CONSTRAINT "evaluation_decisions_session_id_evaluation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."evaluation_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_decisions" ADD CONSTRAINT "evaluation_decisions_result_id_evaluation_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."evaluation_results"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_decisions" ADD CONSTRAINT "evaluation_decisions_base_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("base_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_decisions" ADD CONSTRAINT "evaluation_decisions_timeline_head_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("timeline_head_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_decisions_session_unique" ON "evaluation_decisions" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_decisions_result_unique" ON "evaluation_decisions" USING btree ("result_id");--> statement-breakpoint
CREATE INDEX "evaluation_decisions_tracker_index" ON "evaluation_decisions" USING btree ("tracker_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "assert_evaluation_decision_context"(
	p_tracker_id uuid,
	p_session_id uuid,
	p_result_id uuid,
	p_base_plan_version_id uuid,
	p_timeline_head_plan_version_id uuid,
	p_expected_context_revision integer,
	p_decided_on date,
	p_branch text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
	v_context_revision integer;
	v_session "evaluation_sessions"%ROWTYPE;
	v_result "evaluation_results"%ROWTYPE;
	v_base_plan_version_id uuid;
	v_timeline_head_plan_version_id uuid;
	v_has_red boolean;
	v_progress_blocked boolean;
BEGIN
	SELECT "ai_context_revision"
	INTO v_context_revision
	FROM "trackers"
	WHERE "id" = p_tracker_id AND "active" = true
	FOR UPDATE;

	IF NOT FOUND OR v_context_revision IS DISTINCT FROM p_expected_context_revision THEN
		RAISE EXCEPTION 'evaluation_decision_context_changed' USING ERRCODE = '40001';
	END IF;

	SELECT *
	INTO v_session
	FROM "evaluation_sessions"
	WHERE "id" = p_session_id AND "tracker_id" = p_tracker_id
	FOR UPDATE;

	SELECT *
	INTO v_result
	FROM "evaluation_results"
	WHERE "id" = p_result_id
		AND "session_id" = p_session_id
		AND "tracker_id" = p_tracker_id
	FOR UPDATE;

	IF v_session."id" IS NULL OR v_result."id" IS NULL OR
		v_session."status" <> 'open' OR
		v_session."base_plan_version_id" IS DISTINCT FROM p_base_plan_version_id OR
		v_session."timeline_head_plan_version_id" IS DISTINCT FROM p_timeline_head_plan_version_id OR
		v_result."base_plan_version_id" IS DISTINCT FROM p_base_plan_version_id OR
		v_result."timeline_head_plan_version_id" IS DISTINCT FROM p_timeline_head_plan_version_id THEN
		RAISE EXCEPTION 'evaluation_decision_context_changed' USING ERRCODE = '40001';
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

	SELECT
		EXISTS (
			SELECT 1 FROM "events"
			WHERE "tracker_id" = p_tracker_id
				AND "kind" = 'symptom_check_in'
				AND "local_date" = p_decided_on
				AND "document" #>> '{payload,safetyLevel}' = 'red'
		) OR EXISTS (
			SELECT 1
			FROM jsonb_array_elements(v_session."snapshot" -> 'weeks') AS week
			WHERE week #>> '{feedback,worstSafetyLevel}' = 'red'
		),
		EXISTS (
			SELECT 1
			FROM jsonb_array_elements(v_session."snapshot" -> 'weeks') AS week
			WHERE week #>> '{feedback,worstSafetyLevel}' IS DISTINCT FROM 'green'
		)
	INTO v_has_red, v_progress_blocked;

	IF v_timeline_head_plan_version_id IS DISTINCT FROM p_timeline_head_plan_version_id OR
		v_base_plan_version_id IS DISTINCT FROM p_base_plan_version_id OR
		(v_has_red AND p_branch <> 'professional_review') OR
		(p_branch = 'progress' AND v_progress_blocked) THEN
		RAISE EXCEPTION 'evaluation_decision_context_changed' USING ERRCODE = '40001';
	END IF;
END;
$$;
