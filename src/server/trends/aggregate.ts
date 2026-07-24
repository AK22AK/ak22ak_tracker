import "server-only";

import { and, asc, eq, gte, lte } from "drizzle-orm";

import {
  aggregateEightWeekTrends,
  eightWeekNaturalRange,
  trendsAggregateSchema,
  type TrendsAggregate,
} from "@/domain/trends";
import { localDateInTimeZone } from "@/domain/planning-time";
import { kneeCheckInEventPayloadSchema } from "@/modules/knee-rehab/check-in";
import { getDatabase } from "@/server/db/client";
import {
  events,
  planVersions,
  taskInstances,
  trackers,
} from "@/server/db/schema";

type Database = ReturnType<typeof getDatabase>;

type TrendTracker = {
  id: string;
  key: string;
  startedOn: string;
  planningTimeZone: string;
};

type TrendPlanVersion = {
  id: string;
  version: number;
  effectiveFrom: string;
};

type TrendTask = {
  localDate: string;
  planVersionId: string;
  status: "planned" | "completed" | "skipped";
};

type TrendFeedback = {
  localDate: string;
  leftPain: number;
  rightPain: number;
  safetyLevel: "green" | "yellow" | "red";
};

export type TrendDataStore = {
  getTracker(trackerKey: string): Promise<TrendTracker | null>;
  getPlanVersions(
    trackerId: string,
    throughDate: string,
  ): Promise<TrendPlanVersion[]>;
  getTasks(
    trackerId: string,
    fromDate: string,
    throughDate: string,
  ): Promise<TrendTask[]>;
  getFeedbacks(
    trackerId: string,
    fromDate: string,
    throughDate: string,
  ): Promise<TrendFeedback[]>;
};

export class AggregateTrackerNotFoundError extends Error {
  constructor() {
    super("tracker_not_found");
    this.name = "AggregateTrackerNotFoundError";
  }
}

export function createNeonTrendDataStore(
  database: Database = getDatabase(),
): TrendDataStore {
  return {
    async getTracker(trackerKey) {
      const [tracker] = await database
        .select({
          id: trackers.id,
          key: trackers.key,
          startedOn: trackers.startedOn,
          planningTimeZone: trackers.planningTimeZone,
        })
        .from(trackers)
        .where(and(eq(trackers.key, trackerKey), eq(trackers.active, true)))
        .limit(1);
      return tracker ?? null;
    },
    getPlanVersions(trackerId, throughDate) {
      return database
        .select({
          id: planVersions.id,
          version: planVersions.version,
          effectiveFrom: planVersions.effectiveFrom,
        })
        .from(planVersions)
        .where(
          and(
            eq(planVersions.trackerId, trackerId),
            lte(planVersions.effectiveFrom, throughDate),
          ),
        )
        .orderBy(asc(planVersions.effectiveFrom), asc(planVersions.version));
    },
    getTasks(trackerId, fromDate, throughDate) {
      return database
        .select({
          localDate: taskInstances.scheduledOn,
          planVersionId: taskInstances.planVersionId,
          status: taskInstances.status,
        })
        .from(taskInstances)
        .where(
          and(
            eq(taskInstances.trackerId, trackerId),
            gte(taskInstances.scheduledOn, fromDate),
            lte(taskInstances.scheduledOn, throughDate),
          ),
        );
    },
    async getFeedbacks(trackerId, fromDate, throughDate) {
      const rows = await database
        .select({
          localDate: events.localDate,
          document: events.document,
        })
        .from(events)
        .where(
          and(
            eq(events.trackerId, trackerId),
            eq(events.kind, "symptom_check_in"),
            gte(events.localDate, fromDate),
            lte(events.localDate, throughDate),
          ),
        );
      return rows.flatMap((row) => {
        const payload = kneeCheckInEventPayloadSchema.safeParse(
          row.document.payload,
        );
        return payload.success
          ? [
              {
                localDate: row.localDate,
                leftPain: payload.data.leftPain,
                rightPain: payload.data.rightPain,
                safetyLevel: payload.data.safetyLevel,
              } satisfies TrendFeedback,
            ]
          : [];
      });
    },
  };
}

export async function getTrendsAggregate({
  trackerKey,
  store = createNeonTrendDataStore(),
  now = new Date(),
}: {
  trackerKey: string;
  store?: TrendDataStore;
  now?: Date;
}): Promise<TrendsAggregate> {
  const tracker = await store.getTracker(trackerKey);
  if (!tracker) throw new AggregateTrackerNotFoundError();
  const currentDate = localDateInTimeZone(now, tracker.planningTimeZone);
  const range = eightWeekNaturalRange(currentDate);
  const dataStart =
    tracker.startedOn > range.start ? tracker.startedOn : range.start;
  const [versions, tasks, feedbacks] = await Promise.all([
    store.getPlanVersions(tracker.id, range.end),
    store.getTasks(tracker.id, dataStart, range.end),
    store.getFeedbacks(tracker.id, dataStart, currentDate),
  ]);
  return trendsAggregateSchema.parse(
    aggregateEightWeekTrends({
      trackerKey: tracker.key,
      trackerStartedOn: tracker.startedOn,
      timeZone: tracker.planningTimeZone,
      currentDate,
      generatedAt: now.toISOString(),
      planVersions: versions,
      tasks,
      feedbacks,
    }),
  );
}
