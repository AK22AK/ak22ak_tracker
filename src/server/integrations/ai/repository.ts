import "server-only";

import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";

import {
  aiAnalysisErrorCodeSchema,
  aiAnalysisJobStatusSchema,
} from "@/domain/ai-analysis";
import {
  planChangeProposalSchema,
  type PlanChangeProposal,
} from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import {
  aiAnalysisJobs,
  planChangeProposals,
  trackers,
} from "@/server/db/schema";

import type { PreparedAiAnalysisContext } from "./context";
import type { PlanAdjustmentSafetyLevel } from "./contracts";

type Database = ReturnType<typeof getDatabase>;

export type AiAnalysisJobRecord = {
  id: string;
  trackerId: string;
  trackerKey: string;
  basePlanVersionId: string;
  timelineHeadPlanVersionId: string;
  status: "pending" | "running" | "succeeded" | "failed";
  model: string;
  attemptCount: number;
  contextVersion: "1";
  contextHash: string;
  contextFrom: string;
  contextThrough: string;
  safetyLevel: PlanAdjustmentSafetyLevel;
  responseHash: string | null;
  lastErrorCode: ReturnType<typeof aiAnalysisErrorCodeSchema.parse> | null;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  proposal: PlanChangeProposal | null;
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
    id: string;
    trackerId: string;
    startedAt: Date;
    staleBefore: Date;
  }): Promise<boolean>;
  failJob(input: {
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
}): AiAnalysisJobRecord {
  const proposalDocument = row.proposal
    ? planChangeProposalSchema.parse(row.proposal.document)
    : null;
  return {
    id: row.job.id,
    trackerId: row.job.trackerId,
    trackerKey: row.trackerKey,
    basePlanVersionId: row.job.basePlanVersionId,
    timelineHeadPlanVersionId: row.job.timelineHeadPlanVersionId,
    status: aiAnalysisJobStatusSchema.parse(row.job.status),
    model: row.job.model,
    attemptCount: row.job.attemptCount,
    contextVersion:
      row.job.contextVersion === "1"
        ? "1"
        : (() => {
            throw new Error("ai_analysis_context_version_invalid");
          })(),
    contextHash: row.job.contextHash,
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
      proposalDocument && row.proposal?.status === "expired"
        ? { ...proposalDocument, status: "expired" }
        : proposalDocument,
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
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  return {
    async createJob(input) {
      await database
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
          contextFrom: input.contextFrom,
          contextThrough: input.contextThrough,
          safetyLevel: input.safetyLevel,
          requestedAt: input.requestedAt,
        })
        .onConflictDoNothing({ target: aiAnalysisJobs.id });
      const job = await findBy(input.trackerKey, input.id);
      if (!job || job.trackerId !== input.trackerId) {
        throw new Error("ai_analysis_job_conflict");
      }
      return job;
    },
    findJob: (trackerKey, id) => findBy(trackerKey, id),
    findLatestJob: (trackerKey) => findBy(trackerKey),
    async claimJob(input) {
      const rows = await database
        .update(aiAnalysisJobs)
        .set({
          status: "running",
          startedAt: input.startedAt,
          completedAt: null,
          lastErrorCode: null,
          attemptCount: sql`${aiAnalysisJobs.attemptCount} + 1`,
          updatedAt: input.startedAt,
        })
        .where(
          and(
            eq(aiAnalysisJobs.id, input.id),
            eq(aiAnalysisJobs.trackerId, input.trackerId),
            or(
              inArray(aiAnalysisJobs.status, ["pending", "failed"]),
              and(
                eq(aiAnalysisJobs.status, "running"),
                lt(aiAnalysisJobs.startedAt, input.staleBefore),
              ),
            ),
          ),
        )
        .returning({ id: aiAnalysisJobs.id });
      return rows.length === 1;
    },
    async failJob(input) {
      await database
        .update(aiAnalysisJobs)
        .set({
          status: "failed",
          lastErrorCode: input.errorCode,
          completedAt: input.completedAt,
          updatedAt: input.completedAt,
        })
        .where(
          and(
            eq(aiAnalysisJobs.id, input.id),
            eq(aiAnalysisJobs.trackerId, input.trackerId),
            eq(aiAnalysisJobs.status, "running"),
          ),
        );
    },
    async completeJob(input) {
      await database.batch([
        database
          .insert(planChangeProposals)
          .values({
            id: input.proposal.id,
            trackerId: input.job.trackerId,
            basePlanVersionId: input.job.basePlanVersionId,
            analysisJobId: input.job.id,
            timelineHeadPlanVersionId: input.job.timelineHeadPlanVersionId,
            status: input.proposal.status,
            safetyLevel: input.proposal.safetyLevel,
            model: input.model,
            contextVersion: input.job.contextVersion,
            contextHash: input.job.contextHash,
            contextFrom: input.job.contextFrom,
            contextThrough: input.job.contextThrough,
            document: input.proposal,
            createdAt: new Date(input.proposal.createdAt),
          })
          .onConflictDoNothing({ target: planChangeProposals.analysisJobId }),
        database
          .update(aiAnalysisJobs)
          .set({
            status: "succeeded",
            model: input.model,
            responseHash: input.responseHash,
            lastErrorCode: null,
            completedAt: input.completedAt,
            updatedAt: input.completedAt,
          })
          .where(
            and(
              eq(aiAnalysisJobs.id, input.job.id),
              eq(aiAnalysisJobs.trackerId, input.job.trackerId),
              eq(aiAnalysisJobs.status, "running"),
            ),
          ),
      ]);
    },
    async expireProposal(input) {
      const rows = await database
        .update(planChangeProposals)
        .set({ status: "expired" })
        .where(
          and(
            eq(planChangeProposals.id, input.proposalId),
            eq(planChangeProposals.trackerId, input.trackerId),
            eq(planChangeProposals.status, "proposed"),
          ),
        )
        .returning({ id: planChangeProposals.id });
      return rows.length === 1;
    },
  };
}
