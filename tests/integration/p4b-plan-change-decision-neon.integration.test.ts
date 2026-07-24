import { randomUUID } from "node:crypto";

import { and, count, eq, like } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { PlanChangeDecisionCommand } from "@/domain/ai-analysis";
import type { PlanVersionRollbackCommand } from "@/domain/ai-analysis";
import { schemaVersion } from "@/domain/schemas";
import { createNeonPlanChangeDecisionStore } from "@/server/commands/plan-change-decision";
import { executePlanChangeDecision } from "@/server/commands/plan-change-decision-core";
import { createNeonPlanVersionRollbackStore } from "@/server/commands/plan-version-rollback";
import { executePlanVersionRollback } from "@/server/commands/plan-version-rollback-core";
import { getDatabase } from "@/server/db/client";
import {
  aiAnalysisJobs,
  events,
  githubSyncOutbox,
  planChangeDecisions,
  planChangeProposals,
  planVersionRollbacks,
  planVersions,
  taskInstances,
  trackers,
} from "@/server/db/schema";
import { prepareAiAnalysisContext } from "@/server/integrations/ai/context";
import { createNeonAiAnalysisStore } from "@/server/integrations/ai/repository";
import { createAiAnalysisRuntime } from "@/server/integrations/ai/runtime";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);
const now = new Date("2026-07-24T08:00:00.000Z");
const createdTrackers: Array<{ id: string; key: string }> = [];

type Fixture = {
  trackerId: string;
  trackerKey: string;
  planId: string;
  proposalId: string;
  historicalTaskInstanceId: string;
};

function decisionCommand(
  fixture: Fixture,
  decision: "accepted" | "rejected",
  commandId = randomUUID(),
): PlanChangeDecisionCommand & { trackerKey: string } {
  return {
    trackerKey: fixture.trackerKey,
    commandId,
    proposalId: fixture.proposalId,
    decision,
    occurredAt: now.toISOString(),
    occurredTimeZone: "Asia/Shanghai",
    occurredUtcOffsetMinutes: 480,
  };
}

async function createFixture(): Promise<Fixture> {
  const database = getDatabase();
  const trackerId = randomUUID();
  const trackerKey = `anonymous-${randomUUID()}`;
  const planId = randomUUID();
  const historicalTaskInstanceId = randomUUID();
  const proposalId = randomUUID();
  createdTrackers.push({ id: trackerId, key: trackerKey });

  await database.insert(trackers).values({
    id: trackerId,
    key: trackerKey,
    name: "Anonymous Tracker",
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
          scheduledDate: "2026-07-23",
          sortOrder: 0,
          category: "general",
          prescription: {},
        },
        {
          id: "anonymous-future",
          title: "Anonymous future task",
          scheduledDate: "2026-07-26",
          sortOrder: 0,
          category: "general",
          prescription: {},
        },
      ],
    },
  });
  await database.insert(taskInstances).values({
    id: historicalTaskInstanceId,
    trackerId,
    planVersionId: planId,
    taskDefinitionId: "anonymous-history",
    scheduledOn: "2026-07-23",
    status: "completed",
    confirmedByUser: true,
  });

  const runtime = createAiAnalysisRuntime({
    store: createNeonAiAnalysisStore(database),
    prepareContext: (key, currentTime) =>
      prepareAiAnalysisContext({
        trackerKey: key,
        now: currentTime,
        database,
      }),
    readConfiguration: () => ({
      status: "configured",
      value: {
        apiKey: "anonymous",
        endpoint: "https://api.example.invalid/chat/completions",
        model: "anonymous-model",
        timeoutMs: 1_000,
        maxTokens: 1_024,
      },
    }),
    createAdvisor: () => ({
      proposeAdjustment: vi.fn(async () => ({
        summary: "Anonymous schedule adjustment",
        safetyLevel: "green" as const,
        operations: [
          {
            type: "replace_task" as const,
            taskId: "anonymous-future",
            task: {
              id: "anonymous-future",
              title: "Anonymous adjusted task",
              scheduledDate: "2026-07-27",
              sortOrder: 0,
              category: "general",
              prescription: {},
            },
            reason: "Anonymous test reason",
          },
        ],
        model: "anonymous-model",
        responseHash: "a".repeat(64),
      })),
    }),
    now: () => now,
  });
  const page = await runtime.request({ trackerKey, commandId: proposalId });
  expect(page.job?.proposal?.status).toBe("proposed");

  return {
    trackerId,
    trackerKey,
    planId,
    proposalId,
    historicalTaskInstanceId,
  };
}

async function decide(
  fixture: Fixture,
  command: PlanChangeDecisionCommand & { trackerKey: string },
) {
  const database = getDatabase();
  return executePlanChangeDecision(
    createNeonPlanChangeDecisionStore(database),
    (trackerKey, currentTime) =>
      prepareAiAnalysisContext({ trackerKey, now: currentTime, database }),
    command,
    now,
  );
}

function rollbackCommand(
  fixture: Fixture,
  commandId = randomUUID(),
): PlanVersionRollbackCommand & { trackerKey: string } {
  return {
    trackerKey: fixture.trackerKey,
    proposalId: fixture.proposalId,
    commandId,
    occurredAt: now.toISOString(),
    occurredTimeZone: "Asia/Shanghai",
    occurredUtcOffsetMinutes: 480,
  };
}

async function rollback(
  command: PlanVersionRollbackCommand & { trackerKey: string },
) {
  return executePlanVersionRollback(
    createNeonPlanVersionRollbackStore(getDatabase()),
    command,
    now,
  );
}

integration("P4b-2a plan change decision Neon transaction", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = testDatabaseUrl;
  });

  afterEach(async () => {
    const database = getDatabase();
    for (const tracker of createdTrackers.splice(0)) {
      await database
        .delete(githubSyncOutbox)
        .where(like(githubSyncOutbox.targetPath, `trackers/${tracker.key}/%`));
      await database.delete(trackers).where(eq(trackers.id, tracker.id));
    }
  });

  it("accepts once and atomically creates a complete immutable future plan", async () => {
    const database = getDatabase();
    const fixture = await createFixture();
    const command = decisionCommand(fixture, "accepted");

    const result = await decide(fixture, command);
    const [decisionCount] = await database
      .select({ value: count() })
      .from(planChangeDecisions)
      .where(eq(planChangeDecisions.proposalId, fixture.proposalId));
    const [versionCount] = await database
      .select({ value: count() })
      .from(planVersions)
      .where(eq(planVersions.trackerId, fixture.trackerId));
    const projected = await database
      .select({
        taskDefinitionId: taskInstances.taskDefinitionId,
        scheduledOn: taskInstances.scheduledOn,
      })
      .from(taskInstances)
      .where(
        and(
          eq(taskInstances.trackerId, fixture.trackerId),
          eq(taskInstances.planVersionId, result.appliedPlanVersion!.id),
        ),
      );
    const [historical] = await database
      .select({ status: taskInstances.status })
      .from(taskInstances)
      .where(eq(taskInstances.id, fixture.historicalTaskInstanceId));

    expect(result).toMatchObject({
      status: "accepted",
      replayed: false,
      appliedPlanVersion: { version: 2, effectiveFrom: "2026-07-25" },
    });

    expect(decisionCount?.value).toBe(1);
    expect(versionCount?.value).toBe(2);
    expect(projected).toEqual([
      {
        taskDefinitionId: "anonymous-future",
        scheduledOn: "2026-07-27",
      },
    ]);
    expect(historical?.status).toBe("completed");
  }, 45_000);

  it("rolls back an accepted head by creating one immutable future version", async () => {
    const database = getDatabase();
    const fixture = await createFixture();
    const accepted = await decide(
      fixture,
      decisionCommand(fixture, "accepted"),
    );
    expect(accepted.status).toBe("accepted");

    const command = rollbackCommand(fixture);
    const result = await rollback(command);
    const replay = await rollback(command);
    const [rollbackCount] = await database
      .select({ value: count() })
      .from(planVersionRollbacks)
      .where(eq(planVersionRollbacks.proposalId, fixture.proposalId));
    const [versionCount] = await database
      .select({ value: count() })
      .from(planVersions)
      .where(eq(planVersions.trackerId, fixture.trackerId));
    const projected = await database
      .select({
        taskDefinitionId: taskInstances.taskDefinitionId,
        scheduledOn: taskInstances.scheduledOn,
      })
      .from(taskInstances)
      .where(
        and(
          eq(taskInstances.trackerId, fixture.trackerId),
          eq(taskInstances.planVersionId, result.newPlanVersion!.id),
        ),
      );
    const [historical] = await database
      .select({ status: taskInstances.status })
      .from(taskInstances)
      .where(eq(taskInstances.id, fixture.historicalTaskInstanceId));

    expect(result).toMatchObject({
      status: "rolled_back",
      replayed: false,
      newPlanVersion: { version: 3, effectiveFrom: "2026-07-25" },
    });
    expect(replay).toMatchObject({ replayed: true, conflict: false });
    expect(rollbackCount.value).toBe(1);
    expect(versionCount.value).toBe(3);
    expect(projected).toEqual([
      { taskDefinitionId: "anonymous-future", scheduledOn: "2026-07-26" },
    ]);
    expect(historical?.status).toBe("completed");
  }, 45_000);

  it("allows only one concurrent rollback command for the applied version", async () => {
    const fixture = await createFixture();
    await decide(fixture, decisionCommand(fixture, "accepted"));
    const results = await Promise.all([
      rollback(rollbackCommand(fixture)),
      rollback(rollbackCommand(fixture)),
    ]);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(results.filter((result) => result.conflict)).toHaveLength(1);
  }, 45_000);

  it("blocks a rollback when a later plan version is already scheduled", async () => {
    const database = getDatabase();
    const fixture = await createFixture();
    const accepted = await decide(
      fixture,
      decisionCommand(fixture, "accepted"),
    );
    const laterId = randomUUID();
    await database.insert(planVersions).values({
      id: laterId,
      trackerId: fixture.trackerId,
      version: 3,
      effectiveFrom: "2026-07-28",
      document: {
        schemaVersion,
        id: laterId,
        trackerKey: fixture.trackerKey,
        version: 3,
        effectiveFrom: "2026-07-28",
        createdAt: "2026-07-24T09:00:00.000Z",
        createdBy: "user",
        tasks: [],
      },
    });

    const result = await rollback(rollbackCommand(fixture));
    expect(accepted.appliedPlanVersion?.version).toBe(2);
    expect(result).toMatchObject({
      status: "blocked",
      blockedReason: "later_plan_version",
    });
  }, 45_000);

  it("rolls back the whole transaction when the later outbox insert fails", async () => {
    const database = getDatabase();
    const fixture = await createFixture();
    await decide(fixture, decisionCommand(fixture, "accepted"));
    const command = rollbackCommand(fixture);
    await database.insert(githubSyncOutbox).values({
      aggregateType: "event",
      aggregateId: command.commandId,
      targetPath: `trackers/${fixture.trackerKey}/events/collision.json`,
      payload: { anonymous: true },
    });

    await expect(rollback(command)).rejects.toThrow();
    const [rollbackCount] = await database
      .select({ value: count() })
      .from(planVersionRollbacks)
      .where(eq(planVersionRollbacks.proposalId, fixture.proposalId));
    const [versionCount] = await database
      .select({ value: count() })
      .from(planVersions)
      .where(eq(planVersions.trackerId, fixture.trackerId));
    const [eventCount] = await database
      .select({ value: count() })
      .from(events)
      .where(eq(events.id, command.commandId));
    expect(rollbackCount.value).toBe(0);
    expect(versionCount.value).toBe(2);
    expect(eventCount.value).toBe(0);
  }, 45_000);

  it("replays the same command and lets only one concurrent decision win", async () => {
    const database = getDatabase();
    const fixture = await createFixture();
    const firstCommand = decisionCommand(fixture, "accepted");
    const replay = await decide(fixture, firstCommand);
    const replayed = await decide(fixture, firstCommand);
    expect(replay.status).toBe("accepted");
    expect(replayed).toMatchObject({ replayed: true, conflict: false });

    const secondFixture = await createFixture();
    const results = await Promise.all([
      decide(secondFixture, decisionCommand(secondFixture, "accepted")),
      decide(secondFixture, decisionCommand(secondFixture, "rejected")),
    ]);
    const [decisionCount] = await database
      .select({ value: count() })
      .from(planChangeDecisions)
      .where(eq(planChangeDecisions.proposalId, secondFixture.proposalId));
    const [versionCount] = await database
      .select({ value: count() })
      .from(planVersions)
      .where(eq(planVersions.trackerId, secondFixture.trackerId));

    expect(decisionCount?.value).toBe(1);
    expect(new Set(results.map((item) => item.status)).size).toBe(1);
    expect(results.some((item) => item.conflict)).toBe(true);
    expect(versionCount?.value).toBe(results[0]?.status === "accepted" ? 2 : 1);
  }, 45_000);

  it("expires instead of deciding after feedback changes the context", async () => {
    const database = getDatabase();
    const fixture = await createFixture();
    const feedbackId = randomUUID();
    await database.insert(events).values({
      id: feedbackId,
      trackerId: fixture.trackerId,
      kind: "symptom_check_in",
      localDate: "2026-07-24",
      occurredAt: new Date("2026-07-24T07:00:00.000Z"),
      recordedAt: new Date("2026-07-24T07:01:00.000Z"),
      idempotencyKey: feedbackId,
      document: {
        schemaVersion,
        id: feedbackId,
        trackerKey: fixture.trackerKey,
        kind: "symptom_check_in",
        occurredAt: "2026-07-24T07:00:00.000Z",
        recordedAt: "2026-07-24T07:01:00.000Z",
        occurredTimeZone: "Asia/Shanghai",
        occurredUtcOffsetMinutes: 480,
        localDate: "2026-07-24",
        idempotencyKey: feedbackId,
        payload: {
          timing: "incident",
          leftPain: 7,
          rightPain: 1,
          swelling: "obvious",
          stiffness: true,
          mechanicalSymptoms: true,
          weightBearingIssue: false,
          localizedBonePain: false,
          nightOrRestPain: false,
          note: "",
          safetyLevel: "red",
        },
        provenance: { source: "user" },
      },
    });

    const result = await decide(fixture, decisionCommand(fixture, "accepted"));
    const [decisionCount] = await database
      .select({ value: count() })
      .from(planChangeDecisions)
      .where(eq(planChangeDecisions.proposalId, fixture.proposalId));
    const [proposal] = await database
      .select({ status: planChangeProposals.status })
      .from(planChangeProposals)
      .where(eq(planChangeProposals.id, fixture.proposalId));

    expect(result.status).toBe("expired");
    expect(decisionCount?.value).toBe(0);
    expect(proposal?.status).toBe("expired");
  }, 45_000);

  it("rolls back every decision artifact when a later outbox insert fails", async () => {
    const database = getDatabase();
    const fixture = await createFixture();
    const command = decisionCommand(fixture, "accepted");
    await database.insert(githubSyncOutbox).values({
      aggregateType: "event",
      aggregateId: command.commandId,
      targetPath: `trackers/${fixture.trackerKey}/events/anonymous-conflict.json`,
      payload: { schemaVersion },
    });

    await expect(decide(fixture, command)).rejects.toBeTruthy();
    const [decisionCount] = await database
      .select({ value: count() })
      .from(planChangeDecisions)
      .where(eq(planChangeDecisions.proposalId, fixture.proposalId));
    const [versionCount] = await database
      .select({ value: count() })
      .from(planVersions)
      .where(eq(planVersions.trackerId, fixture.trackerId));
    const [proposal] = await database
      .select({ status: planChangeProposals.status })
      .from(planChangeProposals)
      .where(eq(planChangeProposals.id, fixture.proposalId));
    const [eventCount] = await database
      .select({ value: count() })
      .from(events)
      .where(eq(events.idempotencyKey, command.commandId));

    expect(decisionCount?.value).toBe(0);
    expect(versionCount?.value).toBe(1);
    expect(proposal?.status).toBe("proposed");
    expect(eventCount?.value).toBe(0);
  }, 45_000);

  it("rejects atomically without creating a plan version", async () => {
    const database = getDatabase();
    const fixture = await createFixture();
    const result = await decide(fixture, decisionCommand(fixture, "rejected"));
    const [versionCount] = await database
      .select({ value: count() })
      .from(planVersions)
      .where(eq(planVersions.trackerId, fixture.trackerId));
    const [job] = await database
      .select({ status: aiAnalysisJobs.status })
      .from(aiAnalysisJobs)
      .where(eq(aiAnalysisJobs.id, fixture.proposalId));

    expect(result).toMatchObject({
      status: "rejected",
      appliedPlanVersion: null,
    });
    expect(versionCount?.value).toBe(1);
    expect(job?.status).toBe("succeeded");
  }, 45_000);
});
