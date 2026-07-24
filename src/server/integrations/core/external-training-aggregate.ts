import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import {
  externalTrainingRecordSchema,
  type ExternalRecordAssociation,
  type ExternalTrainingRecord,
} from "@/domain/external-training";
import { garminActivitySummarySchema } from "@/domain/garmin";
import { getDatabase } from "@/server/db/client";
import { externalRecordLinks, externalRecords } from "@/server/db/schema";
import type { DashboardTask } from "@/server/dashboard";
import { projectXunjiTrainingDetails } from "@/server/integrations/xunji/display";

import {
  suggestGarminActivityTask,
  suggestTrainingTask,
} from "./task-link-suggestion";

type Database = ReturnType<typeof getDatabase>;

function publicAssociation(row: {
  linkStatus: "suggested" | "confirmed" | "rejected" | null;
  linkTaskId: string | null;
  linkSourceVersion: number | null;
  linkNeedsReview: boolean | null;
}): ExternalRecordAssociation | null {
  if (!row.linkStatus || !row.linkSourceVersion) return null;
  return {
    status:
      row.linkStatus === "rejected" && row.linkTaskId === null
        ? "unrelated"
        : row.linkStatus,
    taskId: row.linkTaskId,
    sourceVersion: row.linkSourceVersion,
    needsReview: row.linkNeedsReview ?? false,
  };
}

export async function getExternalTrainingRecordsForDay(input: {
  trackerId: string;
  localDate: string;
  tasks: DashboardTask[] | Promise<DashboardTask[]>;
  database?: Database;
}): Promise<ExternalTrainingRecord[]> {
  const database = input.database ?? getDatabase();
  const rowsPromise = database
    .select({
      id: externalRecords.id,
      provider: externalRecords.provider,
      localDate: externalRecords.localDate,
      occurredAt: externalRecords.occurredAt,
      sourceVersion: externalRecords.sourceVersion,
      document: externalRecords.document,
      linkStatus: externalRecordLinks.status,
      linkTaskId: externalRecordLinks.taskInstanceId,
      linkSourceVersion: externalRecordLinks.sourceVersion,
      linkNeedsReview: externalRecordLinks.needsReview,
    })
    .from(externalRecords)
    .leftJoin(
      externalRecordLinks,
      eq(externalRecordLinks.externalRecordId, externalRecords.id),
    )
    .where(
      and(
        eq(externalRecords.trackerId, input.trackerId),
        eq(externalRecords.localDate, input.localDate),
        inArray(externalRecords.kind, ["strength_training", "activity"]),
      ),
    )
    .orderBy(asc(externalRecords.occurredAt));

  const [rows, tasks] = await Promise.all([rowsPromise, input.tasks]);

  const candidateTasks = tasks.map((task) => ({
    id: task.id,
    title: task.title,
    category: task.category,
    scheduledOn: input.localDate,
    prescription: task.prescription,
  }));

  return rows.flatMap((row): ExternalTrainingRecord[] => {
    try {
      const association = publicAssociation(row);
      if (row.provider === "xunji") {
        const details = projectXunjiTrainingDetails(row.document.payload);
        const suggestion =
          association && !association.needsReview
            ? null
            : suggestTrainingTask(
                { localDate: row.localDate, details },
                candidateTasks,
              );
        return [
          externalTrainingRecordSchema.parse({
            id: row.id,
            provider: "xunji",
            localDate: row.localDate,
            occurredAt: row.occurredAt.toISOString(),
            sourceVersion: row.sourceVersion,
            details,
            association,
            suggestion,
          }),
        ];
      }
      if (row.provider !== "garmin") return [];
      const activity = garminActivitySummarySchema.parse(row.document.payload);
      const details = { kind: "activity" as const, ...activity };
      const suggestion =
        association && !association.needsReview
          ? null
          : suggestGarminActivityTask(
              {
                localDate: row.localDate,
                activityType: details.activityType,
              },
              candidateTasks,
            );
      return [
        externalTrainingRecordSchema.parse({
          id: row.id,
          provider: "garmin",
          localDate: row.localDate,
          occurredAt: row.occurredAt.toISOString(),
          sourceVersion: row.sourceVersion,
          details,
          association,
          suggestion,
        }),
      ];
    } catch {
      return [];
    }
  });
}
