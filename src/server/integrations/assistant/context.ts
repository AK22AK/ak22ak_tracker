import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";

import type { AssistantAssociation } from "@/domain/rehab-assistant";
import {
  assistantAssociationForModel,
  assistantAssociationSchema,
  assistantTurnResponseSchema,
  rehabProfileDocumentSchema,
} from "@/domain/rehab-assistant";
import { getDayAggregate } from "@/server/aggregates/tracker";
import { getDatabase } from "@/server/db/client";
import {
  assistantMemories,
  assistantTurns,
  rehabProfiles,
} from "@/server/db/schema";
import { contentHash } from "@/server/integrations/core/content-hash";
import {
  prepareAiAnalysisContext,
  type PreparedAiAnalysisContext,
} from "@/server/integrations/ai/context";

type Database = ReturnType<typeof getDatabase>;

function sanitizeExternalRecord(
  record: Awaited<
    ReturnType<typeof getDayAggregate>
  >["day"]["externalTrainingRecords"][number],
) {
  if (record.provider === "garmin") {
    return {
      provider: "garmin" as const,
      kind: "activity" as const,
      localDate: record.localDate,
      occurredAt: record.occurredAt,
      activityType: record.details.activityType,
      durationSeconds: record.details.durationSeconds,
      distanceMeters: record.details.distanceMeters,
      averagePaceSecondsPerKilometer:
        record.details.averagePaceSecondsPerKilometer,
      averageHeartRateBpm: record.details.averageHeartRateBpm,
    };
  }
  return {
    provider: "xunji" as const,
    kind: "strength_training" as const,
    localDate: record.localDate,
    occurredAt: record.occurredAt,
    durationSeconds: record.details.durationSeconds,
    movements: record.details.movements.map((movement) => ({
      name: movement.name,
      sets: movement.sets
        .filter((set) => set.completed === true)
        .map((set) => ({
          weight: set.weight,
          unit: set.unit,
          reps: set.reps,
          duration: set.duration,
          durationUnit: set.durationUnit,
          selfWeight: set.selfWeight,
          rpe: set.rpe,
          restSeconds: set.restSeconds,
        })),
    })),
  };
}

async function attachedDateEvidence(
  trackerKey: string,
  association: AssistantAssociation,
) {
  if (association.kind === "auto") return null;
  const day = await getDayAggregate(trackerKey, association.localDate);
  const tasks =
    association.kind === "task"
      ? day.day.tasks.filter((task) => task.id === association.taskInstanceId)
      : day.day.tasks;
  const externalTrainingRecords =
    association.kind === "activity"
      ? day.day.externalTrainingRecords.filter(
          (record) => record.id === association.externalRecordId,
        )
      : day.day.externalTrainingRecords;
  return {
    localDate: day.targetDate,
    tasks: tasks.map((task) => ({
      title: task.title,
      category: task.category,
      status: task.status,
      actual: task.actual
        ? {
            durationMinutes: task.actual.durationMinutes,
            distanceKm: task.actual.distanceKm,
          }
        : null,
    })),
    feedback: day.day.feedbacks.map((feedback) => ({
      timing: feedback.timing,
      leftPain: feedback.leftPain,
      rightPain: feedback.rightPain,
      swelling: feedback.swelling,
      safetyLevel: feedback.safetyLevel,
      userObservation: feedback.note.slice(0, 500),
    })),
    externalTraining: externalTrainingRecords.map(sanitizeExternalRecord),
    recoveryReference: day.day.recoveryReference ?? null,
  };
}

export async function loadAssistantHistoryRange(
  trackerKey: string,
  range: { from: string; through: string },
) {
  const days = [];
  for (
    let value = range.from;
    value <= range.through;
    value = new Date(new Date(`${value}T00:00:00.000Z`).valueOf() + 86_400_000)
      .toISOString()
      .slice(0, 10)
  ) {
    days.push(
      await attachedDateEvidence(trackerKey, {
        kind: "date",
        localDate: value,
      }),
    );
  }
  return days;
}

export type PreparedAssistantContext = {
  base: PreparedAiAnalysisContext;
  modelContext: {
    currentPlan: PreparedAiAnalysisContext["modelContext"];
    rehabProfile: ReturnType<typeof rehabProfileDocumentSchema.parse> | null;
    memories: Array<{ category: string; content: string }>;
    recentConversation: Array<{
      message: string;
      reply: string | null;
      createdAt: string;
    }>;
    requestedAssociation: ReturnType<typeof assistantAssociationForModel>;
    attachedDateEvidence: Awaited<ReturnType<typeof attachedDateEvidence>>;
  };
  contextVersion: "3";
  contextHash: string;
  profileVersion: number | null;
  memoryHash: string;
};

export class AssistantFutureDateError extends Error {
  constructor() {
    super("future_date_not_allowed");
    this.name = "AssistantFutureDateError";
  }
}

export async function prepareAssistantContext({
  trackerKey,
  association,
  now = new Date(),
  database = getDatabase(),
}: {
  trackerKey: string;
  association: AssistantAssociation;
  now?: Date;
  database?: Database;
}): Promise<PreparedAssistantContext> {
  const parsedAssociation = assistantAssociationSchema.parse(association);
  const base = await prepareAiAnalysisContext({ trackerKey, now, database });
  if (
    parsedAssociation.kind !== "auto" &&
    parsedAssociation.localDate > base.contextThrough
  ) {
    throw new AssistantFutureDateError();
  }
  const [profileRows, memoryRows, turnRows, attached] = await Promise.all([
    database
      .select({
        version: rehabProfiles.version,
        document: rehabProfiles.document,
      })
      .from(rehabProfiles)
      .where(
        and(
          eq(rehabProfiles.trackerId, base.trackerId),
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
          eq(assistantMemories.trackerId, base.trackerId),
          eq(assistantMemories.status, "active"),
        ),
      )
      .orderBy(asc(assistantMemories.createdAt))
      .limit(100),
    database
      .select({
        message: assistantTurns.message,
        response: assistantTurns.response,
        createdAt: assistantTurns.createdAt,
      })
      .from(assistantTurns)
      .where(
        and(
          eq(assistantTurns.trackerId, base.trackerId),
          eq(assistantTurns.status, "succeeded"),
        ),
      )
      .orderBy(desc(assistantTurns.createdAt))
      .limit(20),
    attachedDateEvidence(trackerKey, parsedAssociation),
  ]);
  const profileRow = profileRows[0];
  const rehabProfile = profileRow
    ? rehabProfileDocumentSchema.parse(profileRow.document)
    : null;
  const recentConversation = turnRows.reverse().map((turn) => ({
    message: turn.message.slice(0, 4_000),
    reply: turn.response
      ? assistantTurnResponseSchema.parse(turn.response).reply.slice(0, 4_000)
      : null,
    createdAt: turn.createdAt.toISOString(),
  }));
  const memoryHash = contentHash(memoryRows);
  const modelContext = {
    currentPlan: base.modelContext,
    rehabProfile,
    memories: memoryRows,
    recentConversation,
    requestedAssociation: assistantAssociationForModel(parsedAssociation),
    attachedDateEvidence: attached,
  };
  return {
    base,
    modelContext,
    contextVersion: "3",
    contextHash: contentHash(modelContext),
    profileVersion: profileRow?.version ?? null,
    memoryHash,
  };
}
