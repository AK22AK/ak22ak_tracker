import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schemaVersion } from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import {
  evaluationSessions,
  events,
  githubSyncOutbox,
  planVersions,
  taskInstances,
  trackers,
} from "@/server/db/schema";
import { createNeonEvaluationStore } from "@/server/evaluation/repository";
import {
  createEvaluationRuntime,
  EvaluationCommandConflictError,
  EvaluationNotEligibleError,
} from "@/server/evaluation/runtime";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("P4c-1 evaluation session atomic integration", () => {
  const trackerId = randomUUID();
  const trackerKey = `anonymous-evaluation-${randomUUID()}`;
  const planId = randomUUID();
  const commandId = randomUUID();
  const rollbackTrackerId = randomUUID();
  const rollbackTrackerKey = `anonymous-evaluation-rollback-${randomUUID()}`;
  const rollbackPlanId = randomUUID();
  const rollbackCommandId = randomUUID();
  const raceTrackerId = randomUUID();
  const raceTrackerKey = `anonymous-evaluation-race-${randomUUID()}`;
  const racePlanId = randomUUID();
  const raceCommandId = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const database = getDatabase();
    await database.insert(trackers).values([
      {
        id: trackerId,
        key: trackerKey,
        name: "Anonymous evaluation tracker",
        module: "anonymous",
        startedOn: "2026-06-01",
        planningTimeZone: "Asia/Shanghai",
      },
      {
        id: rollbackTrackerId,
        key: rollbackTrackerKey,
        name: "Anonymous rollback tracker",
        module: "anonymous",
        startedOn: "2026-06-01",
        planningTimeZone: "Asia/Shanghai",
      },
      {
        id: raceTrackerId,
        key: raceTrackerKey,
        name: "Anonymous race tracker",
        module: "anonymous",
        startedOn: "2026-06-01",
        planningTimeZone: "Asia/Shanghai",
      },
    ]);
    const document = (id: string, key: string) => ({
      schemaVersion,
      id,
      trackerKey: key,
      version: 1,
      effectiveFrom: "2026-06-01",
      createdAt: "2026-06-01T00:00:00.000Z",
      createdBy: "import" as const,
      tasks: [
        {
          id: "anonymous-task",
          title: "Anonymous task",
          scheduledDate: "2026-06-09",
          sortOrder: 0,
          category: "general",
          prescription: {},
        },
      ],
    });
    await database.insert(planVersions).values([
      {
        id: planId,
        trackerId,
        version: 1,
        effectiveFrom: "2026-06-01",
        document: document(planId, trackerKey),
      },
      {
        id: rollbackPlanId,
        trackerId: rollbackTrackerId,
        version: 1,
        effectiveFrom: "2026-06-01",
        document: document(rollbackPlanId, rollbackTrackerKey),
      },
      {
        id: racePlanId,
        trackerId: raceTrackerId,
        version: 1,
        effectiveFrom: "2026-06-01",
        document: document(racePlanId, raceTrackerKey),
      },
    ]);
    await database.insert(taskInstances).values([
      {
        id: randomUUID(),
        trackerId,
        planVersionId: planId,
        taskDefinitionId: "anonymous-task",
        scheduledOn: "2026-06-09",
        status: "completed",
        confirmedByUser: true,
      },
      {
        id: randomUUID(),
        trackerId: rollbackTrackerId,
        planVersionId: rollbackPlanId,
        taskDefinitionId: "anonymous-task",
        scheduledOn: "2026-06-09",
      },
      {
        id: randomUUID(),
        trackerId: raceTrackerId,
        planVersionId: racePlanId,
        taskDefinitionId: "anonymous-task",
        scheduledOn: "2026-06-09",
      },
    ]);
  });

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    const database = getDatabase();
    await database
      .delete(githubSyncOutbox)
      .where(
        inArray(githubSyncOutbox.aggregateId, [commandId, rollbackCommandId]),
      );
    await database
      .delete(trackers)
      .where(and(eq(trackers.module, "anonymous"), eq(trackers.id, trackerId)));
    await database.delete(trackers).where(eq(trackers.id, rollbackTrackerId));
    await database.delete(trackers).where(eq(trackers.id, raceTrackerId));
  });

  const command = (id: string) => ({
    commandId: id,
    kind: "final" as const,
    occurredAt: "2026-06-09T08:00:00.000Z",
    occurredTimeZone: "Asia/Shanghai",
    occurredUtcOffsetMinutes: 480,
  });

  it("commits session, event and outbox once and expires on timeline change", async () => {
    const runtime = createEvaluationRuntime({
      store: createNeonEvaluationStore(),
      now: () => new Date("2026-06-09T08:05:00.000Z"),
    });
    const first = await runtime.create(trackerKey, command(commandId));
    const replay = await runtime.create(trackerKey, command(commandId));
    expect(first.state).toBe("opened");
    expect(replay).toEqual(first);

    const database = getDatabase();
    expect(
      await database
        .select({ id: evaluationSessions.id })
        .from(evaluationSessions)
        .where(eq(evaluationSessions.id, commandId)),
    ).toHaveLength(1);
    expect(
      await database
        .select({ id: events.id })
        .from(events)
        .where(eq(events.idempotencyKey, commandId)),
    ).toHaveLength(1);
    expect(
      await database
        .select({ id: githubSyncOutbox.id })
        .from(githubSyncOutbox)
        .where(eq(githubSyncOutbox.aggregateId, commandId)),
    ).toHaveLength(1);

    const nextPlanId = randomUUID();
    await database.insert(planVersions).values({
      id: nextPlanId,
      trackerId,
      version: 2,
      effectiveFrom: "2026-06-10",
      document: {
        schemaVersion,
        id: nextPlanId,
        trackerKey,
        version: 2,
        effectiveFrom: "2026-06-10",
        createdAt: "2026-06-09T09:00:00.000Z",
        createdBy: "user",
        tasks: [
          {
            id: "anonymous-next-task",
            title: "Anonymous next task",
            scheduledDate: "2026-06-10",
            sortOrder: 0,
            category: "general",
            prescription: {},
          },
        ],
      },
    });
    await expect(runtime.load(trackerKey)).resolves.toMatchObject({
      state: "expired",
      session: { status: "expired" },
    });
  }, 30_000);

  it("rolls back earlier inserts when the final outbox insert conflicts", async () => {
    const database = getDatabase();
    await database.insert(githubSyncOutbox).values({
      aggregateType: "event",
      aggregateId: rollbackCommandId,
      targetPath: `trackers/${rollbackTrackerKey}/events/2026/06/${rollbackCommandId}.json`,
      payload: { schemaVersion, anonymous: true },
    });
    const runtime = createEvaluationRuntime({
      store: createNeonEvaluationStore(),
      now: () => new Date("2026-06-09T08:05:00.000Z"),
    });

    await expect(
      runtime.create(rollbackTrackerKey, command(rollbackCommandId)),
    ).rejects.toBeInstanceOf(EvaluationCommandConflictError);
    expect(
      await database
        .select({ id: evaluationSessions.id })
        .from(evaluationSessions)
        .where(eq(evaluationSessions.id, rollbackCommandId)),
    ).toHaveLength(0);
    expect(
      await database
        .select({ id: events.id })
        .from(events)
        .where(eq(events.idempotencyKey, rollbackCommandId)),
    ).toHaveLength(0);
  }, 30_000);

  it("rejects a session when the plan timeline changes before the atomic commit", async () => {
    const database = getDatabase();
    const neonStore = createNeonEvaluationStore();
    let inserted = false;
    const runtime = createEvaluationRuntime({
      store: {
        ...neonStore,
        async commitAtomically(prepared) {
          if (!inserted) {
            inserted = true;
            const nextPlanId = randomUUID();
            await database.insert(planVersions).values({
              id: nextPlanId,
              trackerId: raceTrackerId,
              version: 2,
              effectiveFrom: "2026-06-10",
              document: {
                schemaVersion,
                id: nextPlanId,
                trackerKey: raceTrackerKey,
                version: 2,
                effectiveFrom: "2026-06-10",
                createdAt: "2026-06-09T08:04:00.000Z",
                createdBy: "user",
                tasks: [
                  {
                    id: "anonymous-race-next",
                    title: "Anonymous next task",
                    scheduledDate: "2026-06-10",
                    sortOrder: 0,
                    category: "general",
                    prescription: {},
                  },
                ],
              },
            });
          }
          return neonStore.commitAtomically(prepared);
        },
      },
      now: () => new Date("2026-06-09T08:05:00.000Z"),
    });

    await expect(
      runtime.create(raceTrackerKey, command(raceCommandId)),
    ).rejects.toBeInstanceOf(EvaluationNotEligibleError);
    expect(
      await database
        .select({ id: evaluationSessions.id })
        .from(evaluationSessions)
        .where(eq(evaluationSessions.id, raceCommandId)),
    ).toHaveLength(0);
    expect(
      await database
        .select({ id: events.id })
        .from(events)
        .where(eq(events.idempotencyKey, raceCommandId)),
    ).toHaveLength(0);
  }, 30_000);
});
