import { z } from "zod";

import { localDateSchema, taskActualSchema } from "@/domain/schemas";
import { safetyPolicyReferenceSchema } from "@/domain/safety-policy";
import { kneeCheckInInputSchema } from "@/modules/knee-rehab/check-in";

export const OFFLINE_COMMAND_SCHEMA_VERSION = 1 as const;

export const pendingCommandStatusSchema = z.enum([
  "local_only",
  "syncing",
  "retryable",
  "waiting_auth",
  "needs_attention",
]);

const pendingCommandBaseSchema = z
  .object({
    id: z.uuid(),
    schemaVersion: z.literal(OFFLINE_COMMAND_SCHEMA_VERSION),
    githubUserId: z.string().regex(/^\d+$/),
    trackerKey: z.string().min(1).max(120),
    createdAt: z.string().datetime({ offset: true }),
    occurredAt: z.string().datetime({ offset: true }),
    localDate: localDateSchema,
    occurredTimeZone: z.string().min(1).max(100),
    occurredUtcOffsetMinutes: z.number().int().min(-840).max(840),
    attemptCount: z.number().int().nonnegative(),
    nextAttemptAt: z.string().datetime({ offset: true }),
    lastAttemptAt: z.string().datetime({ offset: true }).nullable(),
    lastErrorCode: z.string().min(1).max(120).nullable(),
    status: pendingCommandStatusSchema,
    sourceVersion: z.string().max(500).nullable(),
  })
  .strict();

export const pendingTaskCommandSchema = pendingCommandBaseSchema
  .extend({
    kind: z.literal("task_update"),
    payload: z
      .object({
        taskId: z.uuid(),
        status: z.enum(["planned", "completed", "skipped"]),
        actual: taskActualSchema.nullable(),
        note: z.string().max(2_000).nullable(),
        baseStatus: z.enum(["planned", "completed", "skipped"]),
        planVersion: z.number().int().positive().nullable(),
      })
      .strict(),
  })
  .strict();

export const pendingFeedbackCommandSchema = pendingCommandBaseSchema
  .extend({
    kind: z.literal("symptom_check_in"),
    payload: z
      .object({
        checkIn: kneeCheckInInputSchema,
        clientSafetyPolicy: safetyPolicyReferenceSchema.nullable(),
        localSafetyLevel: z.enum(["green", "yellow", "red"]).nullable(),
      })
      .strict(),
  })
  .strict();

export const pendingCommandSchema = z.discriminatedUnion("kind", [
  pendingTaskCommandSchema,
  pendingFeedbackCommandSchema,
]);

const pendingCommandInputBaseSchema = pendingCommandBaseSchema.omit({
  schemaVersion: true,
  attemptCount: true,
  nextAttemptAt: true,
  lastAttemptAt: true,
  lastErrorCode: true,
  status: true,
  sourceVersion: true,
});

export const pendingCommandInputSchema = z.discriminatedUnion("kind", [
  pendingCommandInputBaseSchema
    .extend({
      kind: z.literal("task_update"),
      payload: pendingTaskCommandSchema.shape.payload,
      sourceVersion: z.string().max(500).nullable().optional(),
    })
    .strict(),
  pendingCommandInputBaseSchema
    .extend({
      kind: z.literal("symptom_check_in"),
      payload: pendingFeedbackCommandSchema.shape.payload,
      sourceVersion: z.string().max(500).nullable().optional(),
    })
    .strict(),
]);

export type PendingCommand = z.infer<typeof pendingCommandSchema>;
export type PendingCommandInput = z.infer<typeof pendingCommandInputSchema>;
export type PendingCommandStatus = z.infer<typeof pendingCommandStatusSchema>;
