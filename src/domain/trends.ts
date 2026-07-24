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
  localDate: string;
  planVersionId: string;
  status: "planned" | "completed" | "skipped";
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
