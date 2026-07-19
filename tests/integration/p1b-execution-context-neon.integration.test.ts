import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schemaVersion } from "@/domain/schemas";
import { createNeonExecutionContextCommandStore } from "@/server/commands/execution-context";
import {
  ExecutionContextSafetyBlockedError,
  executeCreateExecutionContextCommand,
  executeEndExecutionContextCommand,
  executeEndExecutionPauseCommand,
  executeSetExecutionDayCommand,
  executeStartExecutionPauseCommand,
} from "@/server/commands/execution-context-core";
import { getDatabase } from "@/server/db/client";
import {
  events,
  executionAlternativeVersions,
  executionContexts,
  executionDayDecisions,
  executionPauses,
  githubSyncOutbox,
  planVersions,
  taskInstances,
  trackers,
} from "@/server/db/schema";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("P1b S06 execution context atomic integration", () => {
  const trackerId = randomUUID();
  const trackerKey = `anonymous-execution-${randomUUID()}`;
  const planId = randomUUID();
  const taskId = randomUUID();
  const contextId = randomUUID();
  const optionId = randomUUID();
  const commandIds = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const database = getDatabase();
    await database.insert(trackers).values({
      id: trackerId,
      key: trackerKey,
      name: "Anonymous execution tracker",
      module: "anonymous",
      startedOn: "2026-07-01",
      planningTimeZone: "Asia/Shanghai",
    });
    await database.insert(planVersions).values({
      id: planId,
      trackerId,
      version: 1,
      effectiveFrom: "2026-07-01",
      document: {
        schemaVersion,
        id: planId,
        trackerKey,
        version: 1,
        effectiveFrom: "2026-07-01",
        createdAt: "2026-07-01T00:00:00.000Z",
        createdBy: "import",
        tasks: [],
      },
    });
    await database.insert(taskInstances).values({
      id: taskId,
      trackerId,
      planVersionId: planId,
      taskDefinitionId: "anonymous-task",
      scheduledOn: "2026-07-20",
    });
    await database.insert(executionAlternativeVersions).values({
      id: optionId,
      trackerId,
      optionKey: "anonymous-option",
      version: 1,
      effectiveFrom: "2026-07-01",
      document: {
        schemaVersion,
        id: optionId,
        trackerKey,
        optionKey: "anonymous-option",
        version: 1,
        effectiveFrom: "2026-07-01",
        createdAt: "2026-07-01T00:00:00.000Z",
        kind: "alternative",
        title: "Anonymous option",
        summary: "Anonymous summary",
        estimatedMinutes: { min: 10, max: 20 },
        steps: ["Anonymous step"],
      },
    });
  });

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    const database = getDatabase();
    await database
      .delete(githubSyncOutbox)
      .where(inArray(githubSyncOutbox.aggregateId, commandIds));
    await database.delete(trackers).where(eq(trackers.id, trackerId));
  });

  it("creates, selects by day and ends without changing the base plan or task status", async () => {
    const store = createNeonExecutionContextCommandStore();
    const createInput = {
      commandId: commandIds[0]!,
      trackerKey,
      contextId,
      kind: "travel" as const,
      startDate: "2026-07-20",
      endDate: "2026-07-22",
      occurredAt: "2026-07-19T15:00:00.000Z",
      occurredTimeZone: "Europe/Paris",
      occurredUtcOffsetMinutes: 120,
    };
    await expect(
      executeCreateExecutionContextCommand(
        store,
        createInput,
        new Date("2026-07-19T15:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ replayed: false });
    await expect(
      executeCreateExecutionContextCommand(
        store,
        createInput,
        new Date("2026-07-19T15:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ replayed: true });

    await expect(
      getDatabase().insert(executionContexts).values({
        id: randomUUID(),
        trackerId,
        kind: "equipment_limited",
        startDate: "2026-07-22",
        endDate: "2026-07-25",
      }),
    ).rejects.toMatchObject({ cause: { code: "23P01" } });

    await executeSetExecutionDayCommand(store, {
      commandId: commandIds[1]!,
      trackerKey,
      contextId,
      localDate: "2026-07-20",
      conditions: {
        availableMinutes: 18,
        venue: "room",
        equipment: ["chair"],
        healthStatus: "normal",
      },
      selection: { optionId, optionVersion: 1 },
      occurredAt: "2026-07-19T16:30:00.000Z",
      occurredTimeZone: "Europe/Paris",
      occurredUtcOffsetMinutes: 120,
    });
    await executeSetExecutionDayCommand(store, {
      commandId: commandIds[2]!,
      trackerKey,
      contextId,
      localDate: "2026-07-21",
      conditions: {
        availableMinutes: 5,
        venue: "none",
        equipment: ["none"],
        healthStatus: "normal",
      },
      selection: null,
      occurredAt: "2026-07-20T16:30:00.000Z",
      occurredTimeZone: "Europe/Paris",
      occurredUtcOffsetMinutes: 120,
    });
    await getDatabase()
      .insert(githubSyncOutbox)
      .values({
        aggregateType: "event",
        aggregateId: commandIds[4]!,
        targetPath: "trackers/anonymous/preexisting.json",
        payload: { anonymous: true },
      });
    await expect(
      executeSetExecutionDayCommand(store, {
        commandId: commandIds[4]!,
        trackerKey,
        contextId,
        localDate: "2026-07-22",
        conditions: {
          availableMinutes: 10,
          venue: "room",
          equipment: ["none"],
          healthStatus: "normal",
        },
        selection: null,
        occurredAt: "2026-07-21T16:30:00.000Z",
        occurredTimeZone: "Europe/Paris",
        occurredUtcOffsetMinutes: 120,
      }),
    ).rejects.toBeDefined();
    const rolledBackDecision = await getDatabase()
      .select({ id: executionDayDecisions.id })
      .from(executionDayDecisions)
      .where(
        and(
          eq(executionDayDecisions.contextId, contextId),
          eq(executionDayDecisions.localDate, "2026-07-22"),
        ),
      );
    const rolledBackEvent = await getDatabase()
      .select({ id: events.id })
      .from(events)
      .where(eq(events.idempotencyKey, commandIds[4]!));
    expect(rolledBackDecision).toHaveLength(0);
    expect(rolledBackEvent).toHaveLength(0);
    await executeEndExecutionContextCommand(store, {
      commandId: commandIds[3]!,
      trackerKey,
      contextId,
      occurredAt: "2026-07-21T02:00:00.000Z",
      occurredTimeZone: "Europe/Paris",
      occurredUtcOffsetMinutes: 120,
    });

    const database = getDatabase();
    const [context] = await database
      .select()
      .from(executionContexts)
      .where(eq(executionContexts.id, contextId));
    const decisions = await database
      .select()
      .from(executionDayDecisions)
      .where(eq(executionDayDecisions.contextId, contextId));
    const eventRows = await database
      .select({ id: events.id, kind: events.kind })
      .from(events)
      .where(inArray(events.idempotencyKey, commandIds));
    const outboxRows = await database
      .select({ aggregateId: githubSyncOutbox.aggregateId })
      .from(githubSyncOutbox)
      .where(inArray(githubSyncOutbox.aggregateId, commandIds.slice(0, 4)));
    const [task] = await database
      .select({ status: taskInstances.status })
      .from(taskInstances)
      .where(eq(taskInstances.id, taskId));
    const planRows = await database
      .select({ id: planVersions.id })
      .from(planVersions)
      .where(
        and(eq(planVersions.trackerId, trackerId), eq(planVersions.id, planId)),
      );

    expect(context).toMatchObject({ endedOn: "2026-07-21" });
    expect(decisions).toHaveLength(2);
    expect(decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localDate: "2026-07-20",
          selectedAlternativeId: optionId,
          selectedAlternativeVersion: 1,
        }),
        expect.objectContaining({
          localDate: "2026-07-21",
          selectedAlternativeId: null,
        }),
      ]),
    );
    expect(eventRows).toHaveLength(4);
    expect(outboxRows).toHaveLength(4);
    expect(task?.status).toBe("planned");
    expect(planRows).toHaveLength(1);
  }, 30_000);

  it("commits pause events atomically and blocks a same-day travel choice without changing the task", async () => {
    const store = createNeonExecutionContextCommandStore();
    const pauseContextId = randomUUID();
    const pauseId = randomUUID();
    await executeCreateExecutionContextCommand(
      store,
      {
        commandId: commandIds[5]!,
        trackerKey,
        contextId: pauseContextId,
        kind: "travel",
        startDate: "2026-07-23",
        endDate: "2026-07-25",
        occurredAt: "2026-07-22T16:30:00.000Z",
        occurredTimeZone: "Europe/Paris",
        occurredUtcOffsetMinutes: 120,
      },
      new Date("2026-07-22T16:30:00.000Z"),
    );
    await executeStartExecutionPauseCommand(store, {
      commandId: commandIds[6]!,
      trackerKey,
      pauseId,
      reason: "illness",
      note: "Anonymous private note",
      occurredAt: "2026-07-22T16:30:00.000Z",
      occurredTimeZone: "Europe/Paris",
      occurredUtcOffsetMinutes: 120,
    });
    await expect(
      executeSetExecutionDayCommand(store, {
        commandId: commandIds[7]!,
        trackerKey,
        contextId: pauseContextId,
        localDate: "2026-07-23",
        conditions: {
          availableMinutes: 10,
          venue: "room",
          equipment: ["chair"],
          healthStatus: "normal",
        },
        selection: { optionId, optionVersion: 1 },
        occurredAt: "2026-07-22T16:30:00.000Z",
        occurredTimeZone: "Europe/Paris",
        occurredUtcOffsetMinutes: 120,
      }),
    ).rejects.toBeInstanceOf(ExecutionContextSafetyBlockedError);
    await executeEndExecutionPauseCommand(store, {
      commandId: commandIds[8]!,
      trackerKey,
      pauseId,
      occurredAt: "2026-07-23T16:30:00.000Z",
      occurredTimeZone: "Europe/Paris",
      occurredUtcOffsetMinutes: 120,
    });

    const [pause] = await getDatabase()
      .select()
      .from(executionPauses)
      .where(eq(executionPauses.id, pauseId));
    const [task] = await getDatabase()
      .select({ status: taskInstances.status })
      .from(taskInstances)
      .where(eq(taskInstances.id, taskId));
    expect(pause).toMatchObject({
      startedOn: "2026-07-23",
      endedOn: "2026-07-24",
      reason: "illness",
    });
    expect(task?.status).toBe("planned");
  }, 30_000);
});
