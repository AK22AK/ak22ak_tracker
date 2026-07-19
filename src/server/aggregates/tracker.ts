import "server-only";

import {
  calendarAggregateSchema,
  dayAggregateSchema,
  todayAggregateSchema,
  type CalendarAggregate,
  type DayAggregate,
  type TodayAggregate,
} from "@/domain/api-contracts";
import { instantAtLocalNoon } from "@/domain/planning-time";
import {
  getCalendarMonthForTracker,
  getEffectivePlanDashboardContext,
  getTodayDashboardForTracker,
  getTrackerDashboardContext,
} from "@/server/dashboard";
import { getEffectiveTrackerSafetyPolicyByTrackerId } from "@/server/safety-policy/repository";
import { getExternalTrainingRecordsForDay } from "@/server/integrations/core/external-training-aggregate";

export class AggregateTrackerNotFoundError extends Error {
  constructor() {
    super("tracker_not_found");
    this.name = "AggregateTrackerNotFoundError";
  }
}

async function requireTracker(trackerKey: string) {
  const tracker = await getTrackerDashboardContext(trackerKey);
  if (!tracker) throw new AggregateTrackerNotFoundError();
  return tracker;
}

function planReference(
  plan: Awaited<ReturnType<typeof getEffectivePlanDashboardContext>>,
) {
  return plan
    ? {
        id: plan.id,
        version: plan.version,
        effectiveFrom: plan.effectiveFrom,
      }
    : null;
}

async function dayWithExternalTraining(
  tracker: Awaited<ReturnType<typeof requireTracker>>,
  plan: Awaited<ReturnType<typeof getEffectivePlanDashboardContext>>,
  trackerKey: string,
  targetDate: string,
) {
  const dayPromise = getTodayDashboardForTracker(
    tracker,
    plan,
    trackerKey,
    targetDate,
  );
  const externalTrainingRecordsPromise = getExternalTrainingRecordsForDay({
    trackerId: tracker.id,
    localDate: targetDate,
    tasks: dayPromise.then((day) => day.tasks),
  });
  const [day, externalTrainingRecords] = await Promise.all([
    dayPromise,
    externalTrainingRecordsPromise,
  ]);
  return {
    ...day,
    externalTrainingRecords,
  };
}

export async function getTodayAggregate(
  trackerKey: string,
  targetDate: string,
): Promise<TodayAggregate> {
  const tracker = await requireTracker(trackerKey);
  const plan = await getEffectivePlanDashboardContext(tracker.id, targetDate);
  const [day, safetyPolicy] = await Promise.all([
    dayWithExternalTraining(tracker, plan, trackerKey, targetDate),
    getEffectiveTrackerSafetyPolicyByTrackerId(
      tracker.id,
      instantAtLocalNoon(targetDate, tracker.planningTimeZone),
    ),
  ]);

  return todayAggregateSchema.parse({
    tracker: {
      key: tracker.key,
      name: tracker.name,
      startedOn: tracker.startedOn,
      planningTimeZone: tracker.planningTimeZone,
    },
    targetDate,
    plan: planReference(plan),
    day,
    safetyPolicy,
  });
}

export async function getDayAggregate(
  trackerKey: string,
  targetDate: string,
): Promise<DayAggregate> {
  const tracker = await requireTracker(trackerKey);
  const plan = await getEffectivePlanDashboardContext(tracker.id, targetDate);
  const day = await dayWithExternalTraining(
    tracker,
    plan,
    trackerKey,
    targetDate,
  );
  return dayAggregateSchema.parse({
    trackerKey,
    targetDate,
    plan: planReference(plan),
    day,
  });
}

export async function getCalendarAggregate(
  trackerKey: string,
  month: string,
): Promise<CalendarAggregate> {
  const tracker = await requireTracker(trackerKey);
  const days = await getCalendarMonthForTracker(tracker, month);
  return calendarAggregateSchema.parse({ trackerKey, month, days });
}
