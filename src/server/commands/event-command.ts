import "server-only";

import { and, eq } from "drizzle-orm";

import { trackerEventSchema } from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import { events, githubSyncOutbox, trackers } from "@/server/db/schema";

import type { EventCommandStore } from "./event-command-core";

type Database = ReturnType<typeof getDatabase>;

export function createNeonEventCommandStore(
  database: Database = getDatabase(),
): EventCommandStore {
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

    async commitAtomically(command) {
      await database.batch([
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
