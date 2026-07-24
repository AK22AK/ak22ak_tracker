import "server-only";

import { and, asc, desc, eq, gte, lte } from "drizzle-orm";

import { localDateInTimeZone } from "@/domain/planning-time";
import { planVersionSchema, taskActualSchema } from "@/domain/schemas";
import { kneeCheckInEventPayloadSchema } from "@/modules/knee-rehab/check-in";
import { getDatabase } from "@/server/db/client";
import {
  events,
  planVersions,
  taskInstances,
  trackers,
} from "@/server/db/schema";
import { contentHash } from "@/server/integrations/core/content-hash";

import type {
  PlanAdjustmentContext,
  PlanAdjustmentFeedback,
  PlanAdjustmentSafetyLevel,
  PlanAdjustmentTraining,
} from "./contracts";

type Database = ReturnType<typeof getDatabase>;

function shiftDate(localDate: string, days: number) {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const safetyRank = { green: 0, yellow: 1, red: 2 } as const;

function mostSevere(feedback: readonly PlanAdjustmentFeedback[]) {
  return feedback.reduce<PlanAdjustmentSafetyLevel>(
    (current, item) =>
      safetyRank[item.safetyLevel] > safetyRank[current]
        ? item.safetyLevel
        : current,
    "green",
  );
}

export class AiAnalysisTrackerNotFoundError extends Error {
  constructor() {
    super("tracker_not_found");
    this.name = "AiAnalysisTrackerNotFoundError";
  }
}

export class AiAnalysisPlanNotFoundError extends Error {
  constructor() {
    super("plan_not_found");
    this.name = "AiAnalysisPlanNotFoundError";
  }
}

export type PreparedAiAnalysisContext = {
  trackerId: string;
  trackerKey: string;
  basePlanVersionId: string;
  timelineHeadPlanVersionId: string;
  basePlan: ReturnType<typeof planVersionSchema.parse>;
  timelineHeadPlan: ReturnType<typeof planVersionSchema.parse>;
  modelContext: PlanAdjustmentContext;
  contextVersion: "1";
  contextHash: string;
  contextRevision: number;
  contextFrom: string;
  contextThrough: string;
  safetyLevel: PlanAdjustmentSafetyLevel;
};

export async function prepareAiAnalysisContext({
  trackerKey,
  now = new Date(),
  database = getDatabase(),
}: {
  trackerKey: string;
  now?: Date;
  database?: Database;
}): Promise<PreparedAiAnalysisContext> {
  const [tracker] = await database
    .select({
      id: trackers.id,
      key: trackers.key,
      planningTimeZone: trackers.planningTimeZone,
      aiContextRevision: trackers.aiContextRevision,
    })
    .from(trackers)
    .where(and(eq(trackers.key, trackerKey), eq(trackers.active, true)))
    .limit(1);
  if (!tracker) throw new AiAnalysisTrackerNotFoundError();

  const contextThrough = localDateInTimeZone(now, tracker.planningTimeZone);
  const contextFrom = shiftDate(contextThrough, -13);
  const [baseRow, headRow, feedbackRows, trainingRows] = await Promise.all([
    database
      .select({ id: planVersions.id, document: planVersions.document })
      .from(planVersions)
      .where(
        and(
          eq(planVersions.trackerId, tracker.id),
          lte(planVersions.effectiveFrom, contextThrough),
        ),
      )
      .orderBy(desc(planVersions.effectiveFrom), desc(planVersions.version))
      .limit(1),
    database
      .select({ id: planVersions.id, document: planVersions.document })
      .from(planVersions)
      .where(eq(planVersions.trackerId, tracker.id))
      .orderBy(desc(planVersions.version))
      .limit(1),
    database
      .select({
        localDate: events.localDate,
        occurredAt: events.occurredAt,
        document: events.document,
      })
      .from(events)
      .where(
        and(
          eq(events.trackerId, tracker.id),
          eq(events.kind, "symptom_check_in"),
          gte(events.localDate, contextFrom),
          lte(events.localDate, contextThrough),
        ),
      )
      .orderBy(asc(events.occurredAt)),
    database
      .select({
        taskDefinitionId: taskInstances.taskDefinitionId,
        localDate: taskInstances.scheduledOn,
        actual: taskInstances.actualData,
        planDocument: planVersions.document,
      })
      .from(taskInstances)
      .innerJoin(planVersions, eq(taskInstances.planVersionId, planVersions.id))
      .where(
        and(
          eq(taskInstances.trackerId, tracker.id),
          eq(taskInstances.status, "completed"),
          eq(taskInstances.confirmedByUser, true),
          gte(taskInstances.scheduledOn, contextFrom),
          lte(taskInstances.scheduledOn, contextThrough),
        ),
      )
      .orderBy(asc(taskInstances.scheduledOn)),
  ]);
  const base = baseRow[0];
  const head = headRow[0];
  if (!base || !head) throw new AiAnalysisPlanNotFoundError();
  const parsedPlan = planVersionSchema.parse(base.document);
  const parsedTimelineHead = planVersionSchema.parse(head.document);
  const currentPlan: PlanAdjustmentContext["currentPlan"] = {
    id: parsedPlan.id,
    trackerKey: parsedPlan.trackerKey,
    version: parsedPlan.version,
    effectiveFrom: parsedPlan.effectiveFrom,
    tasks: parsedPlan.tasks,
    notes: parsedPlan.notes,
  };

  const recentFeedback = feedbackRows.flatMap((row) => {
    const parsed = kneeCheckInEventPayloadSchema.safeParse(
      row.document.payload,
    );
    if (!parsed.success) return [];
    return [
      {
        localDate: row.localDate,
        timing: parsed.data.timing,
        leftPain: parsed.data.leftPain,
        rightPain: parsed.data.rightPain,
        swelling: parsed.data.swelling,
        stiffness: parsed.data.stiffness,
        mechanicalSymptoms: parsed.data.mechanicalSymptoms,
        weightBearingIssue: parsed.data.weightBearingIssue,
        localizedBonePain: parsed.data.localizedBonePain,
        nightOrRestPain: parsed.data.nightOrRestPain,
        safetyLevel: parsed.data.safetyLevel,
      },
    ];
  });
  const confirmedTraining = trainingRows.flatMap((row) => {
    const plan = planVersionSchema.safeParse(row.planDocument);
    const actual = taskActualSchema.safeParse(row.actual);
    const definition = plan.success
      ? plan.data.tasks.find((task) => task.id === row.taskDefinitionId)
      : null;
    if (!definition) return [];
    return [
      {
        taskDefinitionId: row.taskDefinitionId,
        localDate: row.localDate,
        category: definition.category,
        durationMinutes: actual.success ? actual.data.durationMinutes : null,
        distanceKm: actual.success ? actual.data.distanceKm : null,
      } satisfies PlanAdjustmentTraining,
    ];
  });
  const safetyLevel = mostSevere(recentFeedback);
  const modelContext: PlanAdjustmentContext = {
    currentPlan,
    timelineHeadPlanVersionId: head.id,
    planningTimeZone: tracker.planningTimeZone,
    range: { from: contextFrom, through: contextThrough },
    recentFeedback,
    confirmedTraining,
    safetyLevel,
  };
  return {
    trackerId: tracker.id,
    trackerKey: tracker.key,
    basePlanVersionId: base.id,
    timelineHeadPlanVersionId: head.id,
    basePlan: parsedPlan,
    timelineHeadPlan: parsedTimelineHead,
    modelContext,
    contextVersion: "1",
    contextHash: contentHash(modelContext),
    contextRevision: tracker.aiContextRevision,
    contextFrom,
    contextThrough,
    safetyLevel,
  };
}
