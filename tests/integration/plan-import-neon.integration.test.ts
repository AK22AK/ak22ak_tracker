import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schemaVersion, type PlanVersion } from "@/domain/schemas";
import { getCalendarMonth, getTodayDashboard } from "@/server/dashboard";
import { getDatabase } from "@/server/db/client";
import { planVersions, taskInstances, trackers } from "@/server/db/schema";
import { importPlanVersion } from "@/server/plans/import-plan";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

function planDocument(input: {
  id: string;
  trackerKey: string;
  version: number;
  effectiveFrom: string;
  taskId: string;
  scheduledDate: string;
}): PlanVersion {
  return {
    schemaVersion,
    id: input.id,
    trackerKey: input.trackerKey,
    version: input.version,
    effectiveFrom: input.effectiveFrom,
    createdAt: `${input.effectiveFrom}T00:00:00.000Z`,
    createdBy: "import",
    tasks: [
      {
        id: input.taskId,
        title: "Anonymous task",
        scheduledDate: input.scheduledDate,
        sortOrder: 0,
        category: "general",
        prescription: {},
      },
    ],
  };
}

integration("audited immutable plan import", () => {
  const trackerKey = `anonymous-plan-import-${randomUUID()}`;
  const conflictingTrackerKey = `anonymous-plan-conflict-${randomUUID()}`;

  beforeAll(() => {
    process.env.DATABASE_URL = testDatabaseUrl;
  });

  afterAll(async () => {
    const database = getDatabase();
    await database
      .delete(trackers)
      .where(inArray(trackers.key, [trackerKey, conflictingTrackerKey]));
  });

  it("updates the formal start while preserving history and remaining idempotent", async () => {
    const database = getDatabase();
    const firstPlan = planDocument({
      id: randomUUID(),
      trackerKey,
      version: 1,
      effectiveFrom: "2026-01-01",
      taskId: "anonymous-v1-task",
      scheduledDate: "2026-01-02",
    });
    const secondPlan = planDocument({
      id: randomUUID(),
      trackerKey,
      version: 2,
      effectiveFrom: "2026-02-02",
      taskId: "anonymous-v2-task",
      scheduledDate: "2026-02-03",
    });

    await importPlanVersion({
      database,
      document: firstPlan,
      trackerName: "Anonymous tracker",
      trackerModule: "anonymous-plan-import",
      planningTimeZone: "Asia/Shanghai",
    });
    const [tracker] = await database
      .select({ id: trackers.id })
      .from(trackers)
      .where(eq(trackers.key, trackerKey));
    expect(tracker).toBeDefined();
    await database
      .update(taskInstances)
      .set({ status: "completed", confirmedByUser: true })
      .where(
        and(
          eq(taskInstances.trackerId, tracker!.id),
          eq(taskInstances.taskDefinitionId, "anonymous-v1-task"),
        ),
      );

    const importSecond = () =>
      importPlanVersion({
        database,
        document: secondPlan,
        trackerName: "Anonymous tracker",
        trackerModule: "anonymous-plan-import",
        planningTimeZone: "Asia/Shanghai",
        trackerStartedOn: "2026-02-02",
      });
    await importSecond();
    await importSecond();

    const [storedTracker] = await database
      .select({ id: trackers.id, startedOn: trackers.startedOn })
      .from(trackers)
      .where(eq(trackers.key, trackerKey));
    const versions = await database
      .select({ version: planVersions.version })
      .from(planVersions)
      .where(eq(planVersions.trackerId, storedTracker!.id))
      .orderBy(asc(planVersions.version));
    const tasks = await database
      .select({
        taskDefinitionId: taskInstances.taskDefinitionId,
        status: taskInstances.status,
        confirmedByUser: taskInstances.confirmedByUser,
      })
      .from(taskInstances)
      .where(eq(taskInstances.trackerId, storedTracker!.id));
    const [historicalPlan] = await database
      .select({ version: planVersions.version })
      .from(planVersions)
      .where(
        and(
          eq(planVersions.trackerId, storedTracker!.id),
          lte(planVersions.effectiveFrom, "2026-02-01"),
        ),
      )
      .orderBy(asc(planVersions.version));

    expect(storedTracker?.startedOn).toBe("2026-02-02");
    expect(versions).toEqual([{ version: 1 }, { version: 2 }]);
    expect(tasks).toHaveLength(2);
    expect(tasks).toContainEqual({
      taskDefinitionId: "anonymous-v1-task",
      status: "completed",
      confirmedByUser: true,
    });
    expect(historicalPlan?.version).toBe(1);

    const beforeStart = await getTodayDashboard(trackerKey, "2026-01-02");
    const startDay = await getTodayDashboard(trackerKey, "2026-02-02");
    const firstTaskDay = await getTodayDashboard(trackerKey, "2026-02-03");
    const historicalMonth = await getCalendarMonth(trackerKey, "2026-01");
    expect(beforeStart).toMatchObject({
      state: "not_started",
      planVersion: 1,
      tasks: [],
    });
    expect(startDay).toMatchObject({
      state: "ready",
      planVersion: 2,
      tasks: [],
    });
    expect(firstTaskDay).toMatchObject({
      state: "ready",
      planVersion: 2,
      tasks: [{ title: "Anonymous task" }],
    });
    expect(historicalMonth).not.toContainEqual(
      expect.objectContaining({ date: "2026-01-02", taskCount: 1 }),
    );
  }, 30_000);

  it("rejects conflicting immutable content before changing the tracker start", async () => {
    const database = getDatabase();
    const plan = planDocument({
      id: randomUUID(),
      trackerKey: conflictingTrackerKey,
      version: 1,
      effectiveFrom: "2026-03-01",
      taskId: "anonymous-original",
      scheduledDate: "2026-03-02",
    });
    await importPlanVersion({
      database,
      document: plan,
      trackerName: "Anonymous conflicting tracker",
      trackerModule: "anonymous-plan-import",
      planningTimeZone: "Asia/Shanghai",
    });

    await expect(
      importPlanVersion({
        database,
        document: {
          ...plan,
          id: randomUUID(),
          tasks: [{ ...plan.tasks[0]!, title: "Conflicting task" }],
        },
        trackerName: "Anonymous conflicting tracker",
        trackerModule: "anonymous-plan-import",
        planningTimeZone: "Asia/Shanghai",
        trackerStartedOn: "2026-04-01",
      }),
    ).rejects.toThrow("different content");

    const [storedTracker] = await database
      .select({ startedOn: trackers.startedOn })
      .from(trackers)
      .where(eq(trackers.key, conflictingTrackerKey));
    expect(storedTracker?.startedOn).toBe("2026-03-01");
  }, 30_000);
});
