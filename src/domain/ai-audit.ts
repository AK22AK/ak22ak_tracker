import { z } from "zod";

import {
  aiAnalysisErrorCodeSchema,
  aiAnalysisJobStatusSchema,
} from "./ai-analysis";
import {
  instantSchema,
  localDateSchema,
  planChangeOperationSchema,
  planChangeProposalSchema,
  schemaVersion,
  trackerKeySchema,
} from "./schemas";

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);

const contextAuditFields = {
  version: z.enum(["1", "2"]),
  hash: hashSchema,
  revision: z.number().int().nonnegative(),
  range: z.object({ from: localDateSchema, through: localDateSchema }).strict(),
  basePlanVersionId: z.uuid(),
  timelineHeadPlanVersionId: z.uuid(),
  safetyLevel: z.enum(["green", "yellow", "red"]),
} as const;

const contextAuditSchema = z
  .object(contextAuditFields)
  .strict()
  .refine((value) => value.range.through >= value.range.from, {
    message: "Invalid AI audit context range",
  });

export const aiAnalysisJobAuditDocumentSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    kind: z.literal("ai_analysis_job"),
    id: z.uuid(),
    trackerKey: trackerKeySchema,
    proposalId: z.uuid().nullable(),
    status: aiAnalysisJobStatusSchema,
    errorCode: aiAnalysisErrorCodeSchema.nullable(),
    provider: z.string().min(1).max(80),
    model: z.string().min(1).max(120),
    attemptCount: z.number().int().nonnegative(),
    context: contextAuditSchema,
    responseHash: hashSchema.nullable(),
    requestedAt: instantSchema,
    startedAt: instantSchema.nullable(),
    completedAt: instantSchema.nullable(),
  })
  .strict();

const proposalDecisionAuditSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(["accepted", "rejected"]),
    decidedAt: instantSchema,
    appliedPlanVersionId: z.uuid().nullable(),
    effectiveFrom: localDateSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const accepted = value.type === "accepted";
    if (
      accepted !==
      (value.appliedPlanVersionId !== null && value.effectiveFrom !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid proposal decision audit result",
      });
    }
  });

const proposalRollbackAuditSchema = z
  .object({
    id: z.uuid(),
    sourceAppliedPlanVersionId: z.uuid(),
    targetBasePlanVersionId: z.uuid(),
    newPlanVersionId: z.uuid(),
    effectiveFrom: localDateSchema,
    decidedAt: instantSchema,
  })
  .strict();

export const planChangeProposalAuditDocumentSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    kind: z.literal("plan_change_proposal"),
    id: z.uuid(),
    trackerKey: trackerKeySchema,
    analysisJobId: z.uuid(),
    basePlanVersionId: z.uuid(),
    timelineHeadPlanVersionId: z.uuid(),
    model: z.string().min(1).max(120),
    context: z
      .object({
        version: contextAuditFields.version,
        hash: contextAuditFields.hash,
        revision: contextAuditFields.revision,
        range: contextAuditFields.range,
        timelineHeadPlanVersionId: contextAuditFields.timelineHeadPlanVersionId,
        safetyLevel: contextAuditFields.safetyLevel,
      })
      .strict()
      .refine((value) => value.range.through >= value.range.from, {
        message: "Invalid AI proposal audit context range",
      }),
    safetyLevel: z.enum(["green", "yellow", "red"]),
    summary: z.string().min(1).max(2_000),
    operations: z.array(planChangeOperationSchema).max(100),
    status: z.enum(["proposed", "accepted", "rejected", "expired"]),
    createdAt: instantSchema,
    decision: proposalDecisionAuditSchema.nullable(),
    rollback: proposalRollbackAuditSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.status === "accepted" || value.status === "rejected") !==
      (value.decision !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Proposal decision audit state does not match status",
      });
    }
    if (value.decision && value.decision.type !== value.status) {
      context.addIssue({
        code: "custom",
        message: "Proposal decision audit type does not match status",
      });
    }
    if (value.rollback && value.decision?.type !== "accepted") {
      context.addIssue({
        code: "custom",
        message: "Only accepted proposals can have a rollback audit",
      });
    }
  });

export type AiAnalysisJobAuditDocument = z.infer<
  typeof aiAnalysisJobAuditDocumentSchema
>;
export type PlanChangeProposalAuditDocument = z.infer<
  typeof planChangeProposalAuditDocumentSchema
>;
export type ProposalDecisionAudit = z.infer<typeof proposalDecisionAuditSchema>;
export type ProposalRollbackAudit = z.infer<typeof proposalRollbackAuditSchema>;

export function createAiAnalysisJobAuditDocument(input: {
  id: string;
  trackerKey: string;
  proposalId: string | null;
  status: z.infer<typeof aiAnalysisJobStatusSchema>;
  errorCode: z.infer<typeof aiAnalysisErrorCodeSchema> | null;
  provider: string;
  model: string;
  attemptCount: number;
  contextVersion: "1" | "2";
  contextHash: string;
  contextRevision: number;
  contextFrom: string;
  contextThrough: string;
  basePlanVersionId: string;
  timelineHeadPlanVersionId: string;
  safetyLevel: "green" | "yellow" | "red";
  responseHash: string | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}): AiAnalysisJobAuditDocument {
  return aiAnalysisJobAuditDocumentSchema.parse({
    schemaVersion,
    kind: "ai_analysis_job",
    id: input.id,
    trackerKey: input.trackerKey,
    proposalId: input.proposalId,
    status: input.status,
    errorCode: input.errorCode,
    provider: input.provider,
    model: input.model,
    attemptCount: input.attemptCount,
    context: {
      version: input.contextVersion,
      hash: input.contextHash,
      revision: input.contextRevision,
      range: { from: input.contextFrom, through: input.contextThrough },
      basePlanVersionId: input.basePlanVersionId,
      timelineHeadPlanVersionId: input.timelineHeadPlanVersionId,
      safetyLevel: input.safetyLevel,
    },
    responseHash: input.responseHash,
    requestedAt: input.requestedAt,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  });
}

export function createPlanChangeProposalAuditDocument(input: {
  analysisJobId: string;
  model: string;
  contextVersion: "1" | "2";
  contextHash: string;
  contextRevision?: number;
  contextFrom: string;
  contextThrough: string;
  timelineHeadPlanVersionId: string;
  proposal: z.infer<typeof planChangeProposalSchema>;
  decision: ProposalDecisionAudit | null;
  rollback: ProposalRollbackAudit | null;
}): PlanChangeProposalAuditDocument {
  const proposal = planChangeProposalSchema.parse(input.proposal);
  return planChangeProposalAuditDocumentSchema.parse({
    schemaVersion,
    kind: "plan_change_proposal",
    id: proposal.id,
    trackerKey: proposal.trackerKey,
    analysisJobId: input.analysisJobId,
    basePlanVersionId: proposal.basePlanVersionId,
    timelineHeadPlanVersionId: input.timelineHeadPlanVersionId,
    model: input.model,
    context: {
      version: input.contextVersion,
      hash: input.contextHash,
      revision: input.contextRevision ?? 0,
      range: { from: input.contextFrom, through: input.contextThrough },
      timelineHeadPlanVersionId: input.timelineHeadPlanVersionId,
      safetyLevel: proposal.safetyLevel,
    },
    safetyLevel: proposal.safetyLevel,
    summary: proposal.summary,
    operations: proposal.operations,
    status: proposal.status,
    createdAt: proposal.createdAt,
    decision: input.decision,
    rollback: input.rollback,
  });
}
