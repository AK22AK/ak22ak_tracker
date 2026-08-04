import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { and, count, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { schemaVersion } from "@/domain/schemas";
import {
  aiAnalysisJobAuditDocumentSchema,
  planChangeProposalAuditDocumentSchema,
} from "@/domain/ai-audit";
import { getDatabase } from "@/server/db/client";
import {
  aiAnalysisJobs,
  events,
  externalRecords,
  githubSyncOutbox,
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
  const failedCommandId = randomUUID();
  const wellnessRecordId = randomUUID();
  const wellnessDocument = (totalSteps: number) => ({
    schemaVersion,
    id: wellnessRecordId,
    trackerKey,
    provider: "garmin" as const,
    providerRecordId: "daily_wellness:2026-07-24",
    kind: "daily_wellness" as const,
    occurredAt: "2026-07-24T04:00:00.000Z",
    localDate: "2026-07-24",
    payload: {
      localDate: "2026-07-24",
      steps: { status: "available" as const, totalSteps, stepGoal: null },
      sleep: {
        status: "missing" as const,
        sleepStart: null,
        sleepEnd: null,
        totalSleepSeconds: null,
        deepSleepSeconds: null,
        lightSleepSeconds: null,
        remSleepSeconds: null,
        awakeSleepSeconds: null,
        sleepScore: null,
      },
    },
    fetchedAt: "2026-07-24T04:00:00.000Z",
    contentHash: "c".repeat(64),
    sourceVersion: 1,
  });

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
        summary: "excluded anonymous training summary",
      },
      subjectiveNote: "excluded anonymous subjective note",
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
        note: "excluded anonymous feedback note",
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
    await database.insert(externalRecords).values({
      id: wellnessRecordId,
      trackerId,
      provider: "garmin",
      providerRecordId: "daily_wellness:2026-07-24",
      kind: "daily_wellness",
      localDate: "2026-07-24",
      occurredAt: new Date("2026-07-24T04:00:00.000Z"),
      fetchedAt: new Date("2026-07-24T04:00:00.000Z"),
      contentHash: "c".repeat(64),
      sourceVersion: 1,
      document: wellnessDocument(0),
    });
  });

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    await getDatabase()
      .delete(githubSyncOutbox)
      .where(
        inArray(githubSyncOutbox.aggregateId, [commandId, failedCommandId]),
      );
    await getDatabase().delete(trackers).where(eq(trackers.id, trackerId));
  });

  it("persists one job and proposal while sending only minimal structured context", async () => {
    const database = getDatabase();
    const initialContext = await prepareAiAnalysisContext({
      trackerKey,
      now: new Date("2026-07-24T08:00:00.000Z"),
      database,
    });
    await database
      .update(externalRecords)
      .set({ document: wellnessDocument(1) })
      .where(eq(externalRecords.id, wellnessRecordId));
    const changedContext = await prepareAiAnalysisContext({
      trackerKey,
      now: new Date("2026-07-24T08:00:00.000Z"),
      database,
    });
    expect(changedContext.contextHash).not.toBe(initialContext.contextHash);
    await database
      .update(externalRecords)
      .set({ document: wellnessDocument(0) })
      .where(eq(externalRecords.id, wellnessRecordId));

    const proposeAdjustment = vi.fn(async (context) => {
      expect(context.currentPlan).not.toHaveProperty("source");
      expect(context.recentFeedback).toEqual([
        expect.objectContaining({
          userObservation: "excluded anonymous feedback note",
        }),
      ]);
      expect(JSON.stringify(context)).not.toContain(
        "excluded anonymous training summary",
      );
      expect(JSON.stringify(context)).not.toContain(
        "excluded anonymous subjective note",
      );
      expect(context.confirmedTraining).toEqual([
        expect.objectContaining({
          durationMinutes: 30,
          localDate: "2026-07-23",
        }),
      ]);
      expect(context.recoveryEvidence).toHaveLength(14);
      expect(context.recoveryEvidence.at(-1)).toEqual({
        localDate: "2026-07-24",
        sleepStatus: "missing",
        sleepTotalSeconds: null,
        sleepScore: null,
        stepsStatus: "available",
        totalSteps: 0,
        stepsPartial: true,
      });
      for (const forbidden of [
        "sleepStart",
        "sleepEnd",
        "stepGoal",
        "providerRecordId",
        "tokenBundle",
      ]) {
        expect(JSON.stringify(context)).not.toContain(forbidden);
      }
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
          model: "deepseek-v4-flash" as const,
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
    const auditRows = await database
      .select({
        aggregateType: githubSyncOutbox.aggregateType,
        targetPath: githubSyncOutbox.targetPath,
        payload: githubSyncOutbox.payload,
      })
      .from(githubSyncOutbox)
      .where(eq(githubSyncOutbox.aggregateId, commandId));
    expect(auditRows).toHaveLength(2);
    const jobAudit = auditRows.find(
      (row) => row.aggregateType === "ai_analysis_job",
    );
    const proposalAudit = auditRows.find(
      (row) => row.aggregateType === "plan_change_proposal",
    );
    expect(
      aiAnalysisJobAuditDocumentSchema.parse(jobAudit?.payload),
    ).toMatchObject({
      status: "succeeded",
      proposalId: commandId,
      attemptCount: 1,
      startedAt: "2026-07-24T08:00:00.000Z",
    });
    expect(
      planChangeProposalAuditDocumentSchema.parse(proposalAudit?.payload),
    ).toMatchObject({ status: "proposed", decision: null, rollback: null });
    expect(jobAudit?.targetPath).toBe(
      `trackers/${trackerKey}/ai/analysis-jobs/${commandId}.json`,
    );
    expect(proposalAudit?.targetPath).toBe(
      `trackers/${trackerKey}/ai/proposals/${commandId}.json`,
    );
    expect(JSON.stringify(auditRows)).not.toContain(
      "excluded anonymous feedback note",
    );
    expect(JSON.stringify(auditRows)).not.toContain(
      "excluded anonymous training summary",
    );
    expect(JSON.stringify(auditRows)).not.toContain(
      "excluded anonymous subjective note",
    );

    const failingRuntime = createAiAnalysisRuntime({
      store,
      prepareContext: (key, now) =>
        prepareAiAnalysisContext({ trackerKey: key, now, database }),
      readConfiguration: () => ({
        status: "configured",
        value: {
          apiKey: "anonymous",
          endpoint: "https://api.example.invalid/chat/completions",
          model: "deepseek-v4-flash" as const,
          timeoutMs: 1_000,
          maxTokens: 1_024,
        },
      }),
      createAdvisor: () => ({
        proposeAdjustment: async () => {
          throw new Error("anonymous provider failure");
        },
      }),
      now: () => new Date("2026-07-24T08:05:00.000Z"),
    });
    const failed = await failingRuntime.request({
      trackerKey,
      commandId: failedCommandId,
    });
    expect(failed.job).toMatchObject({
      status: "failed",
      errorCode: "provider_unavailable",
    });
    const [failedAudit] = await database
      .select({ payload: githubSyncOutbox.payload })
      .from(githubSyncOutbox)
      .where(
        and(
          eq(githubSyncOutbox.aggregateType, "ai_analysis_job"),
          eq(githubSyncOutbox.aggregateId, failedCommandId),
        ),
      );
    expect(
      aiAnalysisJobAuditDocumentSchema.parse(failedAudit?.payload),
    ).toMatchObject({
      status: "failed",
      errorCode: "provider_unavailable",
      attemptCount: 1,
      proposalId: null,
    });

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
    const [expiredAudit] = await database
      .select({ payload: githubSyncOutbox.payload })
      .from(githubSyncOutbox)
      .where(
        and(
          eq(githubSyncOutbox.aggregateType, "plan_change_proposal"),
          eq(githubSyncOutbox.aggregateId, commandId),
        ),
      );
    expect(
      planChangeProposalAuditDocumentSchema.parse(expiredAudit?.payload),
    ).toMatchObject({ status: "expired", decision: null, rollback: null });
    const currentJob = await store.findJob(trackerKey, commandId);
    expect(currentJob).not.toBeNull();
    expect(
      await store.expireProposal({
        job: currentJob!,
        proposalId: commandId,
        trackerId,
      }),
    ).toBe(false);

    await database
      .delete(githubSyncOutbox)
      .where(
        inArray(githubSyncOutbox.aggregateId, [commandId, failedCommandId]),
      );
    const backfillStatements = readFileSync(
      resolve("drizzle/0015_ai_audit_mirror_backfill.sql"),
      "utf8",
    )
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(backfillStatements).toHaveLength(2);
    for (const statement of backfillStatements) {
      await database.execute(sql.raw(statement));
    }
    const backfilled = await database
      .select({
        aggregateType: githubSyncOutbox.aggregateType,
        payload: githubSyncOutbox.payload,
      })
      .from(githubSyncOutbox)
      .where(
        inArray(githubSyncOutbox.aggregateId, [commandId, failedCommandId]),
      );
    expect(backfilled).toHaveLength(2);
    expect(
      aiAnalysisJobAuditDocumentSchema.parse(
        backfilled.find(
          (row) =>
            row.aggregateType === "ai_analysis_job" &&
            row.payload.id === commandId,
        )?.payload,
      ),
    ).toMatchObject({ status: "succeeded", proposalId: commandId });
    expect(
      aiAnalysisJobAuditDocumentSchema.parse(
        backfilled.find(
          (row) =>
            row.aggregateType === "ai_analysis_job" &&
            row.payload.id === failedCommandId,
        )?.payload,
      ),
    ).toMatchObject({
      status: "failed",
      errorCode: "provider_unavailable",
    });
    expect(
      backfilled.find((row) => row.aggregateType === "plan_change_proposal"),
    ).toBeUndefined();
  }, 45_000);
});
