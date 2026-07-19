import { z } from "zod";

import { isLocalDate } from "./calendar";
import {
  clientCommandMetadataSchema,
  ianaTimeZoneSchema,
  instantSchema,
  localDateSchema,
  planVersionSchema,
  schemaVersion,
  trackerKeySchema,
  type PlanVersion,
} from "./schemas";

const taskDefinitionIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

export const resumptionTriggerTypeSchema = z.enum([
  "execution_context",
  "pause",
]);
export const resumptionAssessmentStatusSchema = z.enum([
  "pending",
  "kept_original",
  "shifted",
  "expired",
]);
export const resumptionDecisionTypeSchema = z.enum(["keep_original", "shift"]);

export const resumptionTaskSnapshotSchema = z.object({
  taskInstanceId: z.uuid(),
  taskDefinitionId: taskDefinitionIdSchema,
  title: z.string().min(1).max(200),
  category: z.string().min(1).max(120),
  scheduledOn: localDateSchema,
  status: z.enum(["planned", "completed", "skipped"]),
});

export const resumptionAssessmentSnapshotSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  id: z.uuid(),
  trackerKey: trackerKeySchema,
  trigger: z.object({
    type: resumptionTriggerTypeSchema,
    id: z.uuid(),
    startDate: localDateSchema,
    endDate: localDateSchema,
    interruptionDays: z.number().int().nonnegative(),
    pausedDays: z.number().int().nonnegative(),
    restrictedDays: z.number().int().nonnegative(),
  }),
  basePlanVersion: z.object({
    id: z.uuid(),
    version: z.number().int().positive(),
    effectiveFrom: localDateSchema,
  }),
  planningTimeZone: ianaTimeZoneSchema,
  createdAt: instantSchema,
  recommendedEffectiveFrom: localDateSchema,
  shiftDays: z.number().int().positive(),
  lastConfirmedTraining: resumptionTaskSnapshotSchema.nullable(),
  futureTasks: z.array(resumptionTaskSnapshotSchema).max(500),
  shiftPreview: z
    .array(
      z.object({
        taskDefinitionId: taskDefinitionIdSchema,
        title: z.string().min(1).max(200),
        from: localDateSchema,
        to: localDateSchema,
      }),
    )
    .max(500),
});

export const resumptionAssessmentDtoSchema =
  resumptionAssessmentSnapshotSchema.extend({
    status: resumptionAssessmentStatusSchema,
    decision: resumptionDecisionTypeSchema.nullable(),
    decidedAt: instantSchema.nullable(),
    appliedPlanVersionId: z.uuid().nullable(),
  });

const resumptionDecisionBaseSchema = clientCommandMetadataSchema.extend({
  assessmentId: z.uuid(),
  basePlanVersionId: z.uuid(),
  replacementAssessmentId: z.uuid(),
});

export const resumptionDecisionCommandSchema = z.discriminatedUnion(
  "decision",
  [
    resumptionDecisionBaseSchema.extend({
      decision: z.literal("keep_original"),
    }),
    resumptionDecisionBaseSchema.extend({
      decision: z.literal("shift"),
      effectiveFrom: localDateSchema,
      newPlanVersionId: z.uuid(),
    }),
  ],
);

export const resumptionDecisionResultSchema = z.object({
  commandId: z.uuid(),
  replayed: z.boolean(),
  status: z.enum(["kept_original", "shifted", "expired"]),
  assessmentId: z.uuid(),
  appliedPlanVersionId: z.uuid().nullable(),
  replacementAssessmentId: z.uuid().nullable(),
});

export type ResumptionAssessmentSnapshot = z.infer<
  typeof resumptionAssessmentSnapshotSchema
>;
export type ResumptionAssessmentDto = z.infer<
  typeof resumptionAssessmentDtoSchema
>;
export type ResumptionDecisionCommand = z.infer<
  typeof resumptionDecisionCommandSchema
>;

export function shiftLocalDate(localDate: string, days: number) {
  if (!isLocalDate(localDate) || !Number.isInteger(days)) {
    throw new Error("Invalid local date shift");
  }
  const value = new Date(`${localDate}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function inclusiveLocalDateCount(startDate: string, endDate: string) {
  if (!isLocalDate(startDate) || !isLocalDate(endDate) || endDate < startDate) {
    throw new Error("Invalid local date range");
  }
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function buildShiftedPlanVersion(
  base: PlanVersion,
  assessment: ResumptionAssessmentSnapshot,
  next: Pick<PlanVersion, "id" | "version" | "createdAt">,
) {
  if (assessment.basePlanVersion.id !== base.id) {
    throw new Error("Resumption assessment targets a different plan version");
  }
  const shifts = new Map(
    assessment.shiftPreview.map((item) => [item.taskDefinitionId, item]),
  );
  return planVersionSchema.parse({
    ...base,
    ...next,
    effectiveFrom: assessment.recommendedEffectiveFrom,
    createdBy: "user",
    source: undefined,
    tasks: base.tasks.map((task) => {
      const shift = shifts.get(task.id);
      return shift ? { ...task, scheduledDate: shift.to } : task;
    }),
  });
}
