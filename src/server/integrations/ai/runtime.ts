import "server-only";

import {
  aiAnalysisJobDtoSchema,
  aiAnalysisPageDtoSchema,
  type AiAnalysisErrorCode,
  type AiAnalysisPageDto,
} from "@/domain/ai-analysis";
import { applyAcceptedPlanChange } from "@/domain/plan-change";
import { planChangeProposalSchema, schemaVersion } from "@/domain/schemas";

import { readDeepSeekConfiguration } from "./config";
import {
  prepareAiAnalysisContext,
  type PreparedAiAnalysisContext,
} from "./context";
import type { PlanAdvisor } from "./contracts";
import { createDeepSeekPlanAdvisor } from "./deepseek";
import { PlanAdvisorError } from "./errors";
import {
  createNeonAiAnalysisStore,
  type AiAnalysisJobRecord,
  type AiAnalysisStore,
} from "./repository";

const runningLeaseMs = 60_000;

function retryableError(code: AiAnalysisErrorCode | null) {
  return (
    code !== null &&
    ![
      "not_configured",
      "invalid_configuration",
      "authentication",
      "insufficient_balance",
      "context_changed",
    ].includes(code)
  );
}

function contextMatchesJob(
  job: AiAnalysisJobRecord,
  context: PreparedAiAnalysisContext,
) {
  return (
    job.contextVersion === context.contextVersion &&
    job.contextHash === context.contextHash &&
    job.contextRevision === context.contextRevision &&
    job.basePlanVersionId === context.basePlanVersionId &&
    job.timelineHeadPlanVersionId === context.timelineHeadPlanVersionId &&
    job.safetyLevel === context.safetyLevel
  );
}

async function expireProposal(
  job: AiAnalysisJobRecord,
  store: AiAnalysisStore,
) {
  if (!job.proposal || job.proposal.status === "expired") return job;
  await store.expireProposal({
    proposalId: job.proposal.id,
    trackerId: job.trackerId,
  });
  return {
    ...job,
    proposal: { ...job.proposal, status: "expired" as const },
  };
}

async function ensureCurrentProposal(
  job: AiAnalysisJobRecord,
  store: AiAnalysisStore,
  prepareContext: (
    trackerKey: string,
    now: Date,
  ) => Promise<PreparedAiAnalysisContext>,
  currentTime: Date,
) {
  if (
    job.status !== "succeeded" ||
    !job.proposal ||
    job.proposal.status !== "proposed"
  ) {
    return { job, context: null };
  }
  try {
    const context = await prepareContext(job.trackerKey, currentTime);
    return contextMatchesJob(job, context)
      ? { job, context }
      : { job: await expireProposal(job, store), context: null };
  } catch {
    return { job: await expireProposal(job, store), context: null };
  }
}

function nextLocalDate(localDate: string) {
  const value = new Date(`${localDate}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function proposalApplication(
  job: AiAnalysisJobRecord,
  context: PreparedAiAnalysisContext | null,
) {
  const proposal = job.proposal;
  if (
    !proposal ||
    proposal.status === "accepted" ||
    proposal.status === "rejected"
  ) {
    return {
      effectiveFrom:
        job.proposalDecision?.appliedPlanVersion?.effectiveFrom ?? null,
      canAccept: false,
      blockedReason: null,
    } as const;
  }
  if (proposal.status === "expired" || !context) {
    return {
      effectiveFrom: null,
      canAccept: false,
      blockedReason: "context_changed" as const,
    };
  }
  const effectiveFrom = nextLocalDate(context.contextThrough);
  if (proposal.safetyLevel === "red") {
    return {
      effectiveFrom,
      canAccept: false,
      blockedReason: "red_safety" as const,
    };
  }
  if (proposal.operations.length === 0) {
    return {
      effectiveFrom,
      canAccept: false,
      blockedReason: "no_operations" as const,
    };
  }
  if (context.basePlanVersionId !== context.timelineHeadPlanVersionId) {
    return {
      effectiveFrom,
      canAccept: false,
      blockedReason: "future_timeline" as const,
    };
  }
  try {
    applyAcceptedPlanChange(
      context.basePlan,
      { ...proposal, status: "accepted" },
      {
        id: proposal.id,
        version: context.timelineHeadPlan.version + 1,
        effectiveFrom,
        createdAt: currentIsoForValidation(job),
      },
    );
    return { effectiveFrom, canAccept: true, blockedReason: null };
  } catch {
    return {
      effectiveFrom,
      canAccept: false,
      blockedReason: "invalid_operations" as const,
    };
  }
}

function currentIsoForValidation(job: AiAnalysisJobRecord) {
  return (job.completedAt ?? job.requestedAt).toISOString();
}

function pageDto(
  configuration: ReturnType<typeof readDeepSeekConfiguration>["status"],
  job: AiAnalysisJobRecord | null,
  currentTime: Date,
  context: PreparedAiAnalysisContext | null = null,
): AiAnalysisPageDto {
  return aiAnalysisPageDtoSchema.parse({
    schemaVersion,
    configuration,
    job: job
      ? aiAnalysisJobDtoSchema.parse({
          id: job.id,
          trackerKey: job.trackerKey,
          status: job.status,
          errorCode: job.lastErrorCode,
          retryable:
            retryableError(job.lastErrorCode) ||
            (job.status === "running" &&
              currentTime.valueOf() -
                (job.startedAt ?? job.requestedAt).valueOf() >=
                runningLeaseMs),
          requestedAt: job.requestedAt.toISOString(),
          completedAt: job.completedAt?.toISOString() ?? null,
          proposal: job.proposal
            ? {
                id: job.proposal.id,
                basePlanVersionId: job.proposal.basePlanVersionId,
                createdAt: job.proposal.createdAt,
                safetyLevel: job.proposal.safetyLevel,
                summary: job.proposal.summary,
                operations: job.proposal.operations,
                status: job.proposal.status,
                application: proposalApplication(job, context),
                decision: job.proposalDecision
                  ? {
                      type: job.proposalDecision.type,
                      decidedAt: job.proposalDecision.decidedAt.toISOString(),
                      appliedPlanVersion:
                        job.proposalDecision.appliedPlanVersion,
                    }
                  : null,
              }
            : null,
        })
      : null,
  });
}

export function createAiAnalysisRuntime({
  store = createNeonAiAnalysisStore(),
  prepareContext = (trackerKey: string, now: Date) =>
    prepareAiAnalysisContext({ trackerKey, now }),
  readConfiguration = readDeepSeekConfiguration,
  createAdvisor = createDeepSeekPlanAdvisor,
  now = () => new Date(),
}: {
  store?: AiAnalysisStore;
  prepareContext?: (
    trackerKey: string,
    now: Date,
  ) => Promise<PreparedAiAnalysisContext>;
  readConfiguration?: typeof readDeepSeekConfiguration;
  createAdvisor?: (
    configuration: Extract<
      ReturnType<typeof readDeepSeekConfiguration>,
      { status: "configured" }
    >["value"],
  ) => PlanAdvisor;
  now?: () => Date;
} = {}) {
  async function load(trackerKey: string, jobId?: string) {
    const configuration = readConfiguration();
    const found = jobId
      ? await store.findJob(trackerKey, jobId)
      : await store.findLatestJob(trackerKey);
    const currentTime = now();
    const current = found
      ? await ensureCurrentProposal(found, store, prepareContext, currentTime)
      : { job: null, context: null };
    return pageDto(
      configuration.status,
      current.job,
      currentTime,
      current.context,
    );
  }

  async function request(input: { trackerKey: string; commandId: string }) {
    const requestedAt = now();
    const configuration = readConfiguration();
    const context = await prepareContext(input.trackerKey, requestedAt);
    const job = await store.createJob({
      ...context,
      id: input.commandId,
      provider: "deepseek",
      model:
        configuration.status === "configured"
          ? configuration.value.model
          : "unconfigured",
      requestedAt,
    });
    if (job.status === "succeeded") {
      const current = contextMatchesJob(job, context);
      return pageDto(
        configuration.status,
        current ? job : await expireProposal(job, store),
        now(),
        current ? context : null,
      );
    }
    const contextChanged =
      job.contextHash !== context.contextHash ||
      job.basePlanVersionId !== context.basePlanVersionId ||
      job.timelineHeadPlanVersionId !== context.timelineHeadPlanVersionId;
    const claimed = await store.claimJob({
      id: job.id,
      trackerId: job.trackerId,
      startedAt: requestedAt,
      staleBefore: new Date(requestedAt.valueOf() - runningLeaseMs),
    });
    if (!claimed) return load(input.trackerKey, job.id);

    if (contextChanged) {
      await store.failJob({
        id: job.id,
        trackerId: job.trackerId,
        errorCode: "context_changed",
        completedAt: now(),
      });
      return load(input.trackerKey, job.id);
    }

    if (configuration.status !== "configured") {
      await store.failJob({
        id: job.id,
        trackerId: job.trackerId,
        errorCode: configuration.status,
        completedAt: now(),
      });
      return load(input.trackerKey, job.id);
    }

    try {
      const advisor = createAdvisor(configuration.value);
      const result = await advisor.proposeAdjustment(context.modelContext);
      const completedAt = now();
      const proposal = planChangeProposalSchema.parse({
        schemaVersion,
        id: job.id,
        trackerKey: job.trackerKey,
        basePlanVersionId: job.basePlanVersionId,
        createdAt: completedAt.toISOString(),
        safetyLevel: result.safetyLevel,
        summary: result.summary,
        operations: result.operations,
        status: "proposed",
      });
      await store.completeJob({
        job,
        proposal,
        model: result.model,
        responseHash: result.responseHash,
        completedAt,
      });
    } catch (error) {
      const errorCode =
        error instanceof PlanAdvisorError
          ? error.code
          : ("provider_unavailable" as const);
      await store.failJob({
        id: job.id,
        trackerId: job.trackerId,
        errorCode,
        completedAt: now(),
      });
    }
    return load(input.trackerKey, job.id);
  }

  return { load, request };
}

export const aiAnalysisRuntime = {
  load(trackerKey: string, jobId?: string) {
    return createAiAnalysisRuntime().load(trackerKey, jobId);
  },
  request(input: { trackerKey: string; commandId: string }) {
    return createAiAnalysisRuntime().request(input);
  },
};
