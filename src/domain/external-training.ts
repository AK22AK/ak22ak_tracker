import { z } from "zod";

import { clientCommandMetadataSchema, localDateSchema } from "./schemas";

const displayMetricSchema = z.union([
  z.number().finite(),
  z.string().min(1).max(100),
]);

const externalTrainingSetDetailFields = {
  completed: z.boolean().nullable(),
  weight: displayMetricSchema.nullable(),
  unit: z.string().min(1).max(30).nullable(),
  reps: displayMetricSchema.nullable(),
  duration: displayMetricSchema.nullable(),
  durationUnit: z.string().min(1).max(30).nullable(),
  selfWeight: z.boolean().nullable(),
  rpe: z.number().finite().nonnegative().nullable(),
  restSeconds: z.number().finite().nonnegative().nullable(),
  note: z.string().max(1_000).nullable(),
};

export const externalTrainingSetItemSchema = z.object({
  name: z.string().min(1).max(300),
  ...externalTrainingSetDetailFields,
});

export const externalTrainingSetSchema = z.object({
  index: z.number().int().positive(),
  ...externalTrainingSetDetailFields,
  items: z.array(externalTrainingSetItemSchema).max(100),
});

export const externalTrainingMovementSchema = z.object({
  name: z.string().min(1).max(300),
  sets: z.array(externalTrainingSetSchema).max(200),
  difficulty: z.enum(["easy", "normal", "hard"]).nullable(),
  rpe: z.number().finite().nonnegative().nullable(),
  restSeconds: z.number().finite().nonnegative().nullable(),
  note: z.string().max(1_000).nullable(),
});

export const xunjiTrainingDetailsSchema = z.object({
  kind: z.literal("strength_training"),
  title: z.string().min(1).max(300),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  durationSeconds: z.number().int().nonnegative(),
  movements: z.array(externalTrainingMovementSchema).max(500),
  rpe: z.number().finite().nonnegative().nullable(),
  restSeconds: z.number().finite().nonnegative().nullable(),
  note: z.string().max(2_000).nullable(),
});

export const externalRecordAssociationSchema = z.object({
  status: z.enum(["suggested", "confirmed", "rejected", "unrelated"]),
  taskId: z.uuid().nullable(),
  sourceVersion: z.number().int().positive(),
  needsReview: z.boolean(),
});

export const externalRecordLinkSuggestionSchema = z.object({
  taskId: z.uuid(),
  reason: z.string().min(1).max(500),
});

const externalTrainingRecordBaseSchema = z.object({
  id: z.uuid(),
  localDate: localDateSchema,
  occurredAt: z.string().datetime({ offset: true }),
  sourceVersion: z.number().int().positive(),
  association: externalRecordAssociationSchema.nullable(),
  suggestion: externalRecordLinkSuggestionSchema.nullable(),
});

export const externalTrainingRecordSchema = externalTrainingRecordBaseSchema
  .extend({
    provider: z.literal("xunji"),
    details: xunjiTrainingDetailsSchema,
  })
  .strict();

const associationCommandBase = {
  externalRecordId: z.uuid(),
  sourceVersion: z.number().int().positive(),
};

export const externalRecordAssociationCommandSchema = z.discriminatedUnion(
  "decision",
  [
    clientCommandMetadataSchema.extend({
      ...associationCommandBase,
      decision: z.literal("link"),
      taskId: z.uuid(),
    }),
    clientCommandMetadataSchema.extend({
      ...associationCommandBase,
      decision: z.literal("unrelated"),
    }),
  ],
);

export const externalRecordAssociationResultSchema = z.object({
  commandId: z.uuid(),
  replayed: z.boolean(),
  recordId: z.uuid(),
  association: externalRecordAssociationSchema,
});

export type XunjiTrainingDetails = z.infer<typeof xunjiTrainingDetailsSchema>;
export type ExternalTrainingRecord = z.infer<
  typeof externalTrainingRecordSchema
>;
export type ExternalRecordAssociation = z.infer<
  typeof externalRecordAssociationSchema
>;
export type ExternalRecordAssociationCommand = z.infer<
  typeof externalRecordAssociationCommandSchema
>;
