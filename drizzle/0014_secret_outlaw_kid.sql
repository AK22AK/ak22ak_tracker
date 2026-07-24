CREATE TABLE "plan_version_rollbacks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"source_decision_id" uuid NOT NULL,
	"source_applied_plan_version_id" uuid NOT NULL,
	"target_base_plan_version_id" uuid NOT NULL,
	"new_plan_version_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_version_rollbacks" ADD CONSTRAINT "plan_version_rollbacks_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_version_rollbacks" ADD CONSTRAINT "plan_version_rollbacks_proposal_id_plan_change_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."plan_change_proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_version_rollbacks" ADD CONSTRAINT "plan_version_rollbacks_source_decision_id_plan_change_decisions_id_fk" FOREIGN KEY ("source_decision_id") REFERENCES "public"."plan_change_decisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_version_rollbacks" ADD CONSTRAINT "plan_version_rollbacks_source_applied_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("source_applied_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_version_rollbacks" ADD CONSTRAINT "plan_version_rollbacks_target_base_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("target_base_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_version_rollbacks" ADD CONSTRAINT "plan_version_rollbacks_new_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("new_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_version_rollbacks_source_applied_unique" ON "plan_version_rollbacks" USING btree ("source_applied_plan_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_version_rollbacks_new_plan_unique" ON "plan_version_rollbacks" USING btree ("new_plan_version_id");--> statement-breakpoint
CREATE INDEX "plan_version_rollbacks_tracker_index" ON "plan_version_rollbacks" USING btree ("tracker_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "assert_plan_version_rollback_context"(
	p_tracker_id uuid,
	p_proposal_id uuid,
	p_source_decision_id uuid,
	p_source_applied_plan_version_id uuid,
	p_target_base_plan_version_id uuid,
	p_expected_timeline_head_plan_version_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
	v_decision "plan_change_decisions"%ROWTYPE;
	v_timeline_head_plan_version_id uuid;
BEGIN
	PERFORM 1
	FROM "trackers"
	WHERE "id" = p_tracker_id AND "active" = true
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'plan_version_rollback_context_changed' USING ERRCODE = '40001';
	END IF;

	SELECT *
	INTO v_decision
	FROM "plan_change_decisions"
	WHERE "id" = p_source_decision_id
		AND "tracker_id" = p_tracker_id
		AND "proposal_id" = p_proposal_id
	FOR UPDATE;

	IF NOT FOUND OR
		v_decision."decision" <> 'accepted' OR
		v_decision."applied_plan_version_id" IS DISTINCT FROM p_source_applied_plan_version_id OR
		v_decision."base_plan_version_id" <> p_target_base_plan_version_id THEN
		RAISE EXCEPTION 'plan_version_rollback_context_changed' USING ERRCODE = '40001';
	END IF;

	SELECT "id"
	INTO v_timeline_head_plan_version_id
	FROM "plan_versions"
	WHERE "tracker_id" = p_tracker_id
	ORDER BY "version" DESC
	LIMIT 1
	FOR UPDATE;

	IF v_timeline_head_plan_version_id IS DISTINCT FROM p_expected_timeline_head_plan_version_id OR
		v_timeline_head_plan_version_id IS DISTINCT FROM p_source_applied_plan_version_id THEN
		RAISE EXCEPTION 'plan_version_rollback_context_changed' USING ERRCODE = '40001';
	END IF;
END;
$$;
