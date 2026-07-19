import { randomUUID } from "node:crypto";

import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schemaVersion } from "@/domain/schemas";
import { createNeonExecutionContextCommandStore } from "@/server/commands/execution-context";
import {
  executeCreateExecutionContextCommand,
  executeEndExecutionContextCommand,
  executeEndExecutionPauseCommand,
  executeStartExecutionPauseCommand,
} from "@/server/commands/execution-context-core";
import { createNeonResumptionDecisionStore } from "@/server/commands/resumption";
import { executeResumptionDecisionCommand } from "@/server/commands/resumption-core";
import { getDatabase } from "@/server/db/client";
import {
  githubSyncOutbox,
  planVersions,
  resumptionAssessments,
  resumptionDecisions,
  taskInstances,
  trackers,
} from "@/server/db/schema";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("P1b S07 resumption decisions atomic integration", () => {
  const trackerId = randomUUID();
  const trackerKey = `anonymous-resumption-${randomUUID()}`;
  const planId = randomUUID();
  const historicalInstanceId = randomUUID();
  const futureInstanceId = randomUUID();
  const contextId = randomUUID();
  const contextAssessmentId = randomUUID();
  const pauseId = randomUUID();
  const pauseAssessmentId = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const database = getDatabase();
    await database.insert(trackers).values({
      id: trackerId,
      key: trackerKey,
      name: "Anonymous resumption tracker",
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
        tasks: [
          {
            id: "anonymous-history",
            title: "Anonymous historical task",
            scheduledDate: "2026-07-19",
            sortOrder: 0,
            category: "general",
            prescription: {},
          },
          {
            id: "anonymous-future",
            title: "Anonymous future task",
            scheduledDate: "2026-07-27",
            sortOrder: 1,
            category: "general",
            prescription: {},
          },
        ],
      },
    });
    await database.insert(taskInstances).values([
      {
        id: historicalInstanceId,
        trackerId,
        planVersionId: planId,
        taskDefinitionId: "anonymous-history",
        scheduledOn: "2026-07-19",
        status: "completed",
        confirmedByUser: true,
      },
      {
        id: futureInstanceId,
        trackerId,
        planVersionId: planId,
        taskDefinitionId: "anonymous-future",
        scheduledOn: "2026-07-27",
      },
    ]);
  });

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    const database = getDatabase();
    await database
      .delete(githubSyncOutbox)
      .where(like(githubSyncOutbox.targetPath, `trackers/${trackerKey}/%`));
    await database.delete(trackers).where(eq(trackers.id, trackerId));
  });

  it("keeps the original plan for an ended execution context", async () => {
    const executionStore = createNeonExecutionContextCommandStore();
    const contextStartCommandId = randomUUID();
    const contextEndCommandId = randomUUID();
    const decisionCommandId = randomUUID();
    await executeCreateExecutionContextCommand(
      executionStore,
      {
        trackerKey,
        commandId: contextStartCommandId,
        contextId,
        kind: "travel",
        startDate: "2026-07-20",
        endDate: "2026-07-22",
        occurredAt: "2026-07-19T02:00:00.000Z",
        occurredTimeZone: "Asia/Shanghai",
        occurredUtcOffsetMinutes: 480,
      },
      new Date("2026-07-19T02:00:00.000Z"),
    );
    const ended = await executeEndExecutionContextCommand(executionStore, {
      trackerKey,
      commandId: contextEndCommandId,
      contextId,
      assessmentId: contextAssessmentId,
      occurredAt: "2026-07-22T02:00:00.000Z",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
    });
    expect(ended.assessment?.trigger.type).toBe("execution_context");

    const input = {
      trackerKey,
      commandId: decisionCommandId,
      assessmentId: contextAssessmentId,
      basePlanVersionId: planId,
      replacementAssessmentId: randomUUID(),
      decision: "keep_original" as const,
      occurredAt: "2026-07-22T03:00:00.000Z",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
    };
    await expect(
      executeResumptionDecisionCommand(
        createNeonResumptionDecisionStore(),
        input,
      ),
    ).resolves.toMatchObject({ status: "kept_original", replayed: false });
    await expect(
      executeResumptionDecisionCommand(
        createNeonResumptionDecisionStore(),
        input,
      ),
    ).resolves.toMatchObject({ status: "kept_original", replayed: true });

    const plans = await getDatabase()
      .select({ id: planVersions.id })
      .from(planVersions)
      .where(eq(planVersions.trackerId, trackerId));
    expect(plans).toHaveLength(1);
  }, 30_000);

  it("rolls back a failed shift, then creates one version from a pause assessment", async () => {
    const executionStore = createNeonExecutionContextCommandStore();
    await executeStartExecutionPauseCommand(executionStore, {
      trackerKey,
      commandId: randomUUID(),
      pauseId,
      reason: "illness",
      note: "Anonymous private note",
      occurredAt: "2026-07-23T02:00:00.000Z",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
    });
    const ended = await executeEndExecutionPauseCommand(executionStore, {
      trackerKey,
      commandId: randomUUID(),
      pauseId,
      assessmentId: pauseAssessmentId,
      occurredAt: "2026-07-24T02:00:00.000Z",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
    });
    expect(ended.assessment).toMatchObject({
      trigger: { type: "pause", pausedDays: 2 },
    });

    const commandId = randomUUID();
    const newPlanVersionId = randomUUID();
    const input = {
      trackerKey,
      commandId,
      assessmentId: pauseAssessmentId,
      basePlanVersionId: planId,
      replacementAssessmentId: randomUUID(),
      decision: "shift" as const,
      effectiveFrom: "2026-07-25",
      newPlanVersionId,
      occurredAt: "2026-07-24T03:00:00.000Z",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
    };
    await getDatabase()
      .insert(githubSyncOutbox)
      .values({
        aggregateType: "event",
        aggregateId: commandId,
        targetPath: `trackers/${trackerKey}/preexisting/${commandId}.json`,
        payload: { anonymous: true },
      });
    await expect(
      executeResumptionDecisionCommand(
        createNeonResumptionDecisionStore(),
        input,
      ),
    ).rejects.toBeDefined();
    const [pendingAfterFailure, planAfterFailure, decisionAfterFailure] =
      await Promise.all([
        getDatabase()
          .select({ status: resumptionAssessments.status })
          .from(resumptionAssessments)
          .where(eq(resumptionAssessments.id, pauseAssessmentId)),
        getDatabase()
          .select({ id: planVersions.id })
          .from(planVersions)
          .where(eq(planVersions.id, newPlanVersionId)),
        getDatabase()
          .select({ id: resumptionDecisions.id })
          .from(resumptionDecisions)
          .where(eq(resumptionDecisions.assessmentId, pauseAssessmentId)),
      ]);
    expect(pendingAfterFailure[0]?.status).toBe("pending");
    expect(planAfterFailure).toHaveLength(0);
    expect(decisionAfterFailure).toHaveLength(0);

    await getDatabase()
      .delete(githubSyncOutbox)
      .where(
        and(
          eq(githubSyncOutbox.aggregateType, "event"),
          eq(githubSyncOutbox.aggregateId, commandId),
        ),
      );
    await expect(
      executeResumptionDecisionCommand(
        createNeonResumptionDecisionStore(),
        input,
      ),
    ).resolves.toMatchObject({
      status: "shifted",
      appliedPlanVersionId: newPlanVersionId,
    });

    const [oldHistorical, oldFuture, shiftedFuture, planRows] =
      await Promise.all([
        getDatabase()
          .select({
            status: taskInstances.status,
            date: taskInstances.scheduledOn,
          })
          .from(taskInstances)
          .where(eq(taskInstances.id, historicalInstanceId)),
        getDatabase()
          .select({
            status: taskInstances.status,
            date: taskInstances.scheduledOn,
          })
          .from(taskInstances)
          .where(eq(taskInstances.id, futureInstanceId)),
        getDatabase()
          .select({
            status: taskInstances.status,
            date: taskInstances.scheduledOn,
          })
          .from(taskInstances)
          .where(eq(taskInstances.planVersionId, newPlanVersionId)),
        getDatabase()
          .select({ id: planVersions.id })
          .from(planVersions)
          .where(eq(planVersions.trackerId, trackerId)),
      ]);
    expect(oldHistorical[0]).toEqual({
      status: "completed",
      date: "2026-07-19",
    });
    expect(oldFuture[0]).toEqual({ status: "planned", date: "2026-07-27" });
    expect(shiftedFuture).toEqual([{ status: "planned", date: "2026-07-29" }]);
    expect(planRows).toHaveLength(2);
  }, 30_000);
});
