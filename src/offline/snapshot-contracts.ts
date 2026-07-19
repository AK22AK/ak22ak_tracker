import { z } from "zod";

import {
  calendarAggregateSchema,
  dayAggregateSchema,
  dayDashboardSchema,
  planReferenceSchema,
  trackerSummarySchema,
  type TodayAggregate,
} from "@/domain/api-contracts";
import { executionContextTodaySchema } from "@/domain/execution-context";
import { safetyPolicyReferenceSchema } from "@/domain/safety-policy";

export const offlineTodaySnapshotSchema = z.object({
  tracker: trackerSummarySchema,
  targetDate: z.iso.date(),
  plan: planReferenceSchema.nullable(),
  day: dayDashboardSchema,
  safetyPolicy: safetyPolicyReferenceSchema,
  execution: executionContextTodaySchema,
});

export const offlineCalendarSnapshotSchema = calendarAggregateSchema;
export const offlineDaySnapshotSchema = dayAggregateSchema;

export type OfflineTodaySnapshot = z.infer<typeof offlineTodaySnapshotSchema>;
export type OfflineCalendarSnapshot = z.infer<
  typeof offlineCalendarSnapshotSchema
>;
export type OfflineDaySnapshot = z.infer<typeof offlineDaySnapshotSchema>;

export function projectTodaySnapshot(
  aggregate: TodayAggregate,
): OfflineTodaySnapshot {
  return offlineTodaySnapshotSchema.parse({
    tracker: aggregate.tracker,
    targetDate: aggregate.targetDate,
    plan: aggregate.plan,
    day: aggregate.day,
    safetyPolicy: {
      policyId: aggregate.safetyPolicy.policyId,
      version: aggregate.safetyPolicy.version,
      hash: aggregate.safetyPolicy.hash,
    },
    execution: aggregate.execution,
  });
}
