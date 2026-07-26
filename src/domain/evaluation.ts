import { z } from "zod";

import { isLocalDate } from "./calendar";
import { resolveEffectivePlanVersion } from "./plan-timeline";
import {
  clientCommandMetadataSchema,
  ianaTimeZoneSchema,
  instantSchema,
  localDateSchema,
  schemaVersion,
  trackerKeySchema,
  type PlanVersion,
} from "./schemas";

export const evaluationSessionKindSchema = z.enum(["stage", "final"]);
export const evaluationSessionStatusSchema = z.enum(["open", "expired"]);

export const evaluationGoalCompletionSchema = z.enum([
  "met",
  "partially_met",
  "not_met",
  "uncertain",
]);

export const evaluationSymptomResponseSchema = z.enum([
  "none",
  "mild",
  "moderate",
  "severe",
  "not_assessed",
]);

export const evaluationCapacitySchema = z.enum([
  "ready",
  "limited",
  "not_assessed",
]);

export const evaluationNextStageIntentSchema = z.enum([
  "maintain",
  "progress",
  "extend",
  "professional_review",
  "undecided",
]);

const evaluationSideResultSchema = z
  .object({
    symptomResponse: evaluationSymptomResponseSchema,
    strengthAndControl: evaluationCapacitySchema,
    loadTolerance: evaluationCapacitySchema,
  })
  .strict();

export const evaluationResultAnswersSchema = z
  .object({
    goalCompletion: evaluationGoalCompletionSchema,
    sides: z
      .object({
        left: evaluationSideResultSchema,
        right: evaluationSideResultSchema,
      })
      .strict(),
    nextStageIntent: evaluationNextStageIntentSchema,
    note: z.string().max(2_000).optional(),
  })
  .strict();

export const evaluationResultDocumentSchema = evaluationResultAnswersSchema
  .extend({
    schemaVersion: z.literal(schemaVersion),
    resultVersion: z.literal("evaluation-result-v1"),
    id: z.uuid(),
    sessionId: z.uuid(),
    trackerKey: trackerKeySchema,
    kind: evaluationSessionKindSchema,
    submittedAt: instantSchema,
    submittedLocalDate: localDateSchema,
    basePlanVersionId: z.uuid(),
    timelineHeadPlanVersionId: z.uuid(),
  })
  .strict();

const planPointerSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    effectiveFrom: localDateSchema,
  })
  .strict();

const weeklyEvidenceSchema = z
  .object({
    weekStart: localDateSchema,
    weekEnd: localDateSchema,
    tasks: z
      .object({
        total: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
        planned: z.number().int().nonnegative(),
      })
      .strict(),
    feedback: z
      .object({
        feedbackDays: z.number().int().nonnegative().max(7),
        expectedDays: z.number().int().nonnegative().max(7),
        maxPain: z.number().int().min(0).max(10).nullable(),
        worstSafetyLevel: z.enum(["green", "yellow", "red"]).nullable(),
      })
      .strict(),
    execution: z
      .object({
        pauseDays: z.number().int().nonnegative().max(7),
        travelDays: z.number().int().nonnegative().max(7),
        equipmentLimitedDays: z.number().int().nonnegative().max(7),
        degradedDays: z.number().int().nonnegative().max(7),
      })
      .strict(),
    loadCoverage: z
      .object({
        completedTasks: z.number().int().nonnegative(),
        durationCoveredTasks: z.number().int().nonnegative(),
        distanceCoveredTasks: z.number().int().nonnegative(),
        sourceCoveredTasks: z.number().int().nonnegative(),
      })
      .strict(),
    effectiveness: z
      .object({
        status: z.literal("needs_policy"),
        policyVersion: z.null(),
      })
      .strict(),
  })
  .strict();

export const evaluationSessionSnapshotSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    id: z.uuid(),
    trackerKey: trackerKeySchema,
    kind: evaluationSessionKindSchema,
    triggerDate: localDateSchema,
    targetDate: localDateSchema,
    planningTimeZone: ianaTimeZoneSchema,
    calculationVersion: z.literal("evaluation-evidence-v1"),
    createdAt: instantSchema,
    evidenceRange: z
      .object({ from: localDateSchema, through: localDateSchema })
      .strict(),
    basePlanVersion: planPointerSchema,
    timelineHeadPlanVersion: planPointerSchema,
    effectiveness: z
      .object({
        status: z.literal("needs_policy"),
        policyVersion: z.null(),
      })
      .strict(),
    weeks: z.array(weeklyEvidenceSchema).max(520),
  })
  .strict();

export const evaluationSessionDtoSchema = evaluationSessionSnapshotSchema
  .extend({ status: evaluationSessionStatusSchema })
  .strict();

const evaluationResultSubmissionSchema = z
  .object({
    allowed: z.boolean(),
    blockedReason: z.enum(["red_safety", "already_recorded"]).nullable(),
  })
  .strict();

export const evaluationPageDtoSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("before_target"),
      trackerKey: trackerKeySchema,
      currentDate: localDateSchema,
      targetDate: localDateSchema,
      planningTimeZone: ianaTimeZoneSchema,
      session: z.null(),
    })
    .strict(),
  z
    .object({
      state: z.literal("eligible"),
      trackerKey: trackerKeySchema,
      currentDate: localDateSchema,
      targetDate: localDateSchema,
      planningTimeZone: ianaTimeZoneSchema,
      session: z.null(),
    })
    .strict(),
  z
    .object({
      state: z.literal("opened"),
      trackerKey: trackerKeySchema,
      currentDate: localDateSchema,
      targetDate: localDateSchema,
      planningTimeZone: ianaTimeZoneSchema,
      session: evaluationSessionDtoSchema,
      result: evaluationResultDocumentSchema.nullable().default(null),
      resultSubmission: evaluationResultSubmissionSchema.default({
        allowed: true,
        blockedReason: null,
      }),
    })
    .strict(),
  z
    .object({
      state: z.literal("expired"),
      trackerKey: trackerKeySchema,
      currentDate: localDateSchema,
      targetDate: localDateSchema,
      planningTimeZone: ianaTimeZoneSchema,
      canOpenReplacement: z.boolean(),
      session: evaluationSessionDtoSchema,
      result: evaluationResultDocumentSchema.nullable().default(null),
    })
    .strict(),
  z
    .object({
      state: z.literal("unavailable"),
      trackerKey: trackerKeySchema,
      currentDate: localDateSchema,
      planningTimeZone: ianaTimeZoneSchema,
      reason: z.enum(["plan_not_found", "target_not_defined"]),
      session: z.null(),
    })
    .strict(),
]);

export const createEvaluationSessionCommandSchema =
  clientCommandMetadataSchema.extend({
    kind: evaluationSessionKindSchema.default("final"),
  });

export const createEvaluationResultCommandSchema = clientCommandMetadataSchema
  .extend({
    sessionId: z.uuid(),
    answers: evaluationResultAnswersSchema,
  })
  .strict();

export type EvaluationSessionSnapshot = z.infer<
  typeof evaluationSessionSnapshotSchema
>;
export type EvaluationResultAnswers = z.infer<
  typeof evaluationResultAnswersSchema
>;
export type EvaluationResultDocument = z.infer<
  typeof evaluationResultDocumentSchema
>;
export type EvaluationPageDto = z.infer<typeof evaluationPageDtoSchema>;
export type CreateEvaluationSessionCommand = z.infer<
  typeof createEvaluationSessionCommandSchema
>;
export type CreateEvaluationResultCommand = z.infer<
  typeof createEvaluationResultCommandSchema
>;

type EvidenceTask = {
  id: string;
  localDate: string;
  planVersionId: string;
  status: "planned" | "completed" | "skipped";
  confirmedByUser: boolean;
  durationMeasured: boolean;
  distanceMeasured: boolean;
  sourceMeasured: boolean;
};

type EvidenceFeedback = {
  localDate: string;
  leftPain: number;
  rightPain: number;
  safetyLevel: "green" | "yellow" | "red";
};

type DateRange = { startDate: string; endDate: string };

export function buildEvaluationResultDocument(input: {
  id: string;
  sessionId: string;
  trackerKey: string;
  kind: "stage" | "final";
  submittedAt: string;
  submittedLocalDate: string;
  basePlanVersionId: string;
  timelineHeadPlanVersionId: string;
  answers: EvaluationResultAnswers;
}): EvaluationResultDocument {
  return evaluationResultDocumentSchema.parse({
    schemaVersion,
    resultVersion: "evaluation-result-v1",
    id: input.id,
    sessionId: input.sessionId,
    trackerKey: input.trackerKey,
    kind: input.kind,
    submittedAt: input.submittedAt,
    submittedLocalDate: input.submittedLocalDate,
    basePlanVersionId: input.basePlanVersionId,
    timelineHeadPlanVersionId: input.timelineHeadPlanVersionId,
    ...input.answers,
  });
}

function dateValue(localDate: string) {
  if (!isLocalDate(localDate)) throw new Error("invalid_local_date");
  return new Date(`${localDate}T00:00:00.000Z`);
}

function shiftDate(localDate: string, days: number) {
  const value = dateValue(localDate);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function mondayOf(localDate: string) {
  const value = dateValue(localDate);
  return shiftDate(localDate, -((value.getUTCDay() + 6) % 7));
}

function datesInRange(start: string, end: string) {
  const result: string[] = [];
  for (let date = start; date <= end; date = shiftDate(date, 1)) {
    result.push(date);
  }
  return result;
}

function overlapDates(
  ranges: readonly DateRange[],
  start: string,
  end: string,
) {
  const dates = new Set<string>();
  for (const range of ranges) {
    const from = range.startDate < start ? start : range.startDate;
    const through = range.endDate > end ? end : range.endDate;
    if (from > through) continue;
    for (const date of datesInRange(from, through)) dates.add(date);
  }
  return dates.size;
}

export function deriveEvaluationTargetDate(plan: PlanVersion) {
  return plan.tasks.reduce<string | null>(
    (latest, task) =>
      latest === null || task.scheduledDate > latest
        ? task.scheduledDate
        : latest,
    null,
  );
}

const safetyRank = { green: 0, yellow: 1, red: 2 } as const;

export function buildEvaluationEvidenceSnapshot(input: {
  id: string;
  trackerKey: string;
  kind: "stage" | "final";
  triggerDate: string;
  trackerStartedOn: string;
  planningTimeZone: string;
  createdAt: string;
  basePlanVersion: PlanVersion;
  timelineHeadPlanVersion: PlanVersion;
  planVersions: readonly PlanVersion[];
  tasks: readonly EvidenceTask[];
  feedbacks: readonly EvidenceFeedback[];
  pauses: readonly DateRange[];
  contexts: readonly (DateRange & {
    kind: "travel" | "equipment_limited";
  })[];
  degradedDates: readonly string[];
}): EvaluationSessionSnapshot {
  const targetDate = deriveEvaluationTargetDate(input.timelineHeadPlanVersion);
  if (!targetDate) throw new Error("evaluation_target_not_defined");
  if (input.triggerDate < targetDate)
    throw new Error("evaluation_not_eligible");
  const from = input.trackerStartedOn;
  const through = targetDate;
  const firstWeek = mondayOf(from);
  const lastWeek = mondayOf(through);
  const weeks = [];
  const degraded = new Set(input.degradedDates);

  for (
    let weekStart = firstWeek;
    weekStart <= lastWeek;
    weekStart = shiftDate(weekStart, 7)
  ) {
    const weekEnd = shiftDate(weekStart, 6);
    const rangeStart = weekStart < from ? from : weekStart;
    const rangeEnd = weekEnd > through ? through : weekEnd;
    const weekTasks = input.tasks.filter((task) => {
      if (task.localDate < rangeStart || task.localDate > rangeEnd)
        return false;
      const effective = resolveEffectivePlanVersion(
        input.planVersions,
        task.localDate,
      );
      return effective?.id === task.planVersionId;
    });
    const completed = weekTasks.filter(
      (task) => task.confirmedByUser && task.status === "completed",
    );
    const skipped = weekTasks.filter(
      (task) => task.confirmedByUser && task.status === "skipped",
    );
    const feedbackByDate = new Map<
      string,
      { maxPain: number; safetyLevel: "green" | "yellow" | "red" }
    >();
    for (const feedback of input.feedbacks) {
      if (feedback.localDate < rangeStart || feedback.localDate > rangeEnd) {
        continue;
      }
      const current = feedbackByDate.get(feedback.localDate);
      const maxPain = Math.max(feedback.leftPain, feedback.rightPain);
      feedbackByDate.set(feedback.localDate, {
        maxPain: Math.max(current?.maxPain ?? 0, maxPain),
        safetyLevel:
          !current ||
          safetyRank[feedback.safetyLevel] > safetyRank[current.safetyLevel]
            ? feedback.safetyLevel
            : current.safetyLevel,
      });
    }
    const feedbackDays = [...feedbackByDate.values()];
    const contexts = (kind: "travel" | "equipment_limited") =>
      overlapDates(
        input.contexts.filter((context) => context.kind === kind),
        rangeStart,
        rangeEnd,
      );
    weeks.push({
      weekStart,
      weekEnd,
      tasks: {
        total: weekTasks.length,
        completed: completed.length,
        skipped: skipped.length,
        planned: weekTasks.length - completed.length - skipped.length,
      },
      feedback: {
        feedbackDays: feedbackByDate.size,
        expectedDays: datesInRange(rangeStart, rangeEnd).length,
        maxPain:
          feedbackDays.length === 0
            ? null
            : Math.max(...feedbackDays.map((day) => day.maxPain)),
        worstSafetyLevel:
          feedbackDays.length === 0
            ? null
            : feedbackDays.reduce(
                (worst, day) =>
                  safetyRank[day.safetyLevel] > safetyRank[worst]
                    ? day.safetyLevel
                    : worst,
                feedbackDays[0]!.safetyLevel,
              ),
      },
      execution: {
        pauseDays: overlapDates(input.pauses, rangeStart, rangeEnd),
        travelDays: contexts("travel"),
        equipmentLimitedDays: contexts("equipment_limited"),
        degradedDays: datesInRange(rangeStart, rangeEnd).filter((date) =>
          degraded.has(date),
        ).length,
      },
      loadCoverage: {
        completedTasks: completed.length,
        durationCoveredTasks: completed.filter((task) => task.durationMeasured)
          .length,
        distanceCoveredTasks: completed.filter((task) => task.distanceMeasured)
          .length,
        sourceCoveredTasks: completed.filter((task) => task.sourceMeasured)
          .length,
      },
      effectiveness: { status: "needs_policy", policyVersion: null },
    });
  }

  const pointer = (plan: PlanVersion) => ({
    id: plan.id,
    version: plan.version,
    effectiveFrom: plan.effectiveFrom,
  });
  return evaluationSessionSnapshotSchema.parse({
    schemaVersion,
    id: input.id,
    trackerKey: input.trackerKey,
    kind: input.kind,
    triggerDate: input.triggerDate,
    targetDate,
    planningTimeZone: input.planningTimeZone,
    calculationVersion: "evaluation-evidence-v1",
    createdAt: input.createdAt,
    evidenceRange: { from, through },
    basePlanVersion: pointer(input.basePlanVersion),
    timelineHeadPlanVersion: pointer(input.timelineHeadPlanVersion),
    effectiveness: { status: "needs_policy", policyVersion: null },
    weeks,
  });
}
