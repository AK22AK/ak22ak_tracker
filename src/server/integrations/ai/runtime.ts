import "server-only";

import {
  aiAnalysisJobDtoSchema,
  aiAnalysisContextPreviewSchema,
  aiAnalysisPageDtoSchema,
  type AiConfigurationStatus,
  type AiAnalysisErrorCode,
  type AiAnalysisPageDto,
} from "@/domain/ai-analysis";
import {
  defaultDeepSeekModel,
  type DeepSeekModel,
} from "@/domain/deepseek-model";
import { applyAcceptedPlanChange } from "@/domain/plan-change";
import { localDateInTimeZone } from "@/domain/planning-time";
import { planChangeProposalSchema, schemaVersion } from "@/domain/schemas";
import { rollbackAffectedDates } from "@/server/commands/plan-version-rollback-core";

import type { DeepSeekConfiguration } from "./config";
import { deepSeekCredentialRuntime } from "./credential-runtime";
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
    (job.sourceAssistantTurnId ?? null) ===
      (context.sourceAssistantTurnId ?? null) &&
    job.safetyLevel === context.safetyLevel
  );
}

async function expireProposal(
  job: AiAnalysisJobRecord,
  store: AiAnalysisStore,
) {
  if (!job.proposal || job.proposal.status === "expired") return job;
  await store.expireProposal({
    job,
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
    sourceAssistantTurnId?: string | null,
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
    const context = await prepareContext(
      job.trackerKey,
      currentTime,
      job.sourceAssistantTurnId,
    );
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

function proposalRollback(job: AiAnalysisJobRecord, currentTime: Date) {
  const rollback = job.proposalRollback;
  if (!rollback) return null;
  const effectiveFrom = nextLocalDate(
    localDateInTimeZone(currentTime.toISOString(), job.planningTimeZone),
  );
  const existing = rollback.existing;
  const available =
    rollback.timelineHeadPlanVersionId === rollback.sourceAppliedPlan.id;
  const targetPlan = existing?.newPlanVersion ?? rollback.targetBasePlan;
  return {
    status: existing ? "rolled_back" : available ? "available" : "blocked",
    blockedReason: existing || available ? null : "later_plan_version",
    targetBasePlanVersion: {
      id: rollback.targetBasePlan.id,
      version: rollback.targetBasePlan.version,
    },
    sourceAppliedPlanVersion: {
      id: rollback.sourceAppliedPlan.id,
      version: rollback.sourceAppliedPlan.version,
      effectiveFrom: rollback.sourceAppliedPlan.effectiveFrom,
    },
    newPlanVersion: existing
      ? {
          id: existing.newPlanVersion.id,
          version: existing.newPlanVersion.version,
          effectiveFrom: existing.newPlanVersion.effectiveFrom,
        }
      : null,
    effectiveFrom: existing?.newPlanVersion.effectiveFrom ?? effectiveFrom,
    affectedDates: rollbackAffectedDates(
      rollback.sourceAppliedPlan,
      targetPlan,
      existing?.newPlanVersion.effectiveFrom ?? effectiveFrom,
    ),
    decidedAt: existing?.decidedAt.toISOString() ?? null,
  } as const;
}

function pageDto(
  configuration: AiConfigurationStatus,
  selectedModel: DeepSeekModel,
  job: AiAnalysisJobRecord | null,
  currentTime: Date,
  context: PreparedAiAnalysisContext | null = null,
): AiAnalysisPageDto {
  return aiAnalysisPageDtoSchema.parse({
    schemaVersion,
    configuration,
    selectedModel,
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
                rollback: proposalRollback(job, currentTime),
              }
            : null,
        })
      : null,
  });
}

export function createAiAnalysisRuntime({
  store = createNeonAiAnalysisStore(),
  prepareContext = (
    trackerKey: string,
    now: Date,
    sourceAssistantTurnId?: string | null,
  ) => prepareAiAnalysisContext({ trackerKey, now, sourceAssistantTurnId }),
  readConfiguration = (trackerKey: string) =>
    deepSeekCredentialRuntime.resolveConfiguration(trackerKey),
  createAdvisor = createDeepSeekPlanAdvisor,
  recordCredentialFailure = (input: {
    trackerKey: string;
    errorCode: AiAnalysisErrorCode;
    failedAt: Date;
  }) => deepSeekCredentialRuntime.recordFailure(input),
  recordCredentialSuccess = (input: {
    trackerKey: string;
    succeededAt: Date;
  }) => deepSeekCredentialRuntime.recordSuccess(input),
  now = () => new Date(),
}: {
  store?: AiAnalysisStore;
  prepareContext?: (
    trackerKey: string,
    now: Date,
    sourceAssistantTurnId?: string | null,
  ) => Promise<PreparedAiAnalysisContext>;
  readConfiguration?: (trackerKey: string) =>
    | Promise<
        | { status: "configured"; value: DeepSeekConfiguration }
        | {
            status: Exclude<AiConfigurationStatus, "configured">;
            model?: DeepSeekModel;
          }
      >
    | {
        status: "configured";
        value: DeepSeekConfiguration;
      }
    | {
        status: Exclude<AiConfigurationStatus, "configured">;
        model?: DeepSeekModel;
      };
  createAdvisor?: (configuration: DeepSeekConfiguration) => PlanAdvisor;
  recordCredentialFailure?: (input: {
    trackerKey: string;
    errorCode: AiAnalysisErrorCode;
    failedAt: Date;
  }) => Promise<void>;
  recordCredentialSuccess?: (input: {
    trackerKey: string;
    succeededAt: Date;
  }) => Promise<void>;
  now?: () => Date;
} = {}) {
  async function preview(
    trackerKey: string,
    sourceAssistantTurnId?: string | null,
  ) {
    const context = await prepareContext(
      trackerKey,
      now(),
      sourceAssistantTurnId,
    );
    const evidence = context.modelContext.observedTrainingEvidence ?? [];
    const coverage = context.modelContext.evidenceCoverage ?? [];
    const coverageSummary = (
      key: "garminActivity" | "garminWellness" | "xunjiTraining",
    ) => ({
      records: coverage.filter((item) => item[key] === "records").length,
      empty: coverage.filter((item) => item[key] === "empty").length,
      failed: coverage.filter((item) => item[key] === "failed").length,
      unknown: coverage.filter((item) => item[key] === "unknown").length,
    });
    return aiAnalysisContextPreviewSchema.parse({
      schemaVersion,
      previewHash: context.contextHash,
      range: { from: context.contextFrom, through: context.contextThrough },
      plan: {
        version: context.basePlan.version,
        effectiveFrom: context.basePlan.effectiveFrom,
        taskCount: context.basePlan.tasks.length,
      },
      feedback: {
        count: context.modelContext.recentFeedback.length,
        days: new Set(
          context.modelContext.recentFeedback.map((item) => item.localDate),
        ).size,
        observations: context.modelContext.recentFeedback.flatMap((item) =>
          item.userObservation
            ? [{ localDate: item.localDate, text: item.userObservation }]
            : [],
        ),
      },
      confirmedTrainingCount: context.modelContext.confirmedTraining.length,
      externalTraining: {
        garminActivities: evidence.filter((item) => item.provider === "garmin")
          .length,
        xunjiTrainings: evidence.filter((item) => item.provider === "xunji")
          .length,
        unconfirmed: evidence.filter(
          (item) => item.relation.status === "observed_unconfirmed",
        ).length,
        overlapGroups: new Set(
          evidence.flatMap((item) =>
            item.overlap.group ? [item.overlap.group] : [],
          ),
        ).size,
      },
      recovery: {
        sleepDays: context.modelContext.recoveryEvidence.filter(
          (item) => item.sleepStatus === "available",
        ).length,
        stepsDays: context.modelContext.recoveryEvidence.filter(
          (item) => item.stepsStatus === "available",
        ).length,
      },
      assistantContext: {
        rehabProfileVersion: context.modelContext.rehabProfile?.version ?? null,
        memoryCount: context.modelContext.assistantMemories?.length ?? 0,
        sourceConversationIncluded:
          context.modelContext.sourceConversation !== null &&
          context.modelContext.sourceConversation !== undefined,
      },
      coverage: {
        garminActivity: coverageSummary("garminActivity"),
        garminWellness: coverageSummary("garminWellness"),
        xunjiTraining: coverageSummary("xunjiTraining"),
      },
      safetyLevel: context.safetyLevel,
    });
  }

  async function load(trackerKey: string, jobId?: string) {
    const [configuration, found] = await Promise.all([
      readConfiguration(trackerKey),
      jobId
        ? store.findJob(trackerKey, jobId)
        : store.findLatestJob(trackerKey),
    ]);
    const currentTime = now();
    const current = found
      ? await ensureCurrentProposal(found, store, prepareContext, currentTime)
      : { job: null, context: null };
    return pageDto(
      configuration.status,
      configuration.status === "configured"
        ? configuration.value.model
        : (configuration.model ?? defaultDeepSeekModel),
      current.job,
      currentTime,
      current.context,
    );
  }

  async function request(input: {
    trackerKey: string;
    commandId: string;
    previewHash?: string;
    sourceAssistantTurnId?: string | null;
  }) {
    const requestedAt = now();
    const configuration = await readConfiguration(input.trackerKey);
    const context = await prepareContext(
      input.trackerKey,
      requestedAt,
      input.sourceAssistantTurnId,
    );
    if (
      input.previewHash !== undefined &&
      input.previewHash !== context.contextHash
    ) {
      throw new AiAnalysisPreviewChangedError();
    }
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
        configuration.status === "configured"
          ? configuration.value.model
          : (configuration.model ?? defaultDeepSeekModel),
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
      job,
      id: job.id,
      trackerId: job.trackerId,
      startedAt: requestedAt,
      staleBefore: new Date(requestedAt.valueOf() - runningLeaseMs),
    });
    if (!claimed) return load(input.trackerKey, job.id);
    const runningJob: AiAnalysisJobRecord = {
      ...job,
      status: "running",
      attemptCount: job.attemptCount + 1,
      startedAt: requestedAt,
      completedAt: null,
      lastErrorCode: null,
    };

    if (contextChanged) {
      await store.failJob({
        job: runningJob,
        id: job.id,
        trackerId: job.trackerId,
        errorCode: "context_changed",
        completedAt: now(),
      });
      return load(input.trackerKey, job.id);
    }

    if (configuration.status !== "configured") {
      await store.failJob({
        job: runningJob,
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
        job: runningJob,
        proposal,
        model: result.model,
        responseHash: result.responseHash,
        completedAt,
      });
      await recordCredentialSuccess({
        trackerKey: input.trackerKey,
        succeededAt: completedAt,
      }).catch(() => undefined);
    } catch (error) {
      const errorCode =
        error instanceof PlanAdvisorError
          ? error.code
          : ("provider_unavailable" as const);
      await store.failJob({
        job: runningJob,
        id: job.id,
        trackerId: job.trackerId,
        errorCode,
        completedAt: now(),
      });
      await recordCredentialFailure({
        trackerKey: input.trackerKey,
        errorCode,
        failedAt: now(),
      }).catch(() => undefined);
    }
    return load(input.trackerKey, job.id);
  }

  return { load, preview, request };
}

export class AiAnalysisPreviewChangedError extends Error {
  constructor() {
    super("analysis_context_changed");
    this.name = "AiAnalysisPreviewChangedError";
  }
}

export const aiAnalysisRuntime = {
  load(trackerKey: string, jobId?: string) {
    return createAiAnalysisRuntime().load(trackerKey, jobId);
  },
  preview(trackerKey: string, sourceAssistantTurnId?: string | null) {
    return createAiAnalysisRuntime().preview(trackerKey, sourceAssistantTurnId);
  },
  request(input: {
    trackerKey: string;
    commandId: string;
    previewHash: string;
    sourceAssistantTurnId?: string | null;
  }) {
    return createAiAnalysisRuntime().request(input);
  },
};
