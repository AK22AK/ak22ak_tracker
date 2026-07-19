import "server-only";

import { and, desc, eq, lte } from "drizzle-orm";

import { trackerEventSchema } from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import {
  events,
  externalRecordLinks,
  externalRecords,
  githubSyncOutbox,
  planVersions,
  taskInstances,
  trackers,
} from "@/server/db/schema";

import type { ExternalRecordAssociationCommandStore } from "./external-record-association-core";

type Database = ReturnType<typeof getDatabase>;

export function createNeonExternalRecordAssociationStore(
  database: Database = getDatabase(),
): ExternalRecordAssociationCommandStore {
  return {
    async findRecord(trackerKey, externalRecordId) {
      const [record] = await database
        .select({
          id: externalRecords.id,
          trackerId: externalRecords.trackerId,
          trackerKey: trackers.key,
          planningTimeZone: trackers.planningTimeZone,
          localDate: externalRecords.localDate,
          provider: externalRecords.provider,
          sourceVersion: externalRecords.sourceVersion,
        })
        .from(externalRecords)
        .innerJoin(trackers, eq(externalRecords.trackerId, trackers.id))
        .where(
          and(
            eq(externalRecords.id, externalRecordId),
            eq(trackers.key, trackerKey),
            eq(trackers.active, true),
          ),
        )
        .limit(1);
      if (
        !record ||
        (record.provider !== "xunji" && record.provider !== "garmin")
      ) {
        return null;
      }
      return {
        ...record,
        provider: record.provider,
      };
    },

    async findTaskForRecord(record, taskId) {
      const [effectivePlan] = await database
        .select({ id: planVersions.id })
        .from(planVersions)
        .where(
          and(
            eq(planVersions.trackerId, record.trackerId),
            lte(planVersions.effectiveFrom, record.localDate),
          ),
        )
        .orderBy(desc(planVersions.effectiveFrom), desc(planVersions.version))
        .limit(1);
      if (!effectivePlan) return null;

      const [task] = await database
        .select({ id: taskInstances.id })
        .from(taskInstances)
        .where(
          and(
            eq(taskInstances.id, taskId),
            eq(taskInstances.trackerId, record.trackerId),
            eq(taskInstances.planVersionId, effectivePlan.id),
            eq(taskInstances.scheduledOn, record.localDate),
          ),
        )
        .limit(1);
      return task ?? null;
    },

    async findEventByCommandId(commandId) {
      const [row] = await database
        .select({ document: events.document })
        .from(events)
        .where(eq(events.idempotencyKey, commandId))
        .limit(1);
      return row ? trackerEventSchema.parse(row.document) : null;
    },

    async commitAtomically(command) {
      const linkStatus =
        command.association.status === "confirmed" ? "confirmed" : "rejected";
      await database.batch([
        database
          .insert(externalRecordLinks)
          .values({
            externalRecordId: command.association.externalRecordId,
            taskInstanceId: command.association.taskId,
            status: linkStatus,
            confirmedAt: command.association.confirmedAt,
            sourceVersion: command.association.sourceVersion,
            needsReview: command.association.needsReview,
          })
          .onConflictDoUpdate({
            target: externalRecordLinks.externalRecordId,
            set: {
              taskInstanceId: command.association.taskId,
              status: linkStatus,
              confirmedAt: command.association.confirmedAt,
              sourceVersion: command.association.sourceVersion,
              needsReview: command.association.needsReview,
            },
          }),
        database.insert(events).values({
          id: command.event.id,
          trackerId: command.trackerId,
          kind: command.event.kind,
          localDate: command.event.localDate,
          occurredAt: new Date(command.event.occurredAt),
          recordedAt: new Date(command.event.recordedAt),
          occurredTimeZone: command.event.occurredTimeZone,
          occurredUtcOffsetMinutes: command.event.occurredUtcOffsetMinutes,
          idempotencyKey: command.event.idempotencyKey,
          document: command.event,
        }),
        database.insert(githubSyncOutbox).values(command.outbox),
      ]);
    },
  };
}
