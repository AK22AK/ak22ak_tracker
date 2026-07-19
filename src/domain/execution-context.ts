import { z } from "zod";

import {
  clientCommandMetadataSchema,
  instantSchema,
  localDateSchema,
  schemaVersion,
  trackerKeySchema,
} from "./schemas";

const optionKeySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

export const executionContextKindSchema = z.enum([
  "travel",
  "equipment_limited",
]);
export const executionVenueSchema = z.enum([
  "hotel_gym",
  "room",
  "stairs",
  "outdoors",
  "transit",
  "none",
]);
export const executionEquipmentSchema = z.enum([
  "machines",
  "dumbbells",
  "chair",
  "stairs",
  "backpack",
  "none",
]);
export const executionHealthStatusSchema = z.enum([
  "normal",
  "illness",
  "acute_symptom",
]);
export const executionPauseReasonSchema = z.enum([
  "illness",
  "acute_symptom",
  "red_feedback",
  "other",
]);

export const executionDayConditionsSchema = z.object({
  availableMinutes: z.number().int().min(0).max(240),
  venue: executionVenueSchema,
  equipment: z.array(executionEquipmentSchema).max(6),
  healthStatus: executionHealthStatusSchema,
  note: z.string().max(500).optional(),
});

export const executionAlternativeDocumentSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  id: z.uuid(),
  trackerKey: trackerKeySchema,
  optionKey: optionKeySchema,
  version: z.number().int().positive(),
  effectiveFrom: localDateSchema,
  createdAt: instantSchema,
  source: z
    .object({
      repository: z.string().max(200),
      path: z.string().max(1_000),
      commit: z.string().regex(/^[0-9a-f]{7,40}$/),
    })
    .optional(),
  kind: z.enum(["alternative", "micro_training"]),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(1_000),
  estimatedMinutes: z.object({
    min: z.number().int().nonnegative().max(240),
    max: z.number().int().nonnegative().max(240),
  }),
  steps: z.array(z.string().min(1).max(500)).min(1).max(30),
});

export const executionAlternativeBundleSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  trackerKey: trackerKeySchema,
  options: z.array(executionAlternativeDocumentSchema).min(1).max(50),
});

export const executionAlternativeReferenceSchema = z.object({
  optionId: z.uuid(),
  optionVersion: z.number().int().positive(),
});

export const createExecutionContextCommandSchema =
  clientCommandMetadataSchema.extend({
    contextId: z.uuid(),
    kind: executionContextKindSchema,
    startDate: localDateSchema,
    endDate: localDateSchema,
  });

export const endExecutionContextCommandSchema =
  clientCommandMetadataSchema.extend({
    contextId: z.uuid(),
  });

export const setExecutionDayCommandSchema = clientCommandMetadataSchema.extend({
  contextId: z.uuid(),
  localDate: localDateSchema,
  conditions: executionDayConditionsSchema,
  selection: executionAlternativeReferenceSchema.nullable(),
});

export const startExecutionPauseCommandSchema =
  clientCommandMetadataSchema.extend({
    pauseId: z.uuid(),
    reason: executionPauseReasonSchema,
    note: z.string().max(500).optional(),
  });

export const endExecutionPauseCommandSchema =
  clientCommandMetadataSchema.extend({
    pauseId: z.uuid(),
  });

export const executionPauseDtoSchema = z.object({
  id: z.uuid(),
  reason: executionPauseReasonSchema,
  note: z.string().max(500).nullable(),
  startedOn: localDateSchema,
  endedOn: localDateSchema.nullable(),
  status: z.enum(["active", "pending_resume_assessment"]),
});

export const executionAlternativeDtoSchema = executionAlternativeDocumentSchema
  .pick({
    id: true,
    optionKey: true,
    version: true,
    kind: true,
    title: true,
    summary: true,
    estimatedMinutes: true,
    steps: true,
  })
  .strict();

export const executionContextSummarySchema = z.object({
  id: z.uuid(),
  kind: executionContextKindSchema,
  startDate: localDateSchema,
  endDate: localDateSchema,
  status: z.enum(["upcoming", "active"]),
});

export const executionDayDecisionDtoSchema = z.object({
  localDate: localDateSchema,
  conditions: executionDayConditionsSchema,
  selection: executionAlternativeReferenceSchema.nullable(),
  safetyDisposition: z.enum(["normal", "stop_reassess"]),
});

export const executionContextTodaySchema = z.object({
  pause: executionPauseDtoSchema.nullable().optional(),
  context: executionContextSummarySchema.nullable(),
  day: executionDayDecisionDtoSchema.nullable(),
  alternatives: z.array(executionAlternativeDtoSchema),
  safety: z.object({
    blocked: z.boolean(),
    reason: z
      .enum(["red_feedback", "illness", "acute_symptom", "pause"])
      .nullable(),
  }),
});

export const executionContextCommandResultSchema = z.object({
  commandId: z.uuid(),
  replayed: z.boolean(),
  context: executionContextSummarySchema.optional(),
  endedOn: localDateSchema.optional(),
  day: executionDayDecisionDtoSchema.optional(),
  pause: executionPauseDtoSchema.optional(),
});

export type ExecutionDayConditions = z.infer<
  typeof executionDayConditionsSchema
>;
export type ExecutionAlternativeDocument = z.infer<
  typeof executionAlternativeDocumentSchema
>;
export type ExecutionAlternativeReference = z.infer<
  typeof executionAlternativeReferenceSchema
>;
export type ExecutionContextToday = z.infer<typeof executionContextTodaySchema>;
export type CreateExecutionContextCommand = z.infer<
  typeof createExecutionContextCommandSchema
>;
export type EndExecutionContextCommand = z.infer<
  typeof endExecutionContextCommandSchema
>;
export type SetExecutionDayCommand = z.infer<
  typeof setExecutionDayCommandSchema
>;
export type StartExecutionPauseCommand = z.infer<
  typeof startExecutionPauseCommandSchema
>;
export type EndExecutionPauseCommand = z.infer<
  typeof endExecutionPauseCommandSchema
>;
