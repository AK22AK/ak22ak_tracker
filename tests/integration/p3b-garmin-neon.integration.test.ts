import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDayAggregate } from "@/server/aggregates/tracker";
import { createNeonExternalRecordAssociationStore } from "@/server/commands/external-record-association";
import { executeExternalRecordAssociationCommand } from "@/server/commands/external-record-association-core";
import { getDatabase } from "@/server/db/client";
import {
  externalRecordLinks,
  externalRecords,
  githubSyncOutbox,
  planVersions,
  taskInstances,
  trackers,
} from "@/server/db/schema";
import { createNeonProviderDateSyncStore } from "@/server/integrations/core/neon-date-sync-store";
import { syncProviderDate } from "@/server/integrations/core/sync-provider-date";
import { normalizeGarminActivities } from "@/server/integrations/garmin/normalize";
import { schemaVersion } from "@/domain/schemas";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("P3b-2b Garmin provider-neutral persistence", () => {
  const trackerId = randomUUID();
  const trackerKey = `anonymous-${randomUUID()}`;
  const planVersionId = randomUUID();
  const taskId = randomUUID();
  const commandId = randomUUID();
  const localDate = "2026-07-24";

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const database = getDatabase();
    await database.insert(trackers).values({
      id: trackerId,
      key: trackerKey,
      name: "Anonymous Tracker",
      module: "anonymous",
      startedOn: localDate,
      planningTimeZone: "Asia/Shanghai",
    });
    await database.insert(planVersions).values({
      id: planVersionId,
      trackerId,
      version: 1,
      effectiveFrom: localDate,
      document: {
        schemaVersion,
        id: planVersionId,
        trackerKey,
        version: 1,
        effectiveFrom: localDate,
        createdAt: "2026-07-24T00:00:00.000Z",
        createdBy: "import",
        tasks: [
          {
            id: "anonymous-endurance-task",
            title: "Anonymous run task",
            scheduledDate: localDate,
            sortOrder: 0,
            category: "running",
            prescription: {},
          },
        ],
      },
    });
    await database.insert(taskInstances).values({
      id: taskId,
      trackerId,
      planVersionId,
      taskDefinitionId: "anonymous-endurance-task",
      scheduledOn: localDate,
    });
  });

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    const database = getDatabase();
    await database
      .delete(githubSyncOutbox)
      .where(eq(githubSyncOutbox.aggregateId, commandId));
    await database.delete(trackers).where(eq(trackers.id, trackerId));
  });

  function activity(durationSeconds = 1_800) {
    return normalizeGarminActivities({
      activities: [
        {
          providerRecordId: "anonymous-garmin-record",
          activityType: "running",
          startedAt: "2026-07-24T01:00:00.000Z",
          durationSeconds,
          distanceMeters: 3_000,
          averagePaceSecondsPerKilometer: 360,
          averageHeartRateBpm: 120,
        },
      ],
      localDate,
      planningTimeZone: "Asia/Shanghai",
      fetchedAt: new Date("2026-07-24T02:00:00.000Z"),
    });
  }

  it("upserts idempotently, projects a redacted DTO, and marks a changed linked source for review", async () => {
    const database = getDatabase();
    const store = createNeonProviderDateSyncStore(trackerKey, database);
    const first = await syncProviderDate({
      trackerId,
      provider: "garmin",
      date: localDate,
      now: new Date("2026-07-24T02:00:00.000Z"),
      store,
      readSource: async () => activity(),
    });
    const second = await syncProviderDate({
      trackerId,
      provider: "garmin",
      date: localDate,
      now: new Date("2026-07-24T02:00:31.000Z"),
      store,
      readSource: async () => activity(),
    });
    expect(first).toMatchObject({ created: 1, changed: 0 });
    expect(second).toMatchObject({ created: 0, changed: 0, unchanged: 1 });

    const [record] = await database
      .select({ id: externalRecords.id })
      .from(externalRecords)
      .where(
        inArray(externalRecords.providerRecordId, ["anonymous-garmin-record"]),
      );
    expect(record).toBeTruthy();
    await executeExternalRecordAssociationCommand(
      createNeonExternalRecordAssociationStore(database),
      {
        commandId,
        trackerKey,
        externalRecordId: record!.id,
        sourceVersion: 1,
        decision: "link",
        taskId,
        occurredAt: "2026-07-24T02:01:00.000Z",
        occurredTimeZone: "Asia/Shanghai",
        occurredUtcOffsetMinutes: 480,
      },
      new Date("2026-07-24T02:01:00.000Z"),
    );

    const changed = await syncProviderDate({
      trackerId,
      provider: "garmin",
      date: localDate,
      now: new Date("2026-07-24T02:01:02.000Z"),
      store,
      readSource: async () => activity(1_860),
    });
    expect(changed).toMatchObject({ created: 0, changed: 1 });

    const aggregate = await getDayAggregate(trackerKey, localDate);
    const projected = aggregate.day.externalTrainingRecords.find(
      (item) => item.provider === "garmin",
    );
    expect(projected).toMatchObject({
      provider: "garmin",
      sourceVersion: 2,
      details: {
        kind: "activity",
        activityType: "running",
        durationSeconds: 1_860,
      },
      association: {
        status: "confirmed",
        taskId,
        sourceVersion: 1,
        needsReview: true,
      },
    });
    expect(JSON.stringify(projected)).not.toContain("anonymous-garmin-record");
    const [task] = await database
      .select({ status: taskInstances.status })
      .from(taskInstances)
      .where(eq(taskInstances.id, taskId));
    expect(task?.status).toBe("planned");
    const [link] = await database
      .select({ needsReview: externalRecordLinks.needsReview })
      .from(externalRecordLinks)
      .where(eq(externalRecordLinks.externalRecordId, record!.id));
    expect(link?.needsReview).toBe(true);
  }, 20_000);
});
