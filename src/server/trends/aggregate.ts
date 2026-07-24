import "server-only";

import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";

import {
  aggregateEightWeekTrends,
  eightWeekNaturalRange,
  trendsAggregateSchema,
  type TrendsAggregate,
} from "@/domain/trends";
import { garminActivitySummarySchema } from "@/domain/garmin";
import { localDateInTimeZone } from "@/domain/planning-time";
import { taskActualSchema } from "@/domain/schemas";
import { kneeCheckInEventPayloadSchema } from "@/modules/knee-rehab/check-in";
import { getDatabase } from "@/server/db/client";
import {
  events,
  externalRecordLinks,
  externalRecords,
  planVersions,
  taskInstances,
  trackers,
} from "@/server/db/schema";
import { xunjiTrainSchema } from "@/server/integrations/xunji/contracts";

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
  getLinkedTrainingRecords(
    trackerId: string,
    fromDate: string,
    throughDate: string,
  ): Promise<TrendLinkedExternalRecord[]>;
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
    async getTasks(trackerId, fromDate, throughDate) {
      const rows = await database
        .select({
          id: taskInstances.id,
          localDate: taskInstances.scheduledOn,
          planVersionId: taskInstances.planVersionId,
          status: taskInstances.status,
          confirmedByUser: taskInstances.confirmedByUser,
          actual: taskInstances.actualData,
        })
        .from(taskInstances)
        .where(
          and(
            eq(taskInstances.trackerId, trackerId),
            gte(taskInstances.scheduledOn, fromDate),
            lte(taskInstances.scheduledOn, throughDate),
          ),
        );
      return rows.map((row) => {
        const actual = taskActualSchema.safeParse(row.actual);
        return {
          id: row.id,
          localDate: row.localDate,
          planVersionId: row.planVersionId,
          status: row.status,
          confirmedByUser: row.confirmedByUser,
          actual: actual.success
            ? {
                durationMinutes: actual.data.durationMinutes,
                distanceKm: actual.data.distanceKm,
              }
            : null,
        } satisfies TrendTask;
      });
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
    async getLinkedTrainingRecords(trackerId, fromDate, throughDate) {
      const rows = await database
        .select({
          id: externalRecords.id,
          provider: externalRecords.provider,
          kind: externalRecords.kind,
          localDate: externalRecords.localDate,
          sourceVersion: externalRecords.sourceVersion,
          document: externalRecords.document,
          taskInstanceId: externalRecordLinks.taskInstanceId,
          linkSourceVersion: externalRecordLinks.sourceVersion,
          linkStatus: externalRecordLinks.status,
          needsReview: externalRecordLinks.needsReview,
        })
        .from(externalRecords)
        .innerJoin(
          externalRecordLinks,
          eq(externalRecordLinks.externalRecordId, externalRecords.id),
        )
        .where(
          and(
            eq(externalRecords.trackerId, trackerId),
            gte(externalRecords.localDate, fromDate),
            lte(externalRecords.localDate, throughDate),
            inArray(externalRecords.kind, ["activity", "strength_training"]),
          ),
        );

      return rows.flatMap((row): TrendLinkedExternalRecord[] => {
        if (row.provider === "garmin" && row.kind === "activity") {
          const activity = garminActivitySummarySchema.safeParse(
            row.document.payload,
          );
          return activity.success
            ? [
                {
                  id: row.id,
                  taskInstanceId: row.taskInstanceId,
                  provider: "garmin",
                  localDate: row.localDate,
                  sourceVersion: row.sourceVersion,
                  linkSourceVersion: row.linkSourceVersion,
                  linkStatus: row.linkStatus,
                  needsReview: row.needsReview,
                  durationMinutes: activity.data.durationSeconds / 60,
                  distanceKm:
                    activity.data.distanceMeters === null
                      ? null
                      : activity.data.distanceMeters / 1_000,
                },
              ]
            : [];
        }
        if (row.provider === "xunji" && row.kind === "strength_training") {
          const train = xunjiTrainSchema.safeParse(row.document.payload);
          return train.success
            ? [
                {
                  id: row.id,
                  taskInstanceId: row.taskInstanceId,
                  provider: "xunji",
                  localDate: row.localDate,
                  sourceVersion: row.sourceVersion,
                  linkSourceVersion: row.linkSourceVersion,
                  linkStatus: row.linkStatus,
                  needsReview: row.needsReview,
                  durationMinutes: (train.data.end - train.data.start) / 60_000,
                  distanceKm: null,
                },
              ]
            : [];
        }
        return [];
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
  const [versions, tasks, feedbacks, externalRecords] = await Promise.all([
    store.getPlanVersions(tracker.id, range.end),
    store.getTasks(tracker.id, dataStart, range.end),
    store.getFeedbacks(tracker.id, dataStart, currentDate),
    store.getLinkedTrainingRecords(tracker.id, dataStart, currentDate),
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
      externalRecords,
    }),
  );
}
