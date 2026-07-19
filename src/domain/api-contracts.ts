import { z } from "zod";

import {
  ianaTimeZoneSchema,
  localDateSchema,
  taskActualSchema,
  trackerKeySchema,
} from "./schemas";
import {
  safetyPolicyReferenceSchema,
  trackerSafetyPolicySchema,
} from "./safety-policy";
import { externalTrainingRecordSchema } from "./external-training";
import { executionContextTodaySchema } from "./execution-context";

export const dashboardTaskSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().optional(),
  category: z.string(),
  prescription: z.record(z.string(), z.unknown()),
  status: z.enum(["planned", "completed", "skipped"]),
  actual: taskActualSchema.nullable(),
  subjectiveNote: z.string().nullable(),
});

export const dashboardFeedbackSchema = z.object({
  id: z.uuid(),
  occurredAt: z.string().datetime({ offset: true }),
  timing: z.enum(["morning", "post_training", "next_day", "incident"]),
  leftPain: z.number(),
  rightPain: z.number(),
  swelling: z.enum(["none", "mild", "obvious"]),
  safetyLevel: z.enum(["green", "yellow", "red"]),
  safetyPolicy: safetyPolicyReferenceSchema.optional(),
  note: z.string(),
});

export const dayDashboardSchema = z.object({
  state: z.enum(["missing", "not_started", "ready"]),
  trackerName: z.string(),
  startDate: localDateSchema.nullable(),
  planVersion: z.number().int().positive().nullable(),
  tasks: z.array(dashboardTaskSchema),
  feedbackCount: z.number().int().nonnegative(),
  feedbacks: z.array(dashboardFeedbackSchema),
  externalTrainingRecords: z.array(externalTrainingRecordSchema),
});

export const trackerSummarySchema = z.object({
  key: trackerKeySchema,
  name: z.string(),
  startedOn: localDateSchema,
  planningTimeZone: ianaTimeZoneSchema,
});

export const planReferenceSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  effectiveFrom: localDateSchema,
});

export const todayAggregateSchema = z.object({
  tracker: trackerSummarySchema,
  targetDate: localDateSchema,
  plan: planReferenceSchema.nullable(),
  day: dayDashboardSchema,
  safetyPolicy: trackerSafetyPolicySchema,
  execution: executionContextTodaySchema,
});

export const calendarDaySummarySchema = z.object({
  date: localDateSchema,
  taskCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  feedbackCount: z.number().int().nonnegative(),
});

export const calendarAggregateSchema = z.object({
  trackerKey: trackerKeySchema,
  month: z.string().regex(/^\d{4}-\d{2}$/),
  days: z.array(calendarDaySummarySchema),
});

export const dayAggregateSchema = z.object({
  trackerKey: trackerKeySchema,
  targetDate: localDateSchema,
  plan: planReferenceSchema.nullable(),
  day: dayDashboardSchema,
});

export type TodayAggregate = z.infer<typeof todayAggregateSchema>;
export type CalendarAggregate = z.infer<typeof calendarAggregateSchema>;
export type DayAggregate = z.infer<typeof dayAggregateSchema>;
