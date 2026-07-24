import { z } from "zod";

import {
  clientCommandMetadataSchema,
  instantSchema,
  localDateSchema,
  planChangeOperationSchema,
  schemaVersion,
  trackerKeySchema,
} from "./schemas";

export const aiConfigurationStatusSchema = z.enum([
  "configured",
  "not_configured",
  "invalid_configuration",
]);

export const aiAnalysisJobStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
]);

export const aiAnalysisErrorCodeSchema = z.enum([
  "not_configured",
  "invalid_configuration",
  "authentication",
  "insufficient_balance",
  "rate_limited",
  "timeout",
  "provider_unavailable",
  "empty_response",
  "truncated_response",
  "invalid_response",
  "unsafe_proposal",
  "context_changed",
]);

export const requestPlanAnalysisSchema = z
  .object({ commandId: z.uuid() })
  .strict();

export const aiProposalAuditSchema = z
  .object({
    analysisJobId: z.uuid(),
    model: z.string().min(1).max(120),
    contextVersion: z.literal("1"),
    contextHash: z.string().regex(/^[0-9a-f]{64}$/),
    contextFrom: localDateSchema,
    contextThrough: localDateSchema,
    timelineHeadPlanVersionId: z.uuid(),
  })
  .strict();

export const aiPlanChangeProposalDtoSchema = z
  .object({
    id: z.uuid(),
    basePlanVersionId: z.uuid(),
    createdAt: instantSchema,
    safetyLevel: z.enum(["green", "yellow", "red"]),
    summary: z.string().min(1).max(2_000),
    operations: z.array(planChangeOperationSchema).max(20),
    status: z.enum(["proposed", "accepted", "rejected", "expired"]),
    application: z
      .object({
        effectiveFrom: localDateSchema.nullable(),
        canAccept: z.boolean(),
        blockedReason: z
          .enum([
            "red_safety",
            "no_operations",
            "invalid_operations",
            "context_changed",
            "future_timeline",
          ])
          .nullable(),
      })
      .strict(),
    decision: z
      .object({
        type: z.enum(["accepted", "rejected"]),
        decidedAt: instantSchema,
        appliedPlanVersion: z
          .object({
            id: z.uuid(),
            version: z.number().int().positive(),
            effectiveFrom: localDateSchema,
          })
          .strict()
          .nullable(),
      })
      .strict()
      .nullable(),
    rollback: z
      .object({
        status: z.enum(["available", "rolled_back", "blocked"]),
        blockedReason: z.enum(["later_plan_version"]).nullable(),
        targetBasePlanVersion: z
          .object({ id: z.uuid(), version: z.number().int().positive() })
          .strict(),
        sourceAppliedPlanVersion: z
          .object({
            id: z.uuid(),
            version: z.number().int().positive(),
            effectiveFrom: localDateSchema,
          })
          .strict(),
        newPlanVersion: z
          .object({
            id: z.uuid(),
            version: z.number().int().positive(),
            effectiveFrom: localDateSchema,
          })
          .strict()
          .nullable(),
        effectiveFrom: localDateSchema,
        affectedDates: z.array(localDateSchema).max(500),
        decidedAt: instantSchema.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const aiAnalysisJobDtoSchema = z
  .object({
    id: z.uuid(),
    trackerKey: trackerKeySchema,
    status: aiAnalysisJobStatusSchema,
    errorCode: aiAnalysisErrorCodeSchema.nullable(),
    retryable: z.boolean(),
    requestedAt: instantSchema,
    completedAt: instantSchema.nullable(),
    proposal: aiPlanChangeProposalDtoSchema.nullable(),
  })
  .strict();

export const aiAnalysisPageDtoSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    configuration: aiConfigurationStatusSchema,
    job: aiAnalysisJobDtoSchema.nullable(),
  })
  .strict();

export const planChangeDecisionCommandSchema = clientCommandMetadataSchema
  .extend({
    proposalId: z.uuid(),
    decision: z.enum(["accepted", "rejected"]),
  })
  .strict();

export const planChangeDecisionResultSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    commandId: z.uuid(),
    proposalId: z.uuid(),
    replayed: z.boolean(),
    conflict: z.boolean(),
    status: z.enum(["accepted", "rejected", "expired"]),
    appliedPlanVersion: z
      .object({
        id: z.uuid(),
        version: z.number().int().positive(),
        effectiveFrom: localDateSchema,
      })
      .strict()
      .nullable(),
    affectedDates: z.array(localDateSchema).max(500),
    page: aiAnalysisPageDtoSchema,
  })
  .strict();

export const planVersionRollbackCommandSchema = clientCommandMetadataSchema
  .extend({ proposalId: z.uuid() })
  .strict();

export const planVersionRollbackResultSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    commandId: z.uuid(),
    proposalId: z.uuid(),
    replayed: z.boolean(),
    conflict: z.boolean(),
    status: z.enum(["rolled_back", "blocked"]),
    blockedReason: z.enum(["later_plan_version"]).nullable(),
    newPlanVersion: z
      .object({
        id: z.uuid(),
        version: z.number().int().positive(),
        effectiveFrom: localDateSchema,
      })
      .strict()
      .nullable(),
    affectedDates: z.array(localDateSchema).max(500),
    page: aiAnalysisPageDtoSchema,
  })
  .strict();

export type AiConfigurationStatus = z.infer<typeof aiConfigurationStatusSchema>;
export type AiAnalysisErrorCode = z.infer<typeof aiAnalysisErrorCodeSchema>;
export type AiAnalysisJobDto = z.infer<typeof aiAnalysisJobDtoSchema>;
export type AiAnalysisPageDto = z.infer<typeof aiAnalysisPageDtoSchema>;
export type AiProposalAudit = z.infer<typeof aiProposalAuditSchema>;
export type PlanChangeDecisionCommand = z.infer<
  typeof planChangeDecisionCommandSchema
>;
export type PlanChangeDecisionResult = z.infer<
  typeof planChangeDecisionResultSchema
>;
export type PlanVersionRollbackCommand = z.infer<
  typeof planVersionRollbackCommandSchema
>;
export type PlanVersionRollbackResult = z.infer<
  typeof planVersionRollbackResultSchema
>;
