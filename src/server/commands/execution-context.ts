import "server-only";

import { and, eq, gte, isNull, lte } from "drizzle-orm";

import { executionAlternativeDocumentSchema } from "@/domain/execution-context";
import { trackerEventSchema } from "@/domain/schemas";
import { kneeCheckInEventPayloadSchema } from "@/modules/knee-rehab/check-in";
import { getDatabase } from "@/server/db/client";
import {
  events,
  executionAlternativeVersions,
  executionContexts,
  executionDayDecisions,
  executionPauses,
  githubSyncOutbox,
  trackers,
} from "@/server/db/schema";

import type { ExecutionContextCommandStore } from "./execution-context-core";

type Database = ReturnType<typeof getDatabase>;

export function createNeonExecutionContextCommandStore(
  database: Database = getDatabase(),
): ExecutionContextCommandStore {
  return {
    async findTracker(key) {
      const [tracker] = await database
        .select({
          id: trackers.id,
          key: trackers.key,
          planningTimeZone: trackers.planningTimeZone,
        })
        .from(trackers)
        .where(and(eq(trackers.key, key), eq(trackers.active, true)))
        .limit(1);
      return tracker ?? null;
    },

    async findEventByCommandId(commandId) {
      const [row] = await database
        .select({ document: events.document })
        .from(events)
        .where(eq(events.idempotencyKey, commandId))
        .limit(1);
      return row ? trackerEventSchema.parse(row.document) : null;
    },

    async findContext(trackerId, contextId) {
      const [row] = await database
        .select({
          id: executionContexts.id,
          trackerId: executionContexts.trackerId,
          trackerKey: trackers.key,
          planningTimeZone: trackers.planningTimeZone,
          kind: executionContexts.kind,
          startDate: executionContexts.startDate,
          endDate: executionContexts.endDate,
          endedOn: executionContexts.endedOn,
        })
        .from(executionContexts)
        .innerJoin(trackers, eq(executionContexts.trackerId, trackers.id))
        .where(
          and(
            eq(executionContexts.id, contextId),
            eq(executionContexts.trackerId, trackerId),
            eq(trackers.active, true),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async findOverlappingContext(trackerId, startDate, endDate) {
      const [row] = await database
        .select({
          id: executionContexts.id,
          trackerId: executionContexts.trackerId,
          trackerKey: trackers.key,
          planningTimeZone: trackers.planningTimeZone,
          kind: executionContexts.kind,
          startDate: executionContexts.startDate,
          endDate: executionContexts.endDate,
          endedOn: executionContexts.endedOn,
        })
        .from(executionContexts)
        .innerJoin(trackers, eq(executionContexts.trackerId, trackers.id))
        .where(
          and(
            eq(executionContexts.trackerId, trackerId),
            eq(trackers.active, true),
            isNull(executionContexts.endedAt),
            lte(executionContexts.startDate, endDate),
            gte(executionContexts.endDate, startDate),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async findAlternative(trackerId, optionId, targetDate) {
      const [row] = await database
        .select({
          id: executionAlternativeVersions.id,
          version: executionAlternativeVersions.version,
          effectiveFrom: executionAlternativeVersions.effectiveFrom,
          document: executionAlternativeVersions.document,
        })
        .from(executionAlternativeVersions)
        .where(
          and(
            eq(executionAlternativeVersions.id, optionId),
            eq(executionAlternativeVersions.trackerId, trackerId),
            lte(executionAlternativeVersions.effectiveFrom, targetDate),
          ),
        )
        .limit(1);
      if (!row) return null;
      const document = executionAlternativeDocumentSchema.parse(row.document);
      return {
        id: row.id,
        version: document.version,
        effectiveFrom: document.effectiveFrom,
      };
    },

    async hasRedSafetySignal(trackerId, localDate) {
      const rows = await database
        .select({ document: events.document })
        .from(events)
        .where(
          and(
            eq(events.trackerId, trackerId),
            eq(events.localDate, localDate),
            eq(events.kind, "symptom_check_in"),
          ),
        );
      return rows.some((row) => {
        const parsed = kneeCheckInEventPayloadSchema.safeParse(
          row.document.payload,
        );
        return parsed.success && parsed.data.safetyLevel === "red";
      });
    },

    async findActivePause(trackerId) {
      const [row] = await database
        .select({
          id: executionPauses.id,
          trackerId: executionPauses.trackerId,
          reason: executionPauses.reason,
          note: executionPauses.note,
          startedOn: executionPauses.startedOn,
          endedOn: executionPauses.endedOn,
        })
        .from(executionPauses)
        .where(
          and(
            eq(executionPauses.trackerId, trackerId),
            isNull(executionPauses.endedAt),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async findPause(trackerId, pauseId) {
      const [row] = await database
        .select({
          id: executionPauses.id,
          trackerId: executionPauses.trackerId,
          reason: executionPauses.reason,
          note: executionPauses.note,
          startedOn: executionPauses.startedOn,
          endedOn: executionPauses.endedOn,
        })
        .from(executionPauses)
        .where(
          and(
            eq(executionPauses.id, pauseId),
            eq(executionPauses.trackerId, trackerId),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async hasBlockingPause(trackerId, localDate) {
      const [row] = await database
        .select({ id: executionPauses.id })
        .from(executionPauses)
        .where(
          and(
            eq(executionPauses.trackerId, trackerId),
            lte(executionPauses.startedOn, localDate),
          ),
        )
        .limit(1);
      return Boolean(row);
    },

    async commitAtomically(command) {
      const eventInsert = database.insert(events).values({
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
      });
      const outboxInsert = database
        .insert(githubSyncOutbox)
        .values(command.outbox);

      if (command.type === "create") {
        await database.batch([
          database.insert(executionContexts).values({
            id: command.context.id,
            trackerId: command.trackerId,
            kind: command.context.kind,
            startDate: command.context.startDate,
            endDate: command.context.endDate,
          }),
          eventInsert,
          outboxInsert,
        ]);
        return;
      }

      if (command.type === "end") {
        await database.batch([
          database
            .update(executionContexts)
            .set({
              endedOn: command.endedOn,
              endedAt: command.endedAt,
              updatedAt: new Date(),
            })
            .where(eq(executionContexts.id, command.contextId)),
          eventInsert,
          outboxInsert,
        ]);
        return;
      }

      if (command.type === "start_pause") {
        await database.batch([
          database.insert(executionPauses).values({
            id: command.pause.id,
            trackerId: command.trackerId,
            reason: command.pause.reason,
            note: command.pause.note,
            startedOn: command.pause.startedOn,
          }),
          eventInsert,
          outboxInsert,
        ]);
        return;
      }

      if (command.type === "end_pause") {
        await database.batch([
          database
            .update(executionPauses)
            .set({
              endedOn: command.endedOn,
              endedAt: command.endedAt,
              updatedAt: new Date(),
            })
            .where(eq(executionPauses.id, command.pauseId)),
          eventInsert,
          outboxInsert,
        ]);
        return;
      }

      await database.batch([
        database
          .insert(executionDayDecisions)
          .values({
            trackerId: command.trackerId,
            contextId: command.contextId,
            localDate: command.localDate,
            conditions: command.conditions,
            selectedAlternativeId: command.selection?.optionId ?? null,
            selectedAlternativeVersion:
              command.selection?.optionVersion ?? null,
            safetyDisposition: command.safetyDisposition,
            decidedAt: command.decidedAt,
          })
          .onConflictDoUpdate({
            target: [
              executionDayDecisions.contextId,
              executionDayDecisions.localDate,
            ],
            set: {
              conditions: command.conditions,
              selectedAlternativeId: command.selection?.optionId ?? null,
              selectedAlternativeVersion:
                command.selection?.optionVersion ?? null,
              safetyDisposition: command.safetyDisposition,
              decidedAt: command.decidedAt,
              updatedAt: new Date(),
            },
          }),
        eventInsert,
        outboxInsert,
      ]);
    },
  };
}
