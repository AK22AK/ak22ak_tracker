// @vitest-environment node

import { randomUUID } from "node:crypto";

import Dexie from "dexie";
import { eq, inArray } from "drizzle-orm";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schemaVersion } from "@/domain/schemas";
import { enqueuePendingCommand } from "@/offline/pending-commands";
import { prepareOfflineIdentity } from "@/offline/query-snapshots";
import { replayPendingCommands } from "@/offline/replay";
import { createOfflineDatabase } from "@/offline/store";
import { createNeonTaskCommandStore } from "@/server/commands/task-command";
import { executeTaskCommand } from "@/server/commands/task-command-core";
import { getDatabase } from "@/server/db/client";
import {
  events,
  githubSyncOutbox,
  planVersions,
  taskInstances,
  trackers,
} from "@/server/db/schema";

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("P2b-1 Neon ordered replay integration", () => {
  const trackerId = randomUUID();
  const trackerKey = `anonymous-${randomUUID()}`;
  const planVersionId = randomUUID();
  const taskId = randomUUID();
  const commandIds = [randomUUID(), randomUUID()];
  const offline = createOfflineDatabase(`p2b-neon-${randomUUID()}`);

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const database = getDatabase();
    await database.insert(trackers).values({
      id: trackerId,
      key: trackerKey,
      name: "Anonymous Tracker",
      module: "anonymous",
      startedOn: "2026-07-20",
      planningTimeZone: "Asia/Shanghai",
    });
    await database.insert(planVersions).values({
      id: planVersionId,
      trackerId,
      version: 1,
      effectiveFrom: "2026-07-20",
      document: {
        schemaVersion,
        id: planVersionId,
        trackerKey,
        version: 1,
        effectiveFrom: "2026-07-20",
        createdAt: "2026-07-20T00:00:00.000Z",
        createdBy: "import",
        tasks: [],
      },
    });
    await database.insert(taskInstances).values({
      id: taskId,
      trackerId,
      planVersionId,
      taskDefinitionId: "anonymous-task",
      scheduledOn: "2026-07-20",
    });
    await prepareOfflineIdentity(offline, "10001");
  });

  afterAll(async () => {
    const database = getDatabase();
    await database
      .delete(githubSyncOutbox)
      .where(inArray(githubSyncOutbox.aggregateId, commandIds));
    await database.delete(events).where(eq(events.trackerId, trackerId));
    await database.delete(trackers).where(eq(trackers.id, trackerId));
    await offline.delete();
  });

  it("applies task commands in creation order and keeps server replay idempotent", async () => {
    const statuses = ["completed", "planned"] as const;
    for (const [index, status] of statuses.entries()) {
      await enqueuePendingCommand(offline, {
        id: commandIds[index]!,
        githubUserId: "10001",
        trackerKey,
        kind: "task_update",
        createdAt: `2026-07-20T10:0${index}:00.000Z`,
        occurredAt: `2026-07-20T10:0${index}:00.000Z`,
        localDate: "2026-07-20",
        occurredTimeZone: "Asia/Shanghai",
        occurredUtcOffsetMinutes: 480,
        payload: {
          taskId,
          status,
          actual: null,
          note: `Anonymous ordered command ${index + 1}`,
          baseStatus: index === 0 ? "planned" : "completed",
          planVersion: 1,
        },
      });
    }

    const store = createNeonTaskCommandStore();
    const sent: string[] = [];
    const replay = await replayPendingCommands(offline, {
      githubUserId: "10001",
      trackerKey,
      ownerId: "anonymous-integration-page",
      now: () => new Date("2026-07-20T10:03:00.000Z"),
      send: async (command) => {
        expect(command.kind).toBe("task_update");
        if (command.kind !== "task_update") throw new Error("unexpected_kind");
        sent.push(command.id);
        const result = await executeTaskCommand(store, {
          commandId: command.id,
          taskId: command.payload.taskId,
          status: command.payload.status,
          actual: command.payload.actual,
          note: command.payload.note,
          occurredAt: command.occurredAt,
          occurredTimeZone: command.occurredTimeZone,
          occurredUtcOffsetMinutes: command.occurredUtcOffsetMinutes,
        });
        return { kind: "task_update", ...result };
      },
    });

    const database = getDatabase();
    const [task] = await database
      .select({ status: taskInstances.status })
      .from(taskInstances)
      .where(eq(taskInstances.id, taskId));
    const eventRows = await database
      .select({ id: events.id })
      .from(events)
      .where(inArray(events.idempotencyKey, commandIds));
    const outboxRows = await database
      .select({ id: githubSyncOutbox.id })
      .from(githubSyncOutbox)
      .where(inArray(githubSyncOutbox.aggregateId, commandIds));

    expect(replay).toMatchObject({ sent: 2, succeeded: 2, failed: 0 });
    expect(sent).toEqual(commandIds);
    expect(task?.status).toBe("planned");
    expect(eventRows).toHaveLength(2);
    expect(outboxRows).toHaveLength(2);
    expect(await offline.pendingCommands.count()).toBe(0);

    const historicalReplay = await executeTaskCommand(store, {
      commandId: commandIds[0]!,
      taskId,
      status: "completed",
      actual: null,
      note: "Anonymous ordered command 1",
      occurredAt: "2026-07-20T10:00:00.000Z",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
    });
    const [unchangedTask] = await database
      .select({ status: taskInstances.status })
      .from(taskInstances)
      .where(eq(taskInstances.id, taskId));

    expect(historicalReplay.replayed).toBe(true);
    expect(unchangedTask?.status).toBe("planned");
  });
});
