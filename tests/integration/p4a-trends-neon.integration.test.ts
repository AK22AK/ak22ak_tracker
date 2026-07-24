import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schemaVersion } from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import {
  events,
  planVersions,
  taskInstances,
  trackers,
} from "@/server/db/schema";
import { getTrendsAggregate } from "@/server/trends/aggregate";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("P4a weekly trends Neon aggregate", () => {
  const trackerId = randomUUID();
  const trackerKey = `anonymous-${randomUUID()}`;
  const firstPlanId = randomUUID();
  const secondPlanId = randomUUID();
  const oldTaskId = randomUUID();
  const historicalTaskId = randomUUID();
  const currentTaskId = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const database = getDatabase();
    await database.insert(trackers).values({
      id: trackerId,
      key: trackerKey,
      name: "Anonymous Tracker",
      module: "anonymous",
      startedOn: "2026-06-01",
      planningTimeZone: "Asia/Shanghai",
    });
    await database.insert(planVersions).values([
      {
        id: firstPlanId,
        trackerId,
        version: 1,
        effectiveFrom: "2026-06-01",
        document: {
          schemaVersion,
          id: firstPlanId,
          trackerKey,
          version: 1,
          effectiveFrom: "2026-06-01",
          createdAt: "2026-06-01T00:00:00.000Z",
          createdBy: "import",
          tasks: [],
        },
      },
      {
        id: secondPlanId,
        trackerId,
        version: 2,
        effectiveFrom: "2026-07-13",
        document: {
          schemaVersion,
          id: secondPlanId,
          trackerKey,
          version: 2,
          effectiveFrom: "2026-07-13",
          createdAt: "2026-07-13T00:00:00.000Z",
          createdBy: "user",
          tasks: [],
        },
      },
    ]);
    await database.insert(taskInstances).values([
      {
        id: historicalTaskId,
        trackerId,
        planVersionId: firstPlanId,
        taskDefinitionId: "anonymous-historical",
        scheduledOn: "2026-07-06",
        status: "completed",
      },
      {
        id: oldTaskId,
        trackerId,
        planVersionId: firstPlanId,
        taskDefinitionId: "anonymous-replaced",
        scheduledOn: "2026-07-20",
        status: "completed",
      },
      {
        id: currentTaskId,
        trackerId,
        planVersionId: secondPlanId,
        taskDefinitionId: "anonymous-current",
        scheduledOn: "2026-07-20",
        status: "planned",
      },
    ]);

    const feedbackDocument = (
      id: string,
      localDate: string,
      pain: number,
      safetyLevel: "green" | "yellow" | "red",
    ) => ({
      schemaVersion,
      id,
      trackerKey,
      kind: "symptom_check_in" as const,
      occurredAt: `${localDate}T02:00:00.000Z`,
      recordedAt: `${localDate}T02:01:00.000Z`,
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
      localDate,
      idempotencyKey: `anonymous-${id}`,
      payload: {
        timing: "morning",
        leftPain: pain,
        rightPain: Math.max(0, pain - 1),
        swelling: "none",
        stiffness: false,
        mechanicalSymptoms: false,
        weightBearingIssue: false,
        localizedBonePain: false,
        nightOrRestPain: false,
        note: "",
        safetyLevel,
      },
      provenance: { source: "user" as const },
    });
    const feedbackIds = [randomUUID(), randomUUID()];
    await database.insert(events).values([
      {
        id: feedbackIds[0],
        trackerId,
        kind: "symptom_check_in",
        localDate: "2026-07-20",
        occurredAt: new Date("2026-07-20T02:00:00.000Z"),
        recordedAt: new Date("2026-07-20T02:01:00.000Z"),
        idempotencyKey: `anonymous-${feedbackIds[0]}`,
        document: feedbackDocument(feedbackIds[0], "2026-07-20", 2, "green"),
      },
      {
        id: feedbackIds[1],
        trackerId,
        kind: "symptom_check_in",
        localDate: "2026-07-20",
        occurredAt: new Date("2026-07-20T12:00:00.000Z"),
        recordedAt: new Date("2026-07-20T12:01:00.000Z"),
        idempotencyKey: `anonymous-${feedbackIds[1]}`,
        document: feedbackDocument(feedbackIds[1], "2026-07-20", 7, "red"),
      },
    ]);
  });

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    await getDatabase().delete(trackers).where(eq(trackers.id, trackerId));
  });

  it("uses the historical effective plan and saved daily symptom result", async () => {
    const result = await getTrendsAggregate({
      trackerKey,
      now: new Date("2026-07-22T04:00:00.000Z"),
    });

    expect(result.range.currentDate).toBe("2026-07-22");
    const previousWeek = result.weeks.find(
      (week) => week.weekStart === "2026-07-06",
    );
    const currentWeek = result.weeks.find((week) => week.isCurrentWeek);
    expect(previousWeek?.tasks).toMatchObject({ completed: 1, total: 1 });
    expect(currentWeek?.tasks).toMatchObject({
      completed: 0,
      planned: 1,
      total: 1,
    });
    expect(currentWeek?.symptoms).toMatchObject({
      feedbackDays: 1,
      expectedDays: 3,
      maxPain: 7,
      safetyDays: { green: 0, yellow: 0, red: 1 },
    });
  });
});
