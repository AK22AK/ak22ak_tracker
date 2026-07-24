import { randomUUID } from "node:crypto";

import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { schemaVersion } from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import {
  aiAnalysisJobs,
  events,
  planChangeProposals,
  planVersions,
  taskInstances,
  trackers,
} from "@/server/db/schema";
import { prepareAiAnalysisContext } from "@/server/integrations/ai/context";
import { createNeonAiAnalysisStore } from "@/server/integrations/ai/repository";
import { createAiAnalysisRuntime } from "@/server/integrations/ai/runtime";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("P4b-1 AI analysis Neon persistence", () => {
  const trackerId = randomUUID();
  const trackerKey = `anonymous-${randomUUID()}`;
  const planId = randomUUID();
  const taskInstanceId = randomUUID();
  const feedbackId = randomUUID();
  const commandId = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const database = getDatabase();
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
        source: {
          repository: "anonymous/private-context",
          path: "private/path.md",
          commit: "abcdef0",
        },
        tasks: [
          {
            id: "anonymous-task",
            title: "Anonymous task",
            scheduledDate: "2026-07-23",
            sortOrder: 0,
            category: "training",
            prescription: {},
          },
        ],
      },
    });
    await database.insert(taskInstances).values({
      id: taskInstanceId,
      trackerId,
      planVersionId: planId,
      taskDefinitionId: "anonymous-task",
      scheduledOn: "2026-07-23",
      status: "completed",
      confirmedByUser: true,
      actualData: {
        kind: "general",
        exercises: [],
        durationMinutes: 30,
        distanceKm: null,
        summary: "private summary excluded",
      },
      subjectiveNote: "private note excluded",
    });
    const feedbackDocument = {
      schemaVersion,
      id: feedbackId,
      trackerKey,
      kind: "symptom_check_in" as const,
      occurredAt: "2026-07-23T08:00:00.000Z",
      recordedAt: "2026-07-23T08:01:00.000Z",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
      localDate: "2026-07-23",
      idempotencyKey: `anonymous-${feedbackId}`,
      payload: {
        timing: "morning",
        leftPain: 2,
        rightPain: 1,
        swelling: "none",
        stiffness: false,
        mechanicalSymptoms: false,
        weightBearingIssue: false,
        localizedBonePain: false,
        nightOrRestPain: false,
        note: "private note excluded",
        safetyLevel: "green",
      },
      provenance: { source: "user" as const },
    };
    await database.insert(events).values({
      id: feedbackId,
      trackerId,
      kind: "symptom_check_in",
      localDate: "2026-07-23",
      occurredAt: new Date("2026-07-23T08:00:00.000Z"),
      recordedAt: new Date("2026-07-23T08:01:00.000Z"),
      idempotencyKey: feedbackDocument.idempotencyKey,
      document: feedbackDocument,
    });
  });

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    await getDatabase().delete(trackers).where(eq(trackers.id, trackerId));
  });

  it("persists one job and proposal while sending only minimal structured context", async () => {
    const database = getDatabase();
    const proposeAdjustment = vi.fn(async (context) => {
      expect(context.currentPlan).not.toHaveProperty("source");
      expect(JSON.stringify(context)).not.toContain("private note excluded");
      expect(JSON.stringify(context)).not.toContain("private summary excluded");
      expect(context.confirmedTraining).toEqual([
        expect.objectContaining({
          durationMinutes: 30,
          localDate: "2026-07-23",
        }),
      ]);
      return {
        summary: "Keep current plan",
        safetyLevel: "green" as const,
        operations: [],
        model: "anonymous-model",
        responseHash: "e".repeat(64),
      };
    });
    const store = createNeonAiAnalysisStore(database);
    const runtime = createAiAnalysisRuntime({
      store,
      prepareContext: (key, now) =>
        prepareAiAnalysisContext({ trackerKey: key, now, database }),
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
      createAdvisor: () => ({ proposeAdjustment }),
      now: () => new Date("2026-07-24T08:00:00.000Z"),
    });

    await runtime.request({ trackerKey, commandId });
    await runtime.request({ trackerKey, commandId });
    const [jobCount] = await database
      .select({ value: count() })
      .from(aiAnalysisJobs)
      .where(eq(aiAnalysisJobs.id, commandId));
    const [proposalCount] = await database
      .select({ value: count() })
      .from(planChangeProposals)
      .where(eq(planChangeProposals.analysisJobId, commandId));
    expect(jobCount?.value).toBe(1);
    expect(proposalCount?.value).toBe(1);
    expect(proposeAdjustment).toHaveBeenCalledTimes(1);

    const redFeedbackId = randomUUID();
    await database.insert(events).values({
      id: redFeedbackId,
      trackerId,
      kind: "symptom_check_in",
      localDate: "2026-07-24",
      occurredAt: new Date("2026-07-24T07:00:00.000Z"),
      recordedAt: new Date("2026-07-24T07:01:00.000Z"),
      idempotencyKey: `anonymous-${redFeedbackId}`,
      document: {
        schemaVersion,
        id: redFeedbackId,
        trackerKey,
        kind: "symptom_check_in",
        occurredAt: "2026-07-24T07:00:00.000Z",
        recordedAt: "2026-07-24T07:01:00.000Z",
        occurredTimeZone: "Asia/Shanghai",
        occurredUtcOffsetMinutes: 480,
        localDate: "2026-07-24",
        idempotencyKey: `anonymous-${redFeedbackId}`,
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

    const expired = await runtime.load(trackerKey, commandId);
    const [savedProposal] = await database
      .select({ status: planChangeProposals.status })
      .from(planChangeProposals)
      .where(eq(planChangeProposals.analysisJobId, commandId));
    expect(expired.job?.proposal?.status).toBe("expired");
    expect(savedProposal?.status).toBe("expired");
    expect(
      await store.expireProposal({
        proposalId: commandId,
        trackerId,
      }),
    ).toBe(false);
  }, 45_000);
});
