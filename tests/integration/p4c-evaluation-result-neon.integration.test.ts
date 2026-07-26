import { randomUUID } from "node:crypto";

import { count, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schemaVersion } from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import {
  evaluationResults,
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
  EvaluationResultNotEligibleError,
} from "@/server/evaluation/runtime";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("P4c-2a immutable evaluation result integration", () => {
  const trackerIds: string[] = [];
  const outboxIds: string[] = [];

  beforeAll(() => {
    process.env.DATABASE_URL = testDatabaseUrl;
  });

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    const database = getDatabase();
    if (outboxIds.length > 0) {
      await database
        .delete(githubSyncOutbox)
        .where(inArray(githubSyncOutbox.aggregateId, outboxIds));
    }
    if (trackerIds.length > 0) {
      await database.delete(trackers).where(inArray(trackers.id, trackerIds));
    }
  });

  async function createFixture(label: string) {
    const database = getDatabase();
    const trackerId = randomUUID();
    const trackerKey =
      "anonymous-evaluation-result-" + label + "-" + randomUUID();
    const planId = randomUUID();
    const sessionId = randomUUID();
    trackerIds.push(trackerId);
    outboxIds.push(sessionId);
    await database.insert(trackers).values({
      id: trackerId,
      key: trackerKey,
      name: "Anonymous evaluation result tracker",
      module: "anonymous",
      startedOn: "2026-06-01",
      planningTimeZone: "Asia/Shanghai",
    });
    await database.insert(planVersions).values({
      id: planId,
      trackerId,
      version: 1,
      effectiveFrom: "2026-06-01",
      document: {
        schemaVersion,
        id: planId,
        trackerKey,
        version: 1,
        effectiveFrom: "2026-06-01",
        createdAt: "2026-06-01T00:00:00.000Z",
        createdBy: "import",
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
      },
    });
    await database.insert(taskInstances).values({
      id: randomUUID(),
      trackerId,
      planVersionId: planId,
      taskDefinitionId: "anonymous-task",
      scheduledOn: "2026-06-09",
      status: "completed",
      confirmedByUser: true,
    });
    const store = createNeonEvaluationStore();
    const runtime = createEvaluationRuntime({
      store,
      now: () => new Date("2026-06-09T09:05:00.000Z"),
    });
    await runtime.create(trackerKey, {
      commandId: sessionId,
      kind: "final",
      occurredAt: "2026-06-09T08:00:00.000Z",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
    });
    return { trackerId, trackerKey, planId, sessionId, store, runtime };
  }

  function resultCommand(sessionId: string, commandId = randomUUID()) {
    outboxIds.push(commandId);
    return {
      commandId,
      sessionId,
      occurredAt: "2026-06-09T09:00:00.000Z",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
      answers: {
        goalCompletion: "partially_met" as const,
        sides: {
          left: {
            symptomResponse: "mild" as const,
            strengthAndControl: "ready" as const,
            loadTolerance: "limited" as const,
          },
          right: {
            symptomResponse: "none" as const,
            strengthAndControl: "ready" as const,
            loadTolerance: "ready" as const,
          },
        },
        nextStageIntent: "undecided" as const,
      },
    };
  }

  it("commits one immutable result, event and outbox and replays the command", async () => {
    const fixture = await createFixture("canonical");
    const command = resultCommand(fixture.sessionId);
    const first = await fixture.runtime.submitResult(
      fixture.trackerKey,
      command,
    );
    const replay = await fixture.runtime.submitResult(
      fixture.trackerKey,
      command,
    );
    const database = getDatabase();
    const [resultCount] = await database
      .select({ value: count() })
      .from(evaluationResults)
      .where(eq(evaluationResults.sessionId, fixture.sessionId));
    const [eventCount] = await database
      .select({ value: count() })
      .from(events)
      .where(eq(events.idempotencyKey, command.commandId));
    const [outboxCount] = await database
      .select({ value: count() })
      .from(githubSyncOutbox)
      .where(eq(githubSyncOutbox.aggregateId, command.commandId));

    expect(first).toMatchObject({
      state: "opened",
      result: { id: command.commandId },
    });
    expect(replay).toEqual(first);
    expect(resultCount?.value).toBe(1);
    expect(eventCount?.value).toBe(1);
    expect(outboxCount?.value).toBe(1);
  }, 45_000);

  it("returns one canonical result for two concurrent command ids", async () => {
    const fixture = await createFixture("concurrent");
    const first = resultCommand(fixture.sessionId);
    const second = resultCommand(fixture.sessionId);
    const responses = await Promise.all([
      fixture.runtime.submitResult(fixture.trackerKey, first),
      fixture.runtime.submitResult(fixture.trackerKey, second),
    ]);
    const ids = responses.map((response) =>
      response.state === "opened" ? response.result?.id : null,
    );
    const [resultCount] = await getDatabase()
      .select({ value: count() })
      .from(evaluationResults)
      .where(eq(evaluationResults.sessionId, fixture.sessionId));

    expect(new Set(ids).size).toBe(1);
    expect(resultCount?.value).toBe(1);
  }, 45_000);

  it("fails closed when a red feedback arrives before the atomic guard", async () => {
    const fixture = await createFixture("red-race");
    const command = resultCommand(fixture.sessionId);
    const database = getDatabase();
    const runtime = createEvaluationRuntime({
      store: {
        ...fixture.store,
        async commitResultAtomically(prepared) {
          const feedbackId = randomUUID();
          await database.insert(events).values({
            id: feedbackId,
            trackerId: fixture.trackerId,
            kind: "symptom_check_in",
            localDate: "2026-06-09",
            occurredAt: new Date("2026-06-09T09:01:00.000Z"),
            recordedAt: new Date("2026-06-09T09:01:01.000Z"),
            idempotencyKey: feedbackId,
            document: {
              schemaVersion,
              id: feedbackId,
              trackerKey: fixture.trackerKey,
              kind: "symptom_check_in",
              occurredAt: "2026-06-09T09:01:00.000Z",
              recordedAt: "2026-06-09T09:01:01.000Z",
              occurredTimeZone: "Asia/Shanghai",
              occurredUtcOffsetMinutes: 480,
              localDate: "2026-06-09",
              idempotencyKey: feedbackId,
              payload: {
                timing: "incident",
                leftPain: 7,
                rightPain: 1,
                swelling: "obvious",
                stiffness: true,
                mechanicalSymptoms: false,
                weightBearingIssue: false,
                localizedBonePain: false,
                nightOrRestPain: false,
                note: "",
                safetyLevel: "red",
              },
              provenance: { source: "user" },
            },
          });
          return fixture.store.commitResultAtomically(prepared);
        },
      },
      now: () => new Date("2026-06-09T09:05:00.000Z"),
    });

    await expect(
      runtime.submitResult(fixture.trackerKey, command),
    ).rejects.toBeInstanceOf(EvaluationResultNotEligibleError);
    expect(
      await database
        .select({ id: evaluationResults.id })
        .from(evaluationResults)
        .where(eq(evaluationResults.sessionId, fixture.sessionId)),
    ).toHaveLength(0);
  }, 45_000);

  it("rejects a result when the plan timeline changes before commit", async () => {
    const fixture = await createFixture("timeline-race");
    const command = resultCommand(fixture.sessionId);
    const database = getDatabase();
    const runtime = createEvaluationRuntime({
      store: {
        ...fixture.store,
        async commitResultAtomically(prepared) {
          const nextPlanId = randomUUID();
          await database.insert(planVersions).values({
            id: nextPlanId,
            trackerId: fixture.trackerId,
            version: 2,
            effectiveFrom: "2026-06-10",
            document: {
              schemaVersion,
              id: nextPlanId,
              trackerKey: fixture.trackerKey,
              version: 2,
              effectiveFrom: "2026-06-10",
              createdAt: "2026-06-09T09:01:00.000Z",
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
          return fixture.store.commitResultAtomically(prepared);
        },
      },
      now: () => new Date("2026-06-09T09:05:00.000Z"),
    });

    await expect(
      runtime.submitResult(fixture.trackerKey, command),
    ).rejects.toBeInstanceOf(EvaluationResultNotEligibleError);
    expect(
      await database
        .select({ id: evaluationResults.id })
        .from(evaluationResults)
        .where(eq(evaluationResults.sessionId, fixture.sessionId)),
    ).toHaveLength(0);
  }, 45_000);

  it("rolls back result and event when the final outbox insert conflicts", async () => {
    const fixture = await createFixture("rollback");
    const command = resultCommand(fixture.sessionId);
    const database = getDatabase();
    await database.insert(githubSyncOutbox).values({
      aggregateType: "event",
      aggregateId: command.commandId,
      targetPath:
        "trackers/" +
        fixture.trackerKey +
        "/events/2026/06/" +
        command.commandId +
        ".json",
      payload: { schemaVersion, anonymous: true },
    });

    await expect(
      fixture.runtime.submitResult(fixture.trackerKey, command),
    ).rejects.toBeInstanceOf(EvaluationCommandConflictError);
    expect(
      await database
        .select({ id: evaluationResults.id })
        .from(evaluationResults)
        .where(eq(evaluationResults.sessionId, fixture.sessionId)),
    ).toHaveLength(0);
    expect(
      await database
        .select({ id: events.id })
        .from(events)
        .where(eq(events.idempotencyKey, command.commandId)),
    ).toHaveLength(0);
  }, 45_000);
});
