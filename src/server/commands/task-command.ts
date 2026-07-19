import "server-only";

import { and, eq } from "drizzle-orm";

import { trackerEventSchema } from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import {
  events,
  githubSyncOutbox,
  taskInstances,
  trackers,
} from "@/server/db/schema";

import type { TaskCommandStore } from "./task-command-core";

type Database = ReturnType<typeof getDatabase>;

export function createNeonTaskCommandStore(
  database: Database = getDatabase(),
): TaskCommandStore {
  return {
    async findTask(taskId) {
      const [task] = await database
        .select({
          id: taskInstances.id,
          trackerId: taskInstances.trackerId,
          trackerKey: trackers.key,
          planningTimeZone: trackers.planningTimeZone,
        })
        .from(taskInstances)
        .innerJoin(trackers, eq(taskInstances.trackerId, trackers.id))
        .where(and(eq(taskInstances.id, taskId), eq(trackers.active, true)))
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
      await database.batch([
        database
          .update(taskInstances)
          .set({
            status: command.taskUpdate.status,
            completedAt: command.taskUpdate.completedAt,
            confirmedByUser: command.taskUpdate.status !== "planned",
            actualData: command.taskUpdate.actual,
            subjectiveNote: command.taskUpdate.note,
          })
          .where(eq(taskInstances.id, command.taskUpdate.taskId)),
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
