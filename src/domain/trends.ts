import { z } from "zod";

import { isLocalDate } from "./calendar";
import { resolveEffectivePlanVersion } from "./plan-timeline";
import {
  ianaTimeZoneSchema,
  localDateSchema,
  trackerKeySchema,
} from "./schemas";

const safetyCountsSchema = z
  .object({
    green: z.number().int().nonnegative(),
    yellow: z.number().int().nonnegative(),
    red: z.number().int().nonnegative(),
  })
  .strict();

export const trendWeekSchema = z
  .object({
    weekStart: localDateSchema,
    weekEnd: localDateSchema,
    isCurrentWeek: z.boolean(),
    tasks: z
      .object({
        planned: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        completionRate: z.number().min(0).max(1).nullable(),
      })
      .strict(),
    symptoms: z
      .object({
        feedbackDays: z.number().int().nonnegative().max(7),
        expectedDays: z.number().int().nonnegative().max(7),
        maxPain: z.number().int().min(0).max(10).nullable(),
        safetyDays: safetyCountsSchema,
      })
      .strict(),
    load: z
      .object({
        completedTrainingDays: z.number().int().nonnegative().max(7),
        measuredDurationMinutes: z.number().nonnegative().nullable(),
        durationCoveredTasks: z.number().int().nonnegative(),
        completedTasks: z.number().int().nonnegative(),
        measuredDistanceKm: z.number().nonnegative().nullable(),
        distanceCoveredTasks: z.number().int().nonnegative(),
        sourceCoverage: z
          .object({
            manual: z.number().int().nonnegative(),
            garmin: z.number().int().nonnegative(),
            xunji: z.number().int().nonnegative(),
            fallbackUnmeasured: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const trendsAggregateSchema = z
  .object({
    trackerKey: trackerKeySchema,
    range: z
      .object({
        start: localDateSchema,
        end: localDateSchema,
        currentDate: localDateSchema,
      })
      .strict(),
    timeZone: ianaTimeZoneSchema,
    generatedAt: z.string().datetime({ offset: true }),
    weeks: z.array(trendWeekSchema).length(8),
  })
  .strict();

export type TrendsAggregate = z.infer<typeof trendsAggregateSchema>;

type TrendPlanVersionRow = {
  id: string;
  version: number;
  effectiveFrom: string;
};

type TrendTaskRow = {
  id: string;
  localDate: string;
  planVersionId: string;
  status: "planned" | "completed" | "skipped";
  confirmedByUser: boolean;
  actual: {
    durationMinutes: number | null;
    distanceKm: number | null;
  } | null;
};

type TrendLinkedExternalRecord = {
  id: string;
  taskInstanceId: string | null;
  provider: "garmin" | "xunji";
  localDate: string;
  sourceVersion: number;
  linkSourceVersion: number;
  linkStatus: "suggested" | "confirmed" | "rejected";
  needsReview: boolean;
  durationMinutes: number;
  distanceKm: number | null;
};

type TrendFeedbackRow = {
  localDate: string;
  leftPain: number;
  rightPain: number;
  safetyLevel: "green" | "yellow" | "red";
};

function localDateValue(localDate: string) {
  if (!isLocalDate(localDate)) throw new Error("invalid_local_date");
  return new Date(`${localDate}T00:00:00.000Z`);
}

function shiftLocalDate(localDate: string, days: number) {
  const date = localDateValue(localDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inclusiveDays(start: string, end: string) {
  if (end < start) return 0;
  return (
    Math.floor(
      (localDateValue(end).valueOf() - localDateValue(start).valueOf()) /
        86_400_000,
    ) + 1
  );
}

export function eightWeekNaturalRange(currentDate: string) {
  const date = localDateValue(currentDate);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const currentWeekStart = shiftLocalDate(currentDate, -mondayOffset);
  return {
    start: shiftLocalDate(currentWeekStart, -7 * 7),
    end: shiftLocalDate(currentWeekStart, 6),
    currentDate,
  };
}

const safetyRank = { green: 0, yellow: 1, red: 2 } as const;

export function aggregateEightWeekTrends(input: {
  trackerKey: string;
  trackerStartedOn: string;
  timeZone: string;
  currentDate: string;
  generatedAt: string;
  planVersions: readonly TrendPlanVersionRow[];
  tasks: readonly TrendTaskRow[];
  feedbacks: readonly TrendFeedbackRow[];
  externalRecords: readonly TrendLinkedExternalRecord[];
}): TrendsAggregate {
  const range = eightWeekNaturalRange(input.currentDate);
  const weeks = Array.from({ length: 8 }, (_, index) => {
    const weekStart = shiftLocalDate(range.start, index * 7);
    const weekEnd = shiftLocalDate(weekStart, 6);
    const expectedStart =
      input.trackerStartedOn > weekStart ? input.trackerStartedOn : weekStart;
    const expectedEnd =
      input.currentDate < weekEnd ? input.currentDate : weekEnd;
    return {
      weekStart,
      weekEnd,
      isCurrentWeek:
        input.currentDate >= weekStart && input.currentDate <= weekEnd,
      tasks: {
        planned: 0,
        completed: 0,
        skipped: 0,
        total: 0,
        completionRate: null as number | null,
      },
      symptoms: {
        feedbackDays: 0,
        expectedDays: inclusiveDays(expectedStart, expectedEnd),
        maxPain: null as number | null,
        safetyDays: { green: 0, yellow: 0, red: 0 },
      },
      load: {
        completedTrainingDays: 0,
        measuredDurationMinutes: null as number | null,
        durationCoveredTasks: 0,
        completedTasks: 0,
        measuredDistanceKm: null as number | null,
        distanceCoveredTasks: 0,
        sourceCoverage: {
          manual: 0,
          garmin: 0,
          xunji: 0,
          fallbackUnmeasured: 0,
        },
      },
    };
  });

  const weekFor = (localDate: string) => {
    if (localDate < range.start || localDate > range.end) return null;
    const offset =
      (localDateValue(localDate).valueOf() -
        localDateValue(range.start).valueOf()) /
      86_400_000;
    return weeks[Math.floor(offset / 7)] ?? null;
  };

  for (const task of input.tasks) {
    const week = weekFor(task.localDate);
    if (!week) continue;
    const effectivePlan = resolveEffectivePlanVersion(
      input.planVersions,
      task.localDate,
    );
    if (effectivePlan?.id !== task.planVersionId) continue;
    week.tasks[task.status] += 1;
    week.tasks.total += 1;
  }
  for (const week of weeks) {
    week.tasks.completionRate =
      week.tasks.total === 0 ? null : week.tasks.completed / week.tasks.total;
  }

  const validCompletedTasks = new Map<string, TrendTaskRow & { id: string }>();
  for (const task of input.tasks) {
    if (
      task.status !== "completed" ||
      task.confirmedByUser !== true ||
      task.localDate < input.trackerStartedOn ||
      task.localDate > input.currentDate
    ) {
      continue;
    }
    const effectivePlan = resolveEffectivePlanVersion(
      input.planVersions,
      task.localDate,
    );
    if (effectivePlan?.id !== task.planVersionId) continue;
    if (!weekFor(task.localDate)) continue;
    validCompletedTasks.set(task.id, { ...task, id: task.id });
  }

  const recordsByTask = new Map<string, TrendLinkedExternalRecord[]>();
  const seenRecords = new Set<string>();
  for (const record of input.externalRecords) {
    const task = record.taskInstanceId
      ? validCompletedTasks.get(record.taskInstanceId)
      : null;
    const deduplicationKey = `${record.provider}:${record.id}`;
    if (
      !task ||
      record.localDate !== task.localDate ||
      record.linkStatus !== "confirmed" ||
      record.needsReview ||
      record.linkSourceVersion !== record.sourceVersion ||
      seenRecords.has(deduplicationKey)
    ) {
      continue;
    }
    seenRecords.add(deduplicationKey);
    const records = recordsByTask.get(task.id) ?? [];
    records.push(record);
    recordsByTask.set(task.id, records);
  }

  const trainingDaysByWeek = new Map<string, Set<string>>();
  for (const task of validCompletedTasks.values()) {
    const week = weekFor(task.localDate);
    if (!week) continue;
    week.load.completedTasks += 1;
    const trainingDays = trainingDaysByWeek.get(week.weekStart) ?? new Set();
    trainingDays.add(task.localDate);
    trainingDaysByWeek.set(week.weekStart, trainingDays);

    const records = recordsByTask.get(task.id) ?? [];
    const garmin = records.filter((record) => record.provider === "garmin");
    const xunji = records.filter((record) => record.provider === "xunji");
    const manualDuration = task.actual?.durationMinutes ?? null;
    const manualDistance = task.actual?.distanceKm ?? null;
    const duration =
      manualDuration ??
      (garmin.length > 0
        ? garmin.reduce((sum, record) => sum + record.durationMinutes, 0)
        : xunji.length > 0
          ? xunji.reduce((sum, record) => sum + record.durationMinutes, 0)
          : null);
    const garminDistances = garmin.flatMap((record) =>
      record.distanceKm === null ? [] : [record.distanceKm],
    );
    const distance =
      manualDistance ??
      (garminDistances.length > 0
        ? garminDistances.reduce((sum, value) => sum + value, 0)
        : null);

    if (duration !== null) {
      week.load.measuredDurationMinutes =
        (week.load.measuredDurationMinutes ?? 0) + duration;
      week.load.durationCoveredTasks += 1;
    }
    if (distance !== null) {
      week.load.measuredDistanceKm =
        (week.load.measuredDistanceKm ?? 0) + distance;
      week.load.distanceCoveredTasks += 1;
    }

    if (manualDuration !== null || manualDistance !== null) {
      week.load.sourceCoverage.manual += 1;
    } else if (garmin.length > 0) {
      week.load.sourceCoverage.garmin += 1;
    } else if (xunji.length > 0) {
      week.load.sourceCoverage.xunji += 1;
    } else {
      week.load.sourceCoverage.fallbackUnmeasured += 1;
    }
  }
  for (const week of weeks) {
    week.load.completedTrainingDays =
      trainingDaysByWeek.get(week.weekStart)?.size ?? 0;
    if (week.load.measuredDurationMinutes !== null) {
      week.load.measuredDurationMinutes = Number(
        week.load.measuredDurationMinutes.toFixed(1),
      );
    }
    if (week.load.measuredDistanceKm !== null) {
      week.load.measuredDistanceKm = Number(
        week.load.measuredDistanceKm.toFixed(2),
      );
    }
  }

  const dailyFeedback = new Map<
    string,
    { maxPain: number; safetyLevel: "green" | "yellow" | "red" }
  >();
  for (const feedback of input.feedbacks) {
    if (
      feedback.localDate < input.trackerStartedOn ||
      feedback.localDate > input.currentDate
    ) {
      continue;
    }
    const maxPain = Math.max(feedback.leftPain, feedback.rightPain);
    const current = dailyFeedback.get(feedback.localDate);
    dailyFeedback.set(feedback.localDate, {
      maxPain: Math.max(current?.maxPain ?? 0, maxPain),
      safetyLevel:
        current &&
        safetyRank[current.safetyLevel] > safetyRank[feedback.safetyLevel]
          ? current.safetyLevel
          : feedback.safetyLevel,
    });
  }
  for (const [localDate, feedback] of dailyFeedback) {
    const week = weekFor(localDate);
    if (!week) continue;
    week.symptoms.feedbackDays += 1;
    week.symptoms.maxPain = Math.max(
      week.symptoms.maxPain ?? 0,
      feedback.maxPain,
    );
    week.symptoms.safetyDays[feedback.safetyLevel] += 1;
  }

  return trendsAggregateSchema.parse({
    trackerKey: input.trackerKey,
    range,
    timeZone: input.timeZone,
    generatedAt: input.generatedAt,
    weeks,
  });
}
