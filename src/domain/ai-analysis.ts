import { z } from "zod";

import {
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
    status: z.enum(["proposed", "expired"]),
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

export type AiConfigurationStatus = z.infer<typeof aiConfigurationStatusSchema>;
export type AiAnalysisErrorCode = z.infer<typeof aiAnalysisErrorCodeSchema>;
export type AiAnalysisJobDto = z.infer<typeof aiAnalysisJobDtoSchema>;
export type AiAnalysisPageDto = z.infer<typeof aiAnalysisPageDtoSchema>;
export type AiProposalAudit = z.infer<typeof aiProposalAuditSchema>;
