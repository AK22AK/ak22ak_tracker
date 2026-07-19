import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schemaVersion } from "@/domain/schemas";
import { createNeonTaskCommandStore } from "@/server/commands/task-command";
import {
  executeTaskCommand,
  type PreparedTaskCommand,
} from "@/server/commands/task-command-core";
import { getDatabase } from "@/server/db/client";
import {
  events,
  githubSyncOutbox,
  planVersions,
  taskInstances,
  trackers,
} from "@/server/db/schema";
import { getTodayDashboard } from "@/server/dashboard";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("P0a Neon atomic command integration", () => {
  const trackerId = randomUUID();
  const planVersionId = randomUUID();
  const planVersion2Id = randomUUID();
  const taskId = randomUUID();
  const commandId = randomUUID();
  const trackerKey = `anonymous-${randomUUID()}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const database = getDatabase();
    await database.insert(trackers).values({
      id: trackerId,
      key: trackerKey,
      name: "Anonymous Tracker",
      module: "anonymous",
      startedOn: "2026-07-18",
      planningTimeZone: "Asia/Shanghai",
    });
    await database.insert(planVersions).values({
      id: planVersionId,
      trackerId,
      version: 1,
      effectiveFrom: "2026-07-18",
      document: {
        schemaVersion,
        id: planVersionId,
        trackerKey,
        version: 1,
        effectiveFrom: "2026-07-18",
        createdAt: "2026-07-18T00:00:00.000Z",
        createdBy: "import",
        tasks: [],
      },
    });
    await database.insert(planVersions).values({
      id: planVersion2Id,
      trackerId,
      version: 2,
      effectiveFrom: "2026-07-20",
      document: {
        schemaVersion,
        id: planVersion2Id,
        trackerKey,
        version: 2,
        effectiveFrom: "2026-07-20",
        createdAt: "2026-07-20T00:00:00.000Z",
        createdBy: "user",
        tasks: [],
      },
    });
    await database.insert(taskInstances).values({
      id: taskId,
      trackerId,
      planVersionId,
      taskDefinitionId: "anonymous-task",
      scheduledOn: "2026-07-19",
    });
  });

  it("resolves the effective version at each target date", async () => {
    await expect(
      getTodayDashboard(trackerKey, "2026-07-17"),
    ).resolves.toMatchObject({ state: "not_started", planVersion: null });
    await expect(
      getTodayDashboard(trackerKey, "2026-07-19"),
    ).resolves.toMatchObject({ state: "ready", planVersion: 1 });
    await expect(
      getTodayDashboard(trackerKey, "2026-07-20"),
    ).resolves.toMatchObject({ state: "ready", planVersion: 2 });
  });

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    const database = getDatabase();
    await database
      .delete(githubSyncOutbox)
      .where(eq(githubSyncOutbox.aggregateId, commandId));
    await database.delete(trackers).where(eq(trackers.id, trackerId));
  });

  it("commits once without an external service and replays canonically (P0-02/03/10)", async () => {
    const store = createNeonTaskCommandStore();
    const commandInput = {
      commandId,
      taskId,
      status: "completed" as const,
      actual: null,
      note: "anonymous integration record",
      occurredAt: "2026-07-18T16:00:00.000Z",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
    };

    const first = await executeTaskCommand(store, commandInput);
    const replay = await executeTaskCommand(store, commandInput);
    const database = getDatabase();
    const [task] = await database
      .select({ status: taskInstances.status })
      .from(taskInstances)
      .where(eq(taskInstances.id, taskId));
    const eventRows = await database
      .select({ id: events.id })
      .from(events)
      .where(eq(events.idempotencyKey, commandId));
    const outboxRows = await database
      .select({ id: githubSyncOutbox.id })
      .from(githubSyncOutbox)
      .where(
        and(
          eq(githubSyncOutbox.aggregateType, "event"),
          eq(githubSyncOutbox.aggregateId, commandId),
        ),
      );

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(task?.status).toBe("completed");
    expect(eventRows).toHaveLength(1);
    expect(outboxRows).toHaveLength(1);
  });

  it("rolls back the projection when a later statement in the batch fails", async () => {
    const store = createNeonTaskCommandStore();
    const existing = await store.findEventByCommandId(commandId);
    expect(existing).not.toBeNull();
    const conflictingBatch: PreparedTaskCommand = {
      trackerId,
      taskUpdate: {
        taskId,
        status: "skipped",
        actual: null,
        note: "must roll back",
        completedAt: null,
      },
      event: existing!,
      outbox: {
        aggregateType: "event",
        aggregateId: commandId,
        targetPath: "trackers/anonymous/duplicate.json",
        payload: existing!,
      },
    };

    await expect(
      store.commitAtomically(conflictingBatch),
    ).rejects.toBeDefined();
    const [task] = await getDatabase()
      .select({ status: taskInstances.status })
      .from(taskInstances)
      .where(eq(taskInstances.id, taskId));
    expect(task?.status).toBe("completed");
  });
});
