import { z } from "zod";

import {
  clientCommandMetadataSchema,
  instantSchema,
  localDateSchema,
  schemaVersion,
} from "./schemas";

export const rehabProfileDocumentSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    goals: z.array(z.string().min(1).max(500)).max(20),
    background: z.array(z.string().min(1).max(500)).max(20),
    clinicianGuidance: z.array(z.string().min(1).max(500)).max(30),
    hardConstraints: z.array(z.string().min(1).max(500)).max(30),
    trainingPreferences: z.array(z.string().min(1).max(500)).max(20),
  })
  .strict();

export const rehabProfileDtoSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    status: z.enum(["draft", "active", "superseded"]),
    document: rehabProfileDocumentSchema,
    createdAt: instantSchema,
    activatedAt: instantSchema.nullable(),
  })
  .strict();

export const assistantMemoryCategorySchema = z.enum([
  "goal",
  "preference",
  "schedule",
  "equipment",
  "routine",
  "stable_constraint",
]);

export const assistantMemoryActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("remember"),
      category: assistantMemoryCategorySchema,
      content: z.string().min(1).max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal("forget"),
      category: assistantMemoryCategorySchema,
      content: z.string().min(1).max(500),
    })
    .strict(),
]);

export const assistantAssociationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("auto") }).strict(),
  z.object({ kind: z.literal("date"), localDate: localDateSchema }).strict(),
  z
    .object({
      kind: z.literal("task"),
      localDate: localDateSchema,
      taskInstanceId: z.uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("activity"),
      localDate: localDateSchema,
      externalRecordId: z.uuid(),
    })
    .strict(),
]);

export const assistantModelAssociationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("auto") }).strict(),
  z
    .object({
      kind: z.enum(["date", "task", "activity"]),
      localDate: localDateSchema,
    })
    .strict(),
]);

export function assistantAssociationForModel(
  association: z.infer<typeof assistantAssociationSchema>,
) {
  return assistantModelAssociationSchema.parse(
    association.kind === "auto"
      ? association
      : { kind: association.kind, localDate: association.localDate },
  );
}

export const assistantFeedbackDraftSchema = z
  .object({
    localDate: localDateSchema,
    timing: z.enum(["morning", "post_training", "next_day", "incident"]),
    leftPain: z.number().int().min(0).max(10),
    rightPain: z.number().int().min(0).max(10),
    swelling: z.enum(["none", "mild", "obvious"]),
    stiffness: z.boolean(),
    mechanicalSymptoms: z.boolean(),
    weightBearingIssue: z.boolean(),
    localizedBonePain: z.boolean(),
    nightOrRestPain: z.boolean(),
    note: z.string().max(2_000),
    association: assistantAssociationSchema,
  })
  .strict();

export const assistantEvidenceReferenceSchema = z
  .object({
    localDate: localDateSchema,
    category: z.enum([
      "user_message",
      "plan",
      "feedback",
      "planned_task",
      "garmin_activity",
      "xunji_training",
      "recovery",
      "memory",
      "rehab_profile",
    ]),
  })
  .strict();

export const assistantTurnResponseSchema = z
  .object({
    reply: z.string().min(1).max(4_000),
    followUpQuestions: z.array(z.string().min(1).max(500)).max(3),
    feedbackDraft: assistantFeedbackDraftSchema.nullable(),
    planReview: z.enum(["not_needed", "suggested", "blocked_by_missing_info"]),
    memoryActions: z.array(assistantMemoryActionSchema).max(5),
    evidenceReferences: z.array(assistantEvidenceReferenceSchema).max(30),
  })
  .strict();

export const createAssistantTurnCommandSchema = z
  .object({
    commandId: z.uuid(),
    message: z.string().trim().min(1).max(4_000),
    association: assistantAssociationSchema.default({ kind: "auto" }),
  })
  .strict();

const confirmedFeedbackSchema = assistantFeedbackDraftSchema.omit({
  association: true,
});

export const saveAssistantFeedbackCommandSchema = clientCommandMetadataSchema
  .extend({
    turnId: z.uuid(),
    feedback: confirmedFeedbackSchema,
  })
  .strict();

export const assistantMemoryDtoSchema = z
  .object({
    id: z.uuid(),
    category: assistantMemoryCategorySchema,
    content: z.string().min(1).max(500),
    status: z.enum(["active", "superseded", "deleted"]),
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .strict();

export const assistantTurnDtoSchema = z
  .object({
    id: z.uuid(),
    commandId: z.uuid(),
    message: z.string().min(1).max(4_000),
    association: assistantAssociationSchema,
    status: z.enum(["pending", "running", "succeeded", "failed"]),
    response: assistantTurnResponseSchema.nullable(),
    errorCode: z
      .enum([
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
        "context_changed",
      ])
      .nullable(),
    model: z.string().max(120).nullable(),
    contextHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    confirmedFeedbackId: z.uuid().nullable(),
    createdAt: instantSchema,
    completedAt: instantSchema.nullable(),
  })
  .strict();

export const assistantConversationDtoSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    conversationId: z.uuid().nullable(),
    turns: z.array(assistantTurnDtoSchema).max(100),
    memories: z.array(assistantMemoryDtoSchema).max(100),
    profile: rehabProfileDtoSchema.nullable(),
    nextCursor: z.string().max(200).nullable(),
  })
  .strict();

export type AssistantAssociation = z.infer<typeof assistantAssociationSchema>;
export type AssistantConversationDto = z.infer<
  typeof assistantConversationDtoSchema
>;
export type AssistantFeedbackDraft = z.infer<
  typeof assistantFeedbackDraftSchema
>;
export type AssistantMemoryAction = z.infer<typeof assistantMemoryActionSchema>;
export type AssistantTurnResponse = z.infer<typeof assistantTurnResponseSchema>;
export type CreateAssistantTurnCommand = z.infer<
  typeof createAssistantTurnCommandSchema
>;
export type RehabProfileDocument = z.infer<typeof rehabProfileDocumentSchema>;
export type SaveAssistantFeedbackCommand = z.infer<
  typeof saveAssistantFeedbackCommandSchema
>;
