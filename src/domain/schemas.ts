import { z } from "zod";

export const schemaVersion = "1.0.0" as const;

const identifierSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

export const trackerKeySchema = identifierSchema;
export const localDateSchema = z.string().date();
export const instantSchema = z.string().datetime({ offset: true });

export const planTaskSchema = z.object({
  id: identifierSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(2_000).optional(),
  scheduledDate: localDateSchema,
  sortOrder: z.number().int().nonnegative(),
  category: identifierSchema,
  prescription: z.record(z.string(), z.unknown()).default({}),
});

export const taskActualSchema = z.object({
  kind: z.enum(["exercise_list", "endurance", "general"]),
  exercises: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        completed: z.boolean(),
        actual: z.string().max(500),
      }),
    )
    .max(50)
    .default([]),
  durationMinutes: z.number().nonnegative().max(1_440).nullable().default(null),
  distanceKm: z.number().nonnegative().max(1_000).nullable().default(null),
  summary: z.string().max(2_000).default(""),
});

export const planVersionSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  id: z.uuid(),
  trackerKey: trackerKeySchema,
  version: z.number().int().positive(),
  effectiveFrom: localDateSchema,
  createdAt: instantSchema,
  createdBy: z.enum(["import", "user", "ai_accepted"]),
  source: z
    .object({
      repository: z.string().max(200),
      path: z.string().max(1_000),
      commit: z.string().regex(/^[0-9a-f]{7,40}$/),
    })
    .optional(),
  tasks: z.array(planTaskSchema),
  notes: z.string().max(10_000).optional(),
});

export const trackerEventSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  id: z.uuid(),
  trackerKey: trackerKeySchema,
  kind: z.enum([
    "task_completion",
    "training_log",
    "symptom_check_in",
    "subjective_note",
    "plan_change_decision",
  ]),
  occurredAt: instantSchema,
  recordedAt: instantSchema,
  localDate: localDateSchema,
  idempotencyKey: z.string().min(8).max(200),
  payload: z.record(z.string(), z.unknown()),
  provenance: z.object({
    source: z.enum(["user", "offline_queue", "import", "system"]),
    clientId: z.string().max(200).optional(),
  }),
});

export const externalRecordSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  id: z.uuid(),
  trackerKey: trackerKeySchema,
  provider: z.enum(["garmin"]),
  providerRecordId: z.string().min(1).max(200),
  kind: z.enum(["activity", "sleep", "daily_steps"]),
  occurredAt: instantSchema,
  localDate: localDateSchema,
  payload: z.record(z.string(), z.unknown()),
  fetchedAt: instantSchema,
});

export const planChangeOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("add_task"),
    task: planTaskSchema,
    reason: z.string().min(1).max(1_000),
  }),
  z.object({
    type: z.literal("replace_task"),
    taskId: identifierSchema,
    task: planTaskSchema,
    reason: z.string().min(1).max(1_000),
  }),
  z.object({
    type: z.literal("remove_task"),
    taskId: identifierSchema,
    reason: z.string().min(1).max(1_000),
  }),
  z.object({
    type: z.literal("set_plan_note"),
    note: z.string().max(10_000),
    reason: z.string().min(1).max(1_000),
  }),
]);

export const planChangeProposalSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  id: z.uuid(),
  trackerKey: trackerKeySchema,
  basePlanVersionId: z.uuid(),
  createdAt: instantSchema,
  safetyLevel: z.enum(["green", "yellow", "red"]),
  summary: z.string().min(1).max(2_000),
  operations: z.array(planChangeOperationSchema).max(100),
  status: z.enum(["proposed", "accepted", "rejected", "expired"]),
});

export type PlanVersion = z.infer<typeof planVersionSchema>;
export type TrackerEvent = z.infer<typeof trackerEventSchema>;
export type ExternalRecord = z.infer<typeof externalRecordSchema>;
export type PlanChangeProposal = z.infer<typeof planChangeProposalSchema>;
export type TaskActual = z.infer<typeof taskActualSchema>;
