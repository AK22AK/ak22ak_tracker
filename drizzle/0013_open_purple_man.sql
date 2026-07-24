CREATE TABLE "plan_change_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tracker_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"base_plan_version_id" uuid NOT NULL,
	"timeline_head_plan_version_id" uuid NOT NULL,
	"context_version" text NOT NULL,
	"context_hash" text NOT NULL,
	"context_revision" integer NOT NULL,
	"safety_level" text NOT NULL,
	"effective_from" date,
	"applied_plan_version_id" uuid,
	"decided_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_change_decisions_decision_check" CHECK ("plan_change_decisions"."decision" IN ('accepted', 'rejected')),
	CONSTRAINT "plan_change_decisions_result_check" CHECK (("plan_change_decisions"."decision" = 'accepted' AND "plan_change_decisions"."effective_from" IS NOT NULL AND "plan_change_decisions"."applied_plan_version_id" IS NOT NULL) OR ("plan_change_decisions"."decision" = 'rejected' AND "plan_change_decisions"."effective_from" IS NULL AND "plan_change_decisions"."applied_plan_version_id" IS NULL)),
	CONSTRAINT "plan_change_decisions_safety_check" CHECK ("plan_change_decisions"."safety_level" IN ('green', 'yellow', 'red') AND ("plan_change_decisions"."decision" = 'rejected' OR "plan_change_decisions"."safety_level" <> 'red'))
);
--> statement-breakpoint
ALTER TABLE "ai_analysis_jobs" ADD COLUMN "context_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_change_proposals" ADD COLUMN "context_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "trackers" ADD COLUMN "ai_context_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_change_decisions" ADD CONSTRAINT "plan_change_decisions_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_change_decisions" ADD CONSTRAINT "plan_change_decisions_proposal_id_plan_change_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."plan_change_proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_change_decisions" ADD CONSTRAINT "plan_change_decisions_base_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("base_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_change_decisions" ADD CONSTRAINT "plan_change_decisions_timeline_head_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("timeline_head_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_change_decisions" ADD CONSTRAINT "plan_change_decisions_applied_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("applied_plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_change_decisions_proposal_unique" ON "plan_change_decisions" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "plan_change_decisions_tracker_index" ON "plan_change_decisions" USING btree ("tracker_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "bump_tracker_ai_context_revision"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
	v_tracker_id uuid;
BEGIN
	v_tracker_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."tracker_id" ELSE NEW."tracker_id" END;
	UPDATE "trackers"
	SET "ai_context_revision" = "ai_context_revision" + 1,
		"updated_at" = now()
	WHERE "id" = v_tracker_id;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "plan_versions_ai_context_revision_trigger"
AFTER INSERT OR DELETE ON "plan_versions"
FOR EACH ROW EXECUTE FUNCTION "bump_tracker_ai_context_revision"();--> statement-breakpoint
CREATE TRIGGER "task_instances_ai_context_revision_insert_delete_trigger"
AFTER INSERT OR DELETE ON "task_instances"
FOR EACH ROW EXECUTE FUNCTION "bump_tracker_ai_context_revision"();--> statement-breakpoint
CREATE TRIGGER "task_instances_ai_context_revision_update_trigger"
AFTER UPDATE OF "status", "confirmed_by_user", "actual_data", "subjective_note" ON "task_instances"
FOR EACH ROW
WHEN (
	OLD."status" IS DISTINCT FROM NEW."status" OR
	OLD."confirmed_by_user" IS DISTINCT FROM NEW."confirmed_by_user" OR
	OLD."actual_data" IS DISTINCT FROM NEW."actual_data" OR
	OLD."subjective_note" IS DISTINCT FROM NEW."subjective_note"
)
EXECUTE FUNCTION "bump_tracker_ai_context_revision"();--> statement-breakpoint
CREATE TRIGGER "feedback_events_ai_context_revision_insert_trigger"
AFTER INSERT ON "events"
FOR EACH ROW
WHEN (NEW."kind" = 'symptom_check_in')
EXECUTE FUNCTION "bump_tracker_ai_context_revision"();--> statement-breakpoint
CREATE TRIGGER "feedback_events_ai_context_revision_delete_trigger"
AFTER DELETE ON "events"
FOR EACH ROW
WHEN (OLD."kind" = 'symptom_check_in')
EXECUTE FUNCTION "bump_tracker_ai_context_revision"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "assert_plan_change_decision_context"(
	p_tracker_id uuid,
	p_proposal_id uuid,
	p_context_version text,
	p_context_hash text,
	p_context_revision integer,
	p_base_plan_version_id uuid,
	p_timeline_head_plan_version_id uuid,
	p_safety_level text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
	v_tracker_revision integer;
	v_proposal "plan_change_proposals"%ROWTYPE;
BEGIN
	SELECT "ai_context_revision"
	INTO v_tracker_revision
	FROM "trackers"
	WHERE "id" = p_tracker_id AND "active" = true
	FOR UPDATE;

	IF NOT FOUND OR v_tracker_revision <> p_context_revision THEN
		RAISE EXCEPTION 'plan_change_context_changed' USING ERRCODE = '40001';
	END IF;

	SELECT *
	INTO v_proposal
	FROM "plan_change_proposals"
	WHERE "id" = p_proposal_id AND "tracker_id" = p_tracker_id
	FOR UPDATE;

	IF NOT FOUND OR
		v_proposal."status" <> 'proposed' OR
		v_proposal."context_version" IS DISTINCT FROM p_context_version OR
		v_proposal."context_hash" IS DISTINCT FROM p_context_hash OR
		v_proposal."context_revision" <> p_context_revision OR
		v_proposal."base_plan_version_id" <> p_base_plan_version_id OR
		v_proposal."timeline_head_plan_version_id" IS DISTINCT FROM p_timeline_head_plan_version_id OR
		v_proposal."safety_level" <> p_safety_level THEN
		RAISE EXCEPTION 'plan_change_context_changed' USING ERRCODE = '40001';
	END IF;
END;
$$;
