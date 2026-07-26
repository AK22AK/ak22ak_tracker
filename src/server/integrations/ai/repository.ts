import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import {
  aiAnalysisErrorCodeSchema,
  aiAnalysisJobStatusSchema,
} from "@/domain/ai-analysis";
import {
  planChangeProposalSchema,
  planVersionSchema,
  type PlanChangeProposal,
} from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import {
  planChangeDecisions,
  aiAnalysisJobs,
  githubSyncOutbox,
  planChangeProposals,
  planVersionRollbacks,
  planVersions,
  trackers,
} from "@/server/db/schema";
import {
  createAiAnalysisJobAuditOutbox,
  createPlanChangeProposalAuditOutbox,
} from "@/server/mirror/ai-audit";

import type { PreparedAiAnalysisContext } from "./context";
import type { PlanAdjustmentSafetyLevel } from "./contracts";

type Database = ReturnType<typeof getDatabase>;

export type AiAnalysisJobRecord = {
  id: string;
  trackerId: string;
  trackerKey: string;
  planningTimeZone: string;
  basePlanVersionId: string;
  timelineHeadPlanVersionId: string;
  status: "pending" | "running" | "succeeded" | "failed";
  provider: string;
  model: string;
  attemptCount: number;
  contextVersion: "1";
  contextHash: string;
  contextRevision: number;
  contextFrom: string;
  contextThrough: string;
  safetyLevel: PlanAdjustmentSafetyLevel;
  responseHash: string | null;
  lastErrorCode: ReturnType<typeof aiAnalysisErrorCodeSchema.parse> | null;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  proposal: PlanChangeProposal | null;
  proposalDecision: {
    type: "accepted" | "rejected";
    decidedAt: Date;
    appliedPlanVersion: {
      id: string;
      version: number;
      effectiveFrom: string;
    } | null;
  } | null;
  proposalRollback: {
    targetBasePlan: ReturnType<typeof planVersionSchema.parse>;
    sourceAppliedPlan: ReturnType<typeof planVersionSchema.parse>;
    timelineHeadPlanVersionId: string;
    existing: {
      decidedAt: Date;
      newPlanVersion: ReturnType<typeof planVersionSchema.parse>;
    } | null;
  } | null;
};

export type NewAiAnalysisJob = PreparedAiAnalysisContext & {
  id: string;
  provider: string;
  model: string;
  requestedAt: Date;
};

export type AiAnalysisStore = {
  createJob(input: NewAiAnalysisJob): Promise<AiAnalysisJobRecord>;
  findJob(trackerKey: string, id: string): Promise<AiAnalysisJobRecord | null>;
  findLatestJob(trackerKey: string): Promise<AiAnalysisJobRecord | null>;
  claimJob(input: {
    job: AiAnalysisJobRecord;
    id: string;
    trackerId: string;
    startedAt: Date;
    staleBefore: Date;
  }): Promise<boolean>;
  failJob(input: {
    job: AiAnalysisJobRecord;
    id: string;
    trackerId: string;
    errorCode: ReturnType<typeof aiAnalysisErrorCodeSchema.parse>;
    completedAt: Date;
  }): Promise<void>;
  completeJob(input: {
    job: AiAnalysisJobRecord;
    proposal: PlanChangeProposal;
    model: string;
    responseHash: string;
    completedAt: Date;
  }): Promise<void>;
  expireProposal(input: {
    job: AiAnalysisJobRecord;
    proposalId: string;
    trackerId: string;
  }): Promise<boolean>;
};

function parseSafetyLevel(value: string): PlanAdjustmentSafetyLevel {
  if (value === "green" || value === "yellow" || value === "red") return value;
  throw new Error("ai_analysis_safety_invalid");
}

function rowToJob(row: {
  job: typeof aiAnalysisJobs.$inferSelect;
  proposal: typeof planChangeProposals.$inferSelect | null;
  trackerKey: string;
  planningTimeZone: string;
}): AiAnalysisJobRecord {
  const proposalDocument = row.proposal
    ? planChangeProposalSchema.parse(row.proposal.document)
    : null;
  const proposalStatus = row.proposal?.status;
  if (
    proposalStatus !== undefined &&
    proposalStatus !== "proposed" &&
    proposalStatus !== "accepted" &&
    proposalStatus !== "rejected" &&
    proposalStatus !== "expired"
  ) {
    throw new Error("plan_change_proposal_status_invalid");
  }
  return {
    id: row.job.id,
    trackerId: row.job.trackerId,
    trackerKey: row.trackerKey,
    planningTimeZone: row.planningTimeZone,
    basePlanVersionId: row.job.basePlanVersionId,
    timelineHeadPlanVersionId: row.job.timelineHeadPlanVersionId,
    status: aiAnalysisJobStatusSchema.parse(row.job.status),
    provider: row.job.provider,
    model: row.job.model,
    attemptCount: row.job.attemptCount,
    contextVersion:
      row.job.contextVersion === "1"
        ? "1"
        : (() => {
            throw new Error("ai_analysis_context_version_invalid");
          })(),
    contextHash: row.job.contextHash,
    contextRevision: row.job.contextRevision,
    contextFrom: row.job.contextFrom,
    contextThrough: row.job.contextThrough,
    safetyLevel: parseSafetyLevel(row.job.safetyLevel),
    responseHash: row.job.responseHash,
    lastErrorCode:
      row.job.lastErrorCode === null
        ? null
        : aiAnalysisErrorCodeSchema.parse(row.job.lastErrorCode),
    requestedAt: row.job.requestedAt,
    startedAt: row.job.startedAt,
    completedAt: row.job.completedAt,
    proposal:
      proposalDocument && proposalStatus
        ? { ...proposalDocument, status: proposalStatus }
        : proposalDocument,
    proposalDecision: null,
    proposalRollback: null,
  };
}

export function createNeonAiAnalysisStore(
  database: Database = getDatabase(),
): AiAnalysisStore {
  async function findBy(trackerKey: string, id?: string) {
    const rows = await database
      .select({
        job: aiAnalysisJobs,
        proposal: planChangeProposals,
        trackerKey: trackers.key,
        planningTimeZone: trackers.planningTimeZone,
      })
      .from(aiAnalysisJobs)
      .innerJoin(trackers, eq(aiAnalysisJobs.trackerId, trackers.id))
      .leftJoin(
        planChangeProposals,
        eq(planChangeProposals.analysisJobId, aiAnalysisJobs.id),
      )
      .where(
        id
          ? and(eq(trackers.key, trackerKey), eq(aiAnalysisJobs.id, id))
          : eq(trackers.key, trackerKey),
      )
      .orderBy(desc(aiAnalysisJobs.requestedAt))
      .limit(1);
    if (!rows[0]) return null;
    const job = rowToJob(rows[0]);
    if (!rows[0].proposal?.decidedAt) return job;
    const [decision] = await database
      .select({
        decision: planChangeDecisions.decision,
        decidedAt: planChangeDecisions.decidedAt,
        appliedPlanVersionId: planChangeDecisions.appliedPlanVersionId,
      })
      .from(planChangeDecisions)
      .where(eq(planChangeDecisions.proposalId, rows[0].proposal.id))
      .limit(1);
    if (!decision) return job;
    if (decision.decision !== "accepted" && decision.decision !== "rejected") {
      throw new Error("plan_change_decision_invalid");
    }
    const decisionType: "accepted" | "rejected" = decision.decision;
    const [applied] = decision.appliedPlanVersionId
      ? await database
          .select({
            id: planVersions.id,
            version: planVersions.version,
            effectiveFrom: planVersions.effectiveFrom,
            document: planVersions.document,
          })
          .from(planVersions)
          .where(eq(planVersions.id, decision.appliedPlanVersionId))
          .limit(1)
      : [];
    const [base, head, rollback] =
      decisionType === "accepted" && applied
        ? await Promise.all([
            database
              .select({ document: planVersions.document })
              .from(planVersions)
              .where(eq(planVersions.id, rows[0].proposal!.basePlanVersionId))
              .limit(1),
            database
              .select({ id: planVersions.id })
              .from(planVersions)
              .where(eq(planVersions.trackerId, job.trackerId))
              .orderBy(desc(planVersions.version))
              .limit(1),
            database
              .select({
                decidedAt: planVersionRollbacks.decidedAt,
                newPlanDocument: planVersions.document,
              })
              .from(planVersionRollbacks)
              .innerJoin(
                planVersions,
                eq(planVersionRollbacks.newPlanVersionId, planVersions.id),
              )
              .where(
                eq(planVersionRollbacks.sourceAppliedPlanVersionId, applied.id),
              )
              .limit(1),
          ])
        : [[], [], []];
    return {
      ...job,
      proposalDecision: {
        type: decisionType,
        decidedAt: decision.decidedAt,
        appliedPlanVersion: applied ?? null,
      },
      proposalRollback:
        decisionType === "accepted" && applied && base[0] && head[0]
          ? {
              targetBasePlan: planVersionSchema.parse(base[0].document),
              sourceAppliedPlan: planVersionSchema.parse(applied.document),
              timelineHeadPlanVersionId: head[0].id,
              existing: rollback[0]
                ? {
                    decidedAt: rollback[0].decidedAt,
                    newPlanVersion: planVersionSchema.parse(
                      rollback[0].newPlanDocument,
                    ),
                  }
                : null,
            }
          : null,
    };
  }

  return {
    async createJob(input) {
      const pendingJob: AiAnalysisJobRecord = {
        id: input.id,
        trackerId: input.trackerId,
        trackerKey: input.trackerKey,
        planningTimeZone: input.modelContext.planningTimeZone,
        basePlanVersionId: input.basePlanVersionId,
        timelineHeadPlanVersionId: input.timelineHeadPlanVersionId,
        status: "pending",
        provider: input.provider,
        model: input.model,
        attemptCount: 0,
        contextVersion: input.contextVersion,
        contextHash: input.contextHash,
        contextRevision: input.contextRevision,
        contextFrom: input.contextFrom,
        contextThrough: input.contextThrough,
        safetyLevel: input.safetyLevel,
        responseHash: null,
        lastErrorCode: null,
        requestedAt: input.requestedAt,
        startedAt: null,
        completedAt: null,
        proposal: null,
        proposalDecision: null,
        proposalRollback: null,
      };
      const audit = createAiAnalysisJobAuditOutbox(pendingJob);
      await database.batch([
        database
          .insert(aiAnalysisJobs)
          .values({
            id: input.id,
            trackerId: input.trackerId,
            basePlanVersionId: input.basePlanVersionId,
            timelineHeadPlanVersionId: input.timelineHeadPlanVersionId,
            status: "pending",
            provider: input.provider,
            model: input.model,
            contextVersion: input.contextVersion,
            contextHash: input.contextHash,
            contextRevision: input.contextRevision,
            contextFrom: input.contextFrom,
            contextThrough: input.contextThrough,
            safetyLevel: input.safetyLevel,
            requestedAt: input.requestedAt,
          })
          .onConflictDoNothing({ target: aiAnalysisJobs.id }),
        database
          .insert(githubSyncOutbox)
          .values({
            ...audit,
            nextAttemptAt: input.requestedAt,
            createdAt: input.requestedAt,
            updatedAt: input.requestedAt,
          })
          .onConflictDoNothing({
            target: [
              githubSyncOutbox.aggregateType,
              githubSyncOutbox.aggregateId,
            ],
          }),
      ]);
      const job = await findBy(input.trackerKey, input.id);
      if (!job || job.trackerId !== input.trackerId) {
        throw new Error("ai_analysis_job_conflict");
      }
      return job;
    },
    findJob: (trackerKey, id) => findBy(trackerKey, id),
    findLatestJob: (trackerKey) => findBy(trackerKey),
    async claimJob(input) {
      const audit = createAiAnalysisJobAuditOutbox(input.job, {
        status: "running",
        attemptCount: input.job.attemptCount + 1,
        startedAt: input.startedAt,
        completedAt: null,
        lastErrorCode: null,
      });
      const result = await database.execute<{ id: string }>(sql`
        with claimed as (
          update ai_analysis_jobs
          set status = 'running',
              started_at = ${input.startedAt},
              completed_at = null,
              last_error_code = null,
              attempt_count = attempt_count + 1,
              updated_at = ${input.startedAt}
          where id = ${input.id}::uuid
            and tracker_id = ${input.trackerId}::uuid
            and (
              status in ('pending', 'failed')
              or (status = 'running' and started_at < ${input.staleBefore})
            )
          returning id
        ), mirrored as (
          insert into github_sync_outbox (
            aggregate_type, aggregate_id, target_path, payload, status,
            attempts, next_attempt_at, lease_owner, lease_expires_at,
            last_error_code, created_at, updated_at
          )
          select
            ${audit.aggregateType}, ${audit.aggregateId}::uuid,
            ${audit.targetPath}, ${JSON.stringify(audit.payload)}::jsonb,
            'pending', 0, ${input.startedAt}, null, null, null,
            ${input.startedAt}, ${input.startedAt}
          from claimed
          on conflict (aggregate_type, aggregate_id) do update set
            target_path = excluded.target_path,
            payload = excluded.payload,
            status = 'pending', attempts = 0,
            next_attempt_at = excluded.next_attempt_at,
            lease_owner = null, lease_expires_at = null,
            last_error_code = null, updated_at = excluded.updated_at
          returning aggregate_id
        )
        select id from claimed
      `);
      return result.rows.length === 1;
    },
    async failJob(input) {
      const audit = createAiAnalysisJobAuditOutbox(input.job, {
        status: "failed",
        lastErrorCode: input.errorCode,
        completedAt: input.completedAt,
      });
      await database.execute(sql`
        with failed as (
          update ai_analysis_jobs
          set status = 'failed',
              last_error_code = ${input.errorCode},
              completed_at = ${input.completedAt},
              updated_at = ${input.completedAt}
          where id = ${input.id}::uuid
            and tracker_id = ${input.trackerId}::uuid
            and status = 'running'
          returning id
        )
        insert into github_sync_outbox (
          aggregate_type, aggregate_id, target_path, payload, status,
          attempts, next_attempt_at, lease_owner, lease_expires_at,
          last_error_code, created_at, updated_at
        )
        select
          ${audit.aggregateType}, ${audit.aggregateId}::uuid,
          ${audit.targetPath}, ${JSON.stringify(audit.payload)}::jsonb,
          'pending', 0, ${input.completedAt}, null, null, null,
          ${input.completedAt}, ${input.completedAt}
        from failed
        on conflict (aggregate_type, aggregate_id) do update set
          target_path = excluded.target_path,
          payload = excluded.payload,
          status = 'pending', attempts = 0,
          next_attempt_at = excluded.next_attempt_at,
          lease_owner = null, lease_expires_at = null,
          last_error_code = null, updated_at = excluded.updated_at
      `);
    },
    async completeJob(input) {
      const succeededJobAudit = createAiAnalysisJobAuditOutbox(input.job, {
        status: "succeeded",
        model: input.model,
        responseHash: input.responseHash,
        lastErrorCode: null,
        completedAt: input.completedAt,
        proposal: input.proposal,
      });
      const proposalAudit = createPlanChangeProposalAuditOutbox({
        source: {
          trackerKey: input.job.trackerKey,
          analysisJobId: input.job.id,
          model: input.model,
          contextVersion: input.job.contextVersion,
          contextHash: input.job.contextHash,
          contextRevision: input.job.contextRevision,
          contextFrom: input.job.contextFrom,
          contextThrough: input.job.contextThrough,
          timelineHeadPlanVersionId: input.job.timelineHeadPlanVersionId,
          proposal: input.proposal,
        },
      });
      await database.execute(sql`
        with completed as (
          update ai_analysis_jobs
          set status = 'succeeded',
              model = ${input.model},
              response_hash = ${input.responseHash},
              last_error_code = null,
              completed_at = ${input.completedAt},
              updated_at = ${input.completedAt}
          where id = ${input.job.id}::uuid
            and tracker_id = ${input.job.trackerId}::uuid
            and status = 'running'
          returning id
        ), proposal as (
          insert into plan_change_proposals (
            id, tracker_id, base_plan_version_id, analysis_job_id,
            timeline_head_plan_version_id, status, safety_level, model,
            context_version, context_hash, context_revision,
            context_from, context_through, document, created_at
          )
          select
            ${input.proposal.id}::uuid, ${input.job.trackerId}::uuid,
            ${input.job.basePlanVersionId}::uuid, ${input.job.id}::uuid,
            ${input.job.timelineHeadPlanVersionId}::uuid,
            ${input.proposal.status}, ${input.proposal.safetyLevel},
            ${input.model}, ${input.job.contextVersion},
            ${input.job.contextHash}, ${input.job.contextRevision},
            ${input.job.contextFrom}::date, ${input.job.contextThrough}::date,
            ${JSON.stringify(input.proposal)}::jsonb,
            ${new Date(input.proposal.createdAt)}
          from completed
          on conflict (analysis_job_id) do nothing
          returning id
        ), job_mirror as (
          insert into github_sync_outbox (
            aggregate_type, aggregate_id, target_path, payload, status,
            attempts, next_attempt_at, lease_owner, lease_expires_at,
            last_error_code, created_at, updated_at
          )
          select
            ${succeededJobAudit.aggregateType},
            ${succeededJobAudit.aggregateId}::uuid,
            ${succeededJobAudit.targetPath},
            ${JSON.stringify(succeededJobAudit.payload)}::jsonb,
            'pending', 0, ${input.completedAt}, null, null, null,
            ${input.completedAt}, ${input.completedAt}
          from completed
          on conflict (aggregate_type, aggregate_id) do update set
            target_path = excluded.target_path,
            payload = excluded.payload,
            status = 'pending', attempts = 0,
            next_attempt_at = excluded.next_attempt_at,
            lease_owner = null, lease_expires_at = null,
            last_error_code = null, updated_at = excluded.updated_at
          returning aggregate_id
        )
        insert into github_sync_outbox (
          aggregate_type, aggregate_id, target_path, payload, status,
          attempts, next_attempt_at, lease_owner, lease_expires_at,
          last_error_code, created_at, updated_at
        )
        select
          ${proposalAudit.aggregateType}, ${proposalAudit.aggregateId}::uuid,
          ${proposalAudit.targetPath},
          ${JSON.stringify(proposalAudit.payload)}::jsonb,
          'pending', 0, ${input.completedAt}, null, null, null,
          ${input.completedAt}, ${input.completedAt}
        from proposal
        on conflict (aggregate_type, aggregate_id) do update set
          target_path = excluded.target_path,
          payload = excluded.payload,
          status = 'pending', attempts = 0,
          next_attempt_at = excluded.next_attempt_at,
          lease_owner = null, lease_expires_at = null,
          last_error_code = null, updated_at = excluded.updated_at
      `);
    },
    async expireProposal(input) {
      if (!input.job.proposal) return false;
      const proposal = {
        ...input.job.proposal,
        status: "expired" as const,
      };
      const audit = createPlanChangeProposalAuditOutbox({
        source: {
          trackerKey: input.job.trackerKey,
          analysisJobId: input.job.id,
          model: input.job.model,
          contextVersion: input.job.contextVersion,
          contextHash: input.job.contextHash,
          contextRevision: input.job.contextRevision,
          contextFrom: input.job.contextFrom,
          contextThrough: input.job.contextThrough,
          timelineHeadPlanVersionId: input.job.timelineHeadPlanVersionId,
          proposal,
        },
      });
      const updatedAt = new Date();
      const result = await database.execute<{ id: string }>(sql`
        with expired as (
          update plan_change_proposals
          set status = 'expired'
          where id = ${input.proposalId}::uuid
            and tracker_id = ${input.trackerId}::uuid
            and status = 'proposed'
          returning id
        ), mirrored as (
          insert into github_sync_outbox (
            aggregate_type, aggregate_id, target_path, payload, status,
            attempts, next_attempt_at, lease_owner, lease_expires_at,
            last_error_code, created_at, updated_at
          )
          select
            ${audit.aggregateType}, ${audit.aggregateId}::uuid,
            ${audit.targetPath}, ${JSON.stringify(audit.payload)}::jsonb,
            'pending', 0, ${updatedAt}, null, null, null,
            ${updatedAt}, ${updatedAt}
          from expired
          on conflict (aggregate_type, aggregate_id) do update set
            target_path = excluded.target_path,
            payload = excluded.payload,
            status = 'pending', attempts = 0,
            next_attempt_at = excluded.next_attempt_at,
            lease_owner = null, lease_expires_at = null,
            last_error_code = null, updated_at = excluded.updated_at
          returning aggregate_id
        )
        select id from expired
      `);
      return result.rows.length === 1;
    },
  };
}
