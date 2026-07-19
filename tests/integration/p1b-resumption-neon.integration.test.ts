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
import {
  executeResumptionDecisionCommand,
  ResumptionAssessmentStateError,
} from "@/server/commands/resumption-core";
import { getDatabase } from "@/server/db/client";
import {
  githubSyncOutbox,
  planVersions,
  resumptionAssessments,
  resumptionDecisions,
  taskInstances,
  trackers,
} from "@/server/db/schema";
import { buildResumptionAssessmentSnapshot } from "@/server/resumption/build-assessment";

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
  const timelineTrackerId = randomUUID();
  const timelineTrackerKey = `anonymous-timeline-${randomUUID()}`;
  const timelinePlanId = randomUUID();
  const timelineTaskId = randomUUID();

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
    await database.insert(trackers).values({
      id: timelineTrackerId,
      key: timelineTrackerKey,
      name: "Anonymous timeline tracker",
      module: "anonymous",
      startedOn: "2026-07-01",
      planningTimeZone: "Asia/Shanghai",
    });
    await database.insert(planVersions).values({
      id: timelinePlanId,
      trackerId: timelineTrackerId,
      version: 1,
      effectiveFrom: "2026-07-01",
      document: {
        schemaVersion,
        id: timelinePlanId,
        trackerKey: timelineTrackerKey,
        version: 1,
        effectiveFrom: "2026-07-01",
        createdAt: "2026-07-01T00:00:00.000Z",
        createdBy: "import",
        tasks: [
          {
            id: "anonymous-timeline-future",
            title: "Anonymous timeline future task",
            scheduledDate: "2026-07-27",
            sortOrder: 0,
            category: "general",
            prescription: {},
          },
        ],
      },
    });
    await database.insert(taskInstances).values({
      id: timelineTaskId,
      trackerId: timelineTrackerId,
      planVersionId: timelinePlanId,
      taskDefinitionId: "anonymous-timeline-future",
      scheduledOn: "2026-07-27",
    });
  });

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    const database = getDatabase();
    await database
      .delete(githubSyncOutbox)
      .where(like(githubSyncOutbox.targetPath, `trackers/${trackerKey}/%`));
    await database.delete(trackers).where(eq(trackers.id, trackerId));
    await database
      .delete(githubSyncOutbox)
      .where(
        like(githubSyncOutbox.targetPath, `trackers/${timelineTrackerKey}/%`),
      );
    await database.delete(trackers).where(eq(trackers.id, timelineTrackerId));
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

  it("expires old decisions after a future version is added and blocks shift on the replacement", async () => {
    const database = getDatabase();
    const keepAssessmentId = randomUUID();
    const shiftAssessmentId = randomUUID();
    const createdAt = new Date("2026-07-22T08:00:00.000Z");
    const build = (id: string, triggerId: string) =>
      buildResumptionAssessmentSnapshot(
        {
          id,
          trackerId: timelineTrackerId,
          trackerKey: timelineTrackerKey,
          planningTimeZone: "Asia/Shanghai",
          triggerType: "pause",
          triggerId,
          startDate: "2026-07-20",
          endDate: "2026-07-22",
          createdAt,
        },
        database,
      );
    const [keepSnapshot, shiftSnapshot] = await Promise.all([
      build(keepAssessmentId, randomUUID()),
      build(shiftAssessmentId, randomUUID()),
    ]);
    expect(keepSnapshot.shiftAvailability.allowed).toBe(true);
    await database.insert(resumptionAssessments).values([
      {
        id: keepSnapshot.id,
        trackerId: timelineTrackerId,
        triggerType: keepSnapshot.trigger.type,
        triggerId: keepSnapshot.trigger.id,
        basePlanVersionId: keepSnapshot.basePlanVersion.id,
        timelineHeadPlanVersionId: keepSnapshot.timelineHead.id,
        planningTimeZone: keepSnapshot.planningTimeZone,
        snapshot: keepSnapshot,
      },
      {
        id: shiftSnapshot.id,
        trackerId: timelineTrackerId,
        triggerType: shiftSnapshot.trigger.type,
        triggerId: shiftSnapshot.trigger.id,
        basePlanVersionId: shiftSnapshot.basePlanVersion.id,
        timelineHeadPlanVersionId: shiftSnapshot.timelineHead.id,
        planningTimeZone: shiftSnapshot.planningTimeZone,
        snapshot: shiftSnapshot,
      },
    ]);

    const futurePlanId = randomUUID();
    await database.insert(planVersions).values({
      id: futurePlanId,
      trackerId: timelineTrackerId,
      version: 2,
      effectiveFrom: "2026-08-01",
      document: {
        schemaVersion,
        id: futurePlanId,
        trackerKey: timelineTrackerKey,
        version: 2,
        effectiveFrom: "2026-08-01",
        createdAt: "2026-07-22T08:01:00.000Z",
        createdBy: "user",
        tasks: [],
      },
    });

    const keepReplacementId = randomUUID();
    await expect(
      executeResumptionDecisionCommand(
        createNeonResumptionDecisionStore(database),
        {
          trackerKey: timelineTrackerKey,
          commandId: randomUUID(),
          assessmentId: keepAssessmentId,
          basePlanVersionId: timelinePlanId,
          replacementAssessmentId: keepReplacementId,
          decision: "keep_original",
          occurredAt: "2026-07-22T08:05:00.000Z",
          occurredTimeZone: "Asia/Shanghai",
          occurredUtcOffsetMinutes: 480,
        },
      ),
    ).resolves.toMatchObject({ status: "expired" });

    const shiftReplacementId = randomUUID();
    await expect(
      executeResumptionDecisionCommand(
        createNeonResumptionDecisionStore(database),
        {
          trackerKey: timelineTrackerKey,
          commandId: randomUUID(),
          assessmentId: shiftAssessmentId,
          basePlanVersionId: timelinePlanId,
          replacementAssessmentId: shiftReplacementId,
          decision: "shift",
          effectiveFrom: "2026-07-23",
          newPlanVersionId: randomUUID(),
          occurredAt: "2026-07-22T08:06:00.000Z",
          occurredTimeZone: "Asia/Shanghai",
          occurredUtcOffsetMinutes: 480,
        },
      ),
    ).resolves.toMatchObject({ status: "expired" });

    const replacementRows = await database
      .select({ snapshot: resumptionAssessments.snapshot })
      .from(resumptionAssessments)
      .where(eq(resumptionAssessments.id, shiftReplacementId));
    expect(replacementRows[0]?.snapshot).toMatchObject({
      timelineHead: { id: futurePlanId, version: 2 },
      shiftAvailability: {
        allowed: false,
        reason: "future_plan_version_exists",
      },
    });
    await expect(
      executeResumptionDecisionCommand(
        createNeonResumptionDecisionStore(database),
        {
          trackerKey: timelineTrackerKey,
          commandId: randomUUID(),
          assessmentId: shiftReplacementId,
          basePlanVersionId: timelinePlanId,
          replacementAssessmentId: randomUUID(),
          decision: "shift",
          effectiveFrom: "2026-07-23",
          newPlanVersionId: randomUUID(),
          occurredAt: "2026-07-22T08:07:00.000Z",
          occurredTimeZone: "Asia/Shanghai",
          occurredUtcOffsetMinutes: 480,
        },
      ),
    ).rejects.toBeInstanceOf(ResumptionAssessmentStateError);
  }, 30_000);
});
