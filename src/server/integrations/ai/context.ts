import "server-only";

import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";

import { buildRecoveryEvidence } from "@/domain/ai-recovery";
import { localDateInTimeZone } from "@/domain/planning-time";
import { planVersionSchema, taskActualSchema } from "@/domain/schemas";
import {
  assistantMemoryCategorySchema,
  assistantTurnResponseSchema,
  rehabProfileDocumentSchema,
} from "@/domain/rehab-assistant";
import { kneeCheckInEventPayloadSchema } from "@/modules/knee-rehab/check-in";
import { getDatabase } from "@/server/db/client";
import {
  events,
  assistantMemories,
  assistantTurns,
  externalRecordLinks,
  externalRecords,
  integrationDateSyncState,
  planVersions,
  rehabProfiles,
  taskInstances,
  trackers,
} from "@/server/db/schema";
import { contentHash } from "@/server/integrations/core/content-hash";
import { garminWellnessEvidenceSchema } from "@/server/integrations/garmin/contracts";

import type {
  PlanAdjustmentContext,
  PlanAdjustmentFeedback,
  PlanAdjustmentSafetyLevel,
  PlanAdjustmentTraining,
} from "./contracts";
import { projectObservedTrainingEvidence } from "./external-evidence";

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

export class AiAnalysisSourceTurnNotFoundError extends Error {
  constructor() {
    super("source_turn_not_found");
    this.name = "AiAnalysisSourceTurnNotFoundError";
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
  contextVersion: "1" | "2" | "3";
  contextHash: string;
  contextRevision: number;
  contextFrom: string;
  contextThrough: string;
  safetyLevel: PlanAdjustmentSafetyLevel;
  sourceAssistantTurnId?: string | null;
};

export async function prepareAiAnalysisContext({
  trackerKey,
  now = new Date(),
  database = getDatabase(),
  sourceAssistantTurnId = null,
}: {
  trackerKey: string;
  now?: Date;
  database?: Database;
  sourceAssistantTurnId?: string | null;
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
  const [
    baseRow,
    headRow,
    feedbackRows,
    trainingRows,
    wellnessRows,
    externalTrainingRows,
    coverageRows,
    profileRows,
    memoryRows,
    sourceTurnRows,
  ] = await Promise.all([
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
    database
      .select({
        localDate: externalRecords.localDate,
        document: externalRecords.document,
      })
      .from(externalRecords)
      .where(
        and(
          eq(externalRecords.trackerId, tracker.id),
          eq(externalRecords.provider, "garmin"),
          eq(externalRecords.kind, "daily_wellness"),
          gte(externalRecords.localDate, contextFrom),
          lte(externalRecords.localDate, contextThrough),
        ),
      )
      .orderBy(asc(externalRecords.localDate)),
    database
      .select({
        id: externalRecords.id,
        provider: externalRecords.provider,
        kind: externalRecords.kind,
        localDate: externalRecords.localDate,
        occurredAt: externalRecords.occurredAt,
        sourceVersion: externalRecords.sourceVersion,
        document: externalRecords.document,
        linkStatus: externalRecordLinks.status,
        linkSourceVersion: externalRecordLinks.sourceVersion,
        linkNeedsReview: externalRecordLinks.needsReview,
        taskDefinitionId: taskInstances.taskDefinitionId,
      })
      .from(externalRecords)
      .leftJoin(
        externalRecordLinks,
        eq(externalRecordLinks.externalRecordId, externalRecords.id),
      )
      .leftJoin(
        taskInstances,
        eq(externalRecordLinks.taskInstanceId, taskInstances.id),
      )
      .where(
        and(
          eq(externalRecords.trackerId, tracker.id),
          inArray(externalRecords.kind, ["activity", "strength_training"]),
          gte(externalRecords.localDate, contextFrom),
          lte(externalRecords.localDate, contextThrough),
        ),
      )
      .orderBy(asc(externalRecords.occurredAt)),
    database
      .select({
        provider: integrationDateSyncState.provider,
        localDate: integrationDateSyncState.localDate,
        status: integrationDateSyncState.status,
        recordCount: integrationDateSyncState.recordCount,
        updatedAt: integrationDateSyncState.updatedAt,
      })
      .from(integrationDateSyncState)
      .where(
        and(
          eq(integrationDateSyncState.trackerId, tracker.id),
          inArray(integrationDateSyncState.provider, [
            "garmin",
            "garmin_wellness",
            "xunji",
            "garmin_activity_history",
            "garmin_wellness_history",
            "xunji_training_history",
          ]),
          gte(integrationDateSyncState.localDate, contextFrom),
          lte(integrationDateSyncState.localDate, contextThrough),
        ),
      ),
    database
      .select({
        version: rehabProfiles.version,
        document: rehabProfiles.document,
      })
      .from(rehabProfiles)
      .where(
        and(
          eq(rehabProfiles.trackerId, tracker.id),
          eq(rehabProfiles.status, "active"),
        ),
      )
      .orderBy(desc(rehabProfiles.version))
      .limit(1),
    database
      .select({
        category: assistantMemories.category,
        content: assistantMemories.content,
      })
      .from(assistantMemories)
      .where(
        and(
          eq(assistantMemories.trackerId, tracker.id),
          eq(assistantMemories.status, "active"),
        ),
      )
      .orderBy(asc(assistantMemories.createdAt))
      .limit(100),
    sourceAssistantTurnId
      ? database
          .select({
            message: assistantTurns.message,
            response: assistantTurns.response,
          })
          .from(assistantTurns)
          .where(
            and(
              eq(assistantTurns.id, sourceAssistantTurnId),
              eq(assistantTurns.trackerId, tracker.id),
              eq(assistantTurns.status, "succeeded"),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);
  const base = baseRow[0];
  const head = headRow[0];
  if (!base || !head) throw new AiAnalysisPlanNotFoundError();
  if (sourceAssistantTurnId && !sourceTurnRows[0]) {
    throw new AiAnalysisSourceTurnNotFoundError();
  }
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

  let observationCharacters = 0;
  const recentFeedback = feedbackRows.flatMap((row) => {
    const parsed = kneeCheckInEventPayloadSchema.safeParse(
      row.document.payload,
    );
    if (!parsed.success) return [];
    const note = parsed.data.note.trim();
    const available = Math.max(0, 2_000 - observationCharacters);
    const userObservation = note
      ? note.slice(0, Math.min(500, available))
      : null;
    observationCharacters += userObservation?.length ?? 0;
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
        userObservation,
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
  const recoveryEvidence = buildRecoveryEvidence({
    from: contextFrom,
    through: contextThrough,
    records: wellnessRows.flatMap((row) => {
      const parsed = garminWellnessEvidenceSchema.safeParse(
        row.document.payload,
      );
      if (!parsed.success || parsed.data.localDate !== row.localDate) return [];
      return [
        {
          localDate: row.localDate,
          sleepStatus: parsed.data.sleep.status,
          sleepTotalSeconds: parsed.data.sleep.totalSleepSeconds,
          sleepScore: parsed.data.sleep.sleepScore,
          stepsStatus: parsed.data.steps.status,
          totalSteps: parsed.data.steps.totalSteps,
        },
      ];
    }),
  });
  const observedTrainingEvidence =
    projectObservedTrainingEvidence(externalTrainingRows);
  const coverageKind = (provider: string) => {
    if (provider === "garmin" || provider === "garmin_activity_history") {
      return "garminActivity" as const;
    }
    if (
      provider === "garmin_wellness" ||
      provider === "garmin_wellness_history"
    ) {
      return "garminWellness" as const;
    }
    return "xunjiTraining" as const;
  };
  const coverage = new Map<
    string,
    {
      localDate: string;
      garminActivity: "records" | "empty" | "failed" | "unknown";
      garminWellness: "records" | "empty" | "failed" | "unknown";
      xunjiTraining: "records" | "empty" | "failed" | "unknown";
      updated: Partial<
        Record<"garminActivity" | "garminWellness" | "xunjiTraining", number>
      >;
    }
  >();
  for (
    let date = contextFrom;
    date <= contextThrough;
    date = shiftDate(date, 1)
  ) {
    coverage.set(date, {
      localDate: date,
      garminActivity: "unknown",
      garminWellness: "unknown",
      xunjiTraining: "unknown",
      updated: {},
    });
  }
  for (const row of coverageRows) {
    const item = coverage.get(row.localDate);
    if (!item) continue;
    const kind = coverageKind(row.provider);
    const updated = row.updatedAt.valueOf();
    if ((item.updated[kind] ?? Number.NEGATIVE_INFINITY) > updated) continue;
    item.updated[kind] = updated;
    item[kind] =
      row.status === "failed"
        ? "failed"
        : row.status === "succeeded"
          ? row.recordCount > 0
            ? "records"
            : "empty"
          : "unknown";
  }
  const evidenceCoverage = [...coverage.values()].map((item) => ({
    localDate: item.localDate,
    garminActivity: item.garminActivity,
    garminWellness: item.garminWellness,
    xunjiTraining: item.xunjiTraining,
  }));
  const safetyLevel = mostSevere(recentFeedback);
  const profile = profileRows[0]
    ? {
        version: profileRows[0].version,
        document: rehabProfileDocumentSchema.parse(profileRows[0].document),
      }
    : null;
  const memories = memoryRows.map((memory) => ({
    category: assistantMemoryCategorySchema.parse(memory.category),
    content: memory.content.slice(0, 500),
  }));
  const sourceTurn = sourceTurnRows[0];
  const sourceConversation = sourceTurn
    ? {
        userMessage: sourceTurn.message.slice(0, 4_000),
        assistantReply: assistantTurnResponseSchema
          .parse(sourceTurn.response)
          .reply.slice(0, 4_000),
      }
    : null;
  const modelContext: PlanAdjustmentContext = {
    currentPlan,
    timelineHeadPlanVersionId: head.id,
    planningTimeZone: tracker.planningTimeZone,
    range: { from: contextFrom, through: contextThrough },
    recentFeedback,
    confirmedTraining,
    observedTrainingEvidence,
    evidenceCoverage,
    recoveryEvidence,
    rehabProfile: profile,
    assistantMemories: memories,
    sourceConversation,
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
    contextVersion: "3",
    contextHash: contentHash(modelContext),
    contextRevision: tracker.aiContextRevision,
    contextFrom,
    contextThrough,
    safetyLevel,
    sourceAssistantTurnId,
  };
}
