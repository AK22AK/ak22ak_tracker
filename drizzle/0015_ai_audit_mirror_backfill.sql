-- Backfill the current, strictly structured AI audit state into the existing
-- GitHub mirror outbox. The stable aggregate key lets later status changes
-- replace this snapshot without creating duplicate audit files.
INSERT INTO "github_sync_outbox" (
	"aggregate_type",
	"aggregate_id",
	"target_path",
	"payload",
	"status",
	"attempts",
	"next_attempt_at",
	"lease_owner",
	"lease_expires_at",
	"last_error_code",
	"created_at",
	"updated_at"
)
SELECT
	'ai_analysis_job',
	job."id",
	'trackers/' || tracker."key" || '/ai/analysis-jobs/' || job."id"::text || '.json',
	jsonb_build_object(
		'schemaVersion', '1.0.0',
		'kind', 'ai_analysis_job',
		'id', job."id",
		'trackerKey', tracker."key",
		'proposalId', proposal."id",
		'status', job."status",
		'errorCode', job."last_error_code",
		'provider', job."provider",
		'model', job."model",
		'attemptCount', job."attempt_count",
		'context', jsonb_build_object(
			'version', job."context_version",
			'hash', job."context_hash",
			'revision', job."context_revision",
			'range', jsonb_build_object(
				'from', job."context_from",
				'through', job."context_through"
			),
			'basePlanVersionId', job."base_plan_version_id",
			'timelineHeadPlanVersionId', job."timeline_head_plan_version_id",
			'safetyLevel', job."safety_level"
		),
		'responseHash', job."response_hash",
		'requestedAt', to_char(job."requested_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
		'startedAt', CASE WHEN job."started_at" IS NULL THEN NULL ELSE to_char(job."started_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
		'completedAt', CASE WHEN job."completed_at" IS NULL THEN NULL ELSE to_char(job."completed_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
	),
	'pending',
	0,
	NOW(),
	NULL,
	NULL,
	NULL,
	NOW(),
	NOW()
FROM "ai_analysis_jobs" job
INNER JOIN "trackers" tracker ON tracker."id" = job."tracker_id"
LEFT JOIN "plan_change_proposals" proposal ON proposal."analysis_job_id" = job."id"
WHERE tracker."key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
ON CONFLICT ("aggregate_type", "aggregate_id") DO UPDATE SET
	"target_path" = EXCLUDED."target_path",
	"payload" = EXCLUDED."payload",
	"status" = 'pending',
	"attempts" = 0,
	"next_attempt_at" = EXCLUDED."next_attempt_at",
	"lease_owner" = NULL,
	"lease_expires_at" = NULL,
	"last_error_code" = NULL,
	"updated_at" = EXCLUDED."updated_at";
--> statement-breakpoint
INSERT INTO "github_sync_outbox" (
	"aggregate_type",
	"aggregate_id",
	"target_path",
	"payload",
	"status",
	"attempts",
	"next_attempt_at",
	"lease_owner",
	"lease_expires_at",
	"last_error_code",
	"created_at",
	"updated_at"
)
SELECT
	'plan_change_proposal',
	proposal."id",
	'trackers/' || tracker."key" || '/ai/proposals/' || proposal."id"::text || '.json',
	jsonb_build_object(
		'schemaVersion', '1.0.0',
		'kind', 'plan_change_proposal',
		'id', proposal."id",
		'trackerKey', tracker."key",
		'analysisJobId', proposal."analysis_job_id",
		'basePlanVersionId', proposal."base_plan_version_id",
		'timelineHeadPlanVersionId', proposal."timeline_head_plan_version_id",
		'model', proposal."model",
		'context', jsonb_build_object(
			'version', proposal."context_version",
			'hash', proposal."context_hash",
			'revision', proposal."context_revision",
			'range', jsonb_build_object(
				'from', proposal."context_from",
				'through', proposal."context_through"
			),
			'timelineHeadPlanVersionId', proposal."timeline_head_plan_version_id",
			'safetyLevel', proposal."safety_level"
		),
		'safetyLevel', proposal."safety_level",
		'summary', proposal."document" -> 'summary',
		'operations', proposal."document" -> 'operations',
		'status', proposal."status",
		'createdAt', to_char(proposal."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
		'decision', CASE WHEN decision."id" IS NULL THEN NULL ELSE jsonb_build_object(
			'id', decision."id",
			'type', decision."decision",
			'decidedAt', to_char(decision."decided_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
			'appliedPlanVersionId', decision."applied_plan_version_id",
			'effectiveFrom', decision."effective_from"
		) END,
		'rollback', CASE WHEN rollback."id" IS NULL THEN NULL ELSE jsonb_build_object(
			'id', rollback."id",
			'sourceAppliedPlanVersionId', rollback."source_applied_plan_version_id",
			'targetBasePlanVersionId', rollback."target_base_plan_version_id",
			'newPlanVersionId', rollback."new_plan_version_id",
			'effectiveFrom', rollback."effective_from",
			'decidedAt', to_char(rollback."decided_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
		) END
	),
	'pending',
	0,
	NOW(),
	NULL,
	NULL,
	NULL,
	NOW(),
	NOW()
FROM "plan_change_proposals" proposal
INNER JOIN "trackers" tracker ON tracker."id" = proposal."tracker_id"
INNER JOIN "ai_analysis_jobs" job ON job."id" = proposal."analysis_job_id"
LEFT JOIN "plan_change_decisions" decision ON decision."proposal_id" = proposal."id"
LEFT JOIN "plan_version_rollbacks" rollback ON rollback."source_decision_id" = decision."id"
WHERE tracker."key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
	AND proposal."analysis_job_id" IS NOT NULL
	AND proposal."timeline_head_plan_version_id" IS NOT NULL
	AND proposal."model" IS NOT NULL
	AND proposal."context_version" = '1'
	AND proposal."context_hash" IS NOT NULL
	AND proposal."context_from" IS NOT NULL
	AND proposal."context_through" IS NOT NULL
ON CONFLICT ("aggregate_type", "aggregate_id") DO UPDATE SET
	"target_path" = EXCLUDED."target_path",
	"payload" = EXCLUDED."payload",
	"status" = 'pending',
	"attempts" = 0,
	"next_attempt_at" = EXCLUDED."next_attempt_at",
	"lease_owner" = NULL,
	"lease_expires_at" = NULL,
	"last_error_code" = NULL,
	"updated_at" = EXCLUDED."updated_at";
