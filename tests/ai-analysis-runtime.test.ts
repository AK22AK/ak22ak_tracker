import { describe, expect, it, vi } from "vitest";

import { schemaVersion } from "@/domain/schemas";
import type { PreparedAiAnalysisContext } from "@/server/integrations/ai/context";
import type { PlanAdvisor } from "@/server/integrations/ai/contracts";
import {
  type AiAnalysisJobRecord,
  type AiAnalysisStore,
} from "@/server/integrations/ai/repository";
import { createAiAnalysisRuntime } from "@/server/integrations/ai/runtime";

const jobId = "019c1000-0000-7000-8000-000000000101";
const trackerId = "019c1000-0000-7000-8000-000000000102";
const planId = "019c1000-0000-7000-8000-000000000103";

function prepared(): PreparedAiAnalysisContext {
  const currentPlan = {
    schemaVersion,
    id: planId,
    trackerKey: "knee-rehab",
    version: 1,
    effectiveFrom: "2026-07-01",
    createdAt: "2026-07-01T00:00:00.000Z",
    createdBy: "import" as const,
    tasks: [],
  };
  return {
    trackerId,
    trackerKey: "knee-rehab",
    basePlanVersionId: planId,
    timelineHeadPlanVersionId: planId,
    basePlan: currentPlan,
    timelineHeadPlan: currentPlan,
    contextVersion: "1",
    contextHash: "a".repeat(64),
    contextRevision: 1,
    contextFrom: "2026-07-11",
    contextThrough: "2026-07-24",
    safetyLevel: "green",
    modelContext: {
      currentPlan,
      timelineHeadPlanVersionId: planId,
      planningTimeZone: "Asia/Shanghai",
      range: { from: "2026-07-11", through: "2026-07-24" },
      recentFeedback: [],
      confirmedTraining: [],
      safetyLevel: "green",
    },
  };
}

function memoryStore(order: string[]) {
  let job: AiAnalysisJobRecord | null = null;
  const store: AiAnalysisStore = {
    async createJob(input) {
      order.push("create-job");
      job ??= {
        id: input.id,
        trackerId: input.trackerId,
        trackerKey: input.trackerKey,
        basePlanVersionId: input.basePlanVersionId,
        timelineHeadPlanVersionId: input.timelineHeadPlanVersionId,
        status: "pending",
        model: input.model,
        attemptCount: 0,
        contextVersion: input.contextVersion,
        contextHash: input.contextHash,
        contextRevision: input.contextRevision,
        contextFrom: input.contextFrom,
        contextThrough: input.contextThrough,
        safetyLevel: input.safetyLevel,
        responseHash: null,
        lastErrorCode: null,
        requestedAt: input.requestedAt,
        startedAt: null,
        completedAt: null,
        proposal: null,
        proposalDecision: null,
      };
      return job;
    },
    async findJob(_trackerKey, id) {
      return job?.id === id ? job : null;
    },
    async findLatestJob() {
      return job;
    },
    async claimJob(input) {
      order.push("claim-job");
      if (!job || job.status === "succeeded" || job.status === "running") {
        return false;
      }
      job = {
        ...job,
        status: "running",
        startedAt: input.startedAt,
        attemptCount: job.attemptCount + 1,
        lastErrorCode: null,
      };
      return true;
    },
    async failJob(input) {
      order.push("fail-job");
      if (!job) throw new Error("missing job");
      job = {
        ...job,
        status: "failed",
        lastErrorCode: input.errorCode,
        completedAt: input.completedAt,
      };
    },
    async completeJob(input) {
      order.push("complete-job");
      if (!job) throw new Error("missing job");
      job = {
        ...job,
        status: "succeeded",
        model: input.model,
        responseHash: input.responseHash,
        completedAt: input.completedAt,
        proposal: input.proposal,
      };
    },
    async expireProposal() {
      if (job?.proposal?.status !== "proposed") return false;
      order.push("expire-proposal");
      job = {
        ...job,
        proposal: { ...job.proposal, status: "expired" },
      };
      return true;
    },
  };
  return {
    store,
    getJob() {
      return job;
    },
  };
}

function configured() {
  return {
    status: "configured" as const,
    value: {
      apiKey: "anonymous",
      endpoint: "https://api.example.invalid/chat/completions",
      model: "anonymous-model",
      timeoutMs: 1_000,
      maxTokens: 1_024,
    },
  };
}

describe("AI analysis runtime", () => {
  it("persists and claims the job before making one bounded advisor call", async () => {
    const order: string[] = [];
    const memory = memoryStore(order);
    const advisor: PlanAdvisor = {
      proposeAdjustment: vi.fn<PlanAdvisor["proposeAdjustment"]>(
        async (context) => {
          order.push("advisor");
          expect(context).not.toHaveProperty("githubUserId");
          expect(context.recentFeedback).toEqual([]);
          return {
            summary: "Keep the current level",
            safetyLevel: "green",
            operations: [],
            model: "anonymous-model",
            responseHash: "b".repeat(64),
          };
        },
      ),
    };
    const runtime = createAiAnalysisRuntime({
      store: memory.store,
      prepareContext: async () => prepared(),
      readConfiguration: configured,
      createAdvisor: () => advisor,
      now: () => new Date("2026-07-24T08:00:00.000Z"),
    });

    const result = await runtime.request({
      trackerKey: "knee-rehab",
      commandId: jobId,
    });
    expect(order).toEqual([
      "create-job",
      "claim-job",
      "advisor",
      "complete-job",
    ]);
    expect(result.job?.status).toBe("succeeded");
    expect(result.job?.proposal?.id).toBe(jobId);

    await runtime.request({ trackerKey: "knee-rehab", commandId: jobId });
    expect(advisor.proposeAdjustment).toHaveBeenCalledTimes(1);
  });

  it("persists an unavailable job without calling the provider", async () => {
    const order: string[] = [];
    const memory = memoryStore(order);
    const createAdvisor = vi.fn();
    const runtime = createAiAnalysisRuntime({
      store: memory.store,
      prepareContext: async () => prepared(),
      readConfiguration: () => ({ status: "not_configured" }),
      createAdvisor,
      now: () => new Date("2026-07-24T08:00:00.000Z"),
    });
    const result = await runtime.request({
      trackerKey: "knee-rehab",
      commandId: jobId,
    });
    expect(order).toEqual(["create-job", "claim-job", "fail-job"]);
    expect(createAdvisor).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      configuration: "not_configured",
      job: { status: "failed", errorCode: "not_configured", retryable: false },
    });
  });

  it("keeps the same job id when a retry succeeds", async () => {
    const order: string[] = [];
    const memory = memoryStore(order);
    const proposeAdjustment: PlanAdvisor["proposeAdjustment"] = vi
      .fn<PlanAdvisor["proposeAdjustment"]>()
      .mockRejectedValueOnce(new Error("anonymous"))
      .mockResolvedValueOnce({
        summary: "No change",
        safetyLevel: "green",
        operations: [],
        model: "anonymous-model",
        responseHash: "c".repeat(64),
      });
    const runtime = createAiAnalysisRuntime({
      store: memory.store,
      prepareContext: async () => prepared(),
      readConfiguration: configured,
      createAdvisor: () => ({ proposeAdjustment }),
      now: () => new Date("2026-07-24T08:00:00.000Z"),
    });
    const first = await runtime.request({
      trackerKey: "knee-rehab",
      commandId: jobId,
    });
    const second = await runtime.request({
      trackerKey: "knee-rehab",
      commandId: jobId,
    });
    expect(first.job).toMatchObject({ id: jobId, status: "failed" });
    expect(second.job).toMatchObject({ id: jobId, status: "succeeded" });
    expect(proposeAdjustment).toHaveBeenCalledTimes(2);
  });

  it("expires a generated suggestion when the plan timeline head changes", async () => {
    const order: string[] = [];
    const memory = memoryStore(order);
    const original = prepared();
    const changed = {
      ...original,
      timelineHeadPlanVersionId: "019c1000-0000-7000-8000-000000000199",
      modelContext: {
        ...original.modelContext,
        timelineHeadPlanVersionId: "019c1000-0000-7000-8000-000000000199",
      },
    };
    const prepareContext = vi
      .fn()
      .mockResolvedValueOnce(original)
      .mockResolvedValue(changed);
    const runtime = createAiAnalysisRuntime({
      store: memory.store,
      prepareContext,
      readConfiguration: configured,
      createAdvisor: () => ({
        proposeAdjustment: async () => ({
          summary: "No change",
          safetyLevel: "green",
          operations: [],
          model: "anonymous-model",
          responseHash: "d".repeat(64),
        }),
      }),
      now: () => new Date("2026-07-24T08:00:00.000Z"),
    });
    await runtime.request({ trackerKey: "knee-rehab", commandId: jobId });
    const result = await runtime.load("knee-rehab", jobId);
    expect(result.job?.proposal?.status).toBe("expired");
    expect(order).toContain("expire-proposal");
  });

  it("expires a suggestion when new feedback changes the recent context", async () => {
    const order: string[] = [];
    const memory = memoryStore(order);
    const original = prepared();
    const changed = {
      ...original,
      contextHash: "b".repeat(64),
      modelContext: {
        ...original.modelContext,
        recentFeedback: [
          {
            localDate: "2026-07-24",
            timing: "morning" as const,
            leftPain: 1,
            rightPain: 0,
            swelling: "none" as const,
            stiffness: false,
            mechanicalSymptoms: false,
            weightBearingIssue: false,
            localizedBonePain: false,
            nightOrRestPain: false,
            safetyLevel: "green" as const,
          },
        ],
      },
    };
    let current = original;
    const prepareContext = vi.fn(async () => current);
    const runtime = createAiAnalysisRuntime({
      store: memory.store,
      prepareContext,
      readConfiguration: configured,
      createAdvisor: () => ({
        proposeAdjustment: async () => ({
          summary: "No change",
          safetyLevel: "green",
          operations: [],
          model: "anonymous-model",
          responseHash: "d".repeat(64),
        }),
      }),
      now: () => new Date("2026-07-24T08:00:00.000Z"),
    });

    await runtime.request({ trackerKey: "knee-rehab", commandId: jobId });
    current = changed;
    const result = await runtime.load("knee-rehab", jobId);

    expect(result.job?.proposal?.status).toBe("expired");
    expect(prepareContext).toHaveBeenCalledTimes(3);
  });

  it("expires a green suggestion after red feedback and reanalyzes with red context", async () => {
    const order: string[] = [];
    const memory = memoryStore(order);
    const original = prepared();
    const redContext: PreparedAiAnalysisContext = {
      ...original,
      contextHash: "c".repeat(64),
      safetyLevel: "red",
      modelContext: {
        ...original.modelContext,
        recentFeedback: [
          {
            localDate: "2026-07-24",
            timing: "incident",
            leftPain: 7,
            rightPain: 2,
            swelling: "obvious",
            stiffness: true,
            mechanicalSymptoms: true,
            weightBearingIssue: false,
            localizedBonePain: false,
            nightOrRestPain: false,
            safetyLevel: "red",
          },
        ],
        safetyLevel: "red",
      },
    };
    let current = original;
    const proposeAdjustment = vi.fn<PlanAdvisor["proposeAdjustment"]>(
      async (context) => ({
        summary:
          context.safetyLevel === "red" ? "Stop and reassess" : "No change",
        safetyLevel: context.safetyLevel,
        operations: [],
        model: "anonymous-model",
        responseHash: "e".repeat(64),
      }),
    );
    const runtime = createAiAnalysisRuntime({
      store: memory.store,
      prepareContext: async () => current,
      readConfiguration: configured,
      createAdvisor: () => ({ proposeAdjustment }),
      now: () => new Date("2026-07-24T08:00:00.000Z"),
    });

    await runtime.request({ trackerKey: "knee-rehab", commandId: jobId });
    current = redContext;
    const expired = await runtime.load("knee-rehab", jobId);
    const redRuntime = createAiAnalysisRuntime({
      store: memoryStore([]).store,
      prepareContext: async () => redContext,
      readConfiguration: configured,
      createAdvisor: () => ({ proposeAdjustment }),
      now: () => new Date("2026-07-24T08:01:00.000Z"),
    });
    const next = await redRuntime.request({
      trackerKey: "knee-rehab",
      commandId: "019c1000-0000-7000-8000-000000000111",
    });

    expect(expired.job?.proposal?.status).toBe("expired");
    expect(next.job?.proposal).toMatchObject({
      status: "proposed",
      safetyLevel: "red",
      operations: [],
    });
    expect(proposeAdjustment).toHaveBeenLastCalledWith(
      expect.objectContaining({ safetyLevel: "red" }),
    );
  });

  it("expires a suggestion when user-confirmed training changes", async () => {
    const order: string[] = [];
    const memory = memoryStore(order);
    const original = prepared();
    let current = original;
    const runtime = createAiAnalysisRuntime({
      store: memory.store,
      prepareContext: async () => current,
      readConfiguration: configured,
      createAdvisor: () => ({
        proposeAdjustment: async () => ({
          summary: "No change",
          safetyLevel: "green",
          operations: [],
          model: "anonymous-model",
          responseHash: "f".repeat(64),
        }),
      }),
      now: () => new Date("2026-07-24T08:00:00.000Z"),
    });

    await runtime.request({ trackerKey: "knee-rehab", commandId: jobId });
    current = {
      ...original,
      contextHash: "1".repeat(64),
      modelContext: {
        ...original.modelContext,
        confirmedTraining: [
          {
            taskDefinitionId: "anonymous-task",
            localDate: "2026-07-24",
            category: "training",
            durationMinutes: 20,
            distanceKm: null,
          },
        ],
      },
    };

    const result = await runtime.load("knee-rehab", jobId);
    expect(result.job?.proposal?.status).toBe("expired");
  });

  it("expires a suggestion when the rolling context date range changes", async () => {
    const order: string[] = [];
    const memory = memoryStore(order);
    const original = prepared();
    let current = original;
    const runtime = createAiAnalysisRuntime({
      store: memory.store,
      prepareContext: async () => current,
      readConfiguration: configured,
      createAdvisor: () => ({
        proposeAdjustment: async () => ({
          summary: "No change",
          safetyLevel: "green",
          operations: [],
          model: "anonymous-model",
          responseHash: "2".repeat(64),
        }),
      }),
      now: () => new Date("2026-07-24T08:00:00.000Z"),
    });

    await runtime.request({ trackerKey: "knee-rehab", commandId: jobId });
    current = {
      ...original,
      contextHash: "3".repeat(64),
      contextFrom: "2026-07-12",
      contextThrough: "2026-07-25",
      modelContext: {
        ...original.modelContext,
        range: { from: "2026-07-12", through: "2026-07-25" },
      },
    };

    const result = await runtime.load("knee-rehab", jobId);
    expect(result.job?.proposal?.status).toBe("expired");
  });

  it("keeps an unchanged suggestion current without writing expiration state", async () => {
    const order: string[] = [];
    const memory = memoryStore(order);
    const runtime = createAiAnalysisRuntime({
      store: memory.store,
      prepareContext: async () => prepared(),
      readConfiguration: configured,
      createAdvisor: () => ({
        proposeAdjustment: async () => ({
          summary: "No change",
          safetyLevel: "green",
          operations: [],
          model: "anonymous-model",
          responseHash: "4".repeat(64),
        }),
      }),
      now: () => new Date("2026-07-24T08:00:00.000Z"),
    });

    await runtime.request({ trackerKey: "knee-rehab", commandId: jobId });
    const first = await runtime.load("knee-rehab", jobId);
    const second = await runtime.load("knee-rehab", jobId);

    expect(first.job?.proposal?.status).toBe("proposed");
    expect(second.job?.proposal?.status).toBe("proposed");
    expect(order.filter((item) => item === "expire-proposal")).toHaveLength(0);
  });

  it("fails closed when the current context cannot be reconstructed", async () => {
    const order: string[] = [];
    const memory = memoryStore(order);
    let available = true;
    const runtime = createAiAnalysisRuntime({
      store: memory.store,
      prepareContext: async () => {
        if (!available) throw new Error("anonymous context failure");
        return prepared();
      },
      readConfiguration: configured,
      createAdvisor: () => ({
        proposeAdjustment: async () => ({
          summary: "No change",
          safetyLevel: "green",
          operations: [],
          model: "anonymous-model",
          responseHash: "5".repeat(64),
        }),
      }),
      now: () => new Date("2026-07-24T08:00:00.000Z"),
    });

    await runtime.request({ trackerKey: "knee-rehab", commandId: jobId });
    available = false;
    const result = await runtime.load("knee-rehab", jobId);

    expect(result.job?.proposal?.status).toBe("expired");
    expect(JSON.stringify(result)).not.toContain("context failure");
  });

  it("does not reuse a failed job after its structured context changes", async () => {
    const order: string[] = [];
    const memory = memoryStore(order);
    const nextContext = prepared();
    const prepareContext = vi
      .fn()
      .mockResolvedValueOnce(nextContext)
      .mockResolvedValueOnce({
        ...nextContext,
        contextHash: "f".repeat(64),
      });
    const proposeAdjustment = vi
      .fn<PlanAdvisor["proposeAdjustment"]>()
      .mockRejectedValueOnce(new Error("anonymous"));
    const runtime = createAiAnalysisRuntime({
      store: memory.store,
      prepareContext,
      readConfiguration: configured,
      createAdvisor: () => ({ proposeAdjustment }),
      now: () => new Date("2026-07-24T08:00:00.000Z"),
    });

    const first = await runtime.request({
      trackerKey: "knee-rehab",
      commandId: jobId,
    });
    const second = await runtime.request({
      trackerKey: "knee-rehab",
      commandId: jobId,
    });

    expect(first.job).toMatchObject({ status: "failed" });
    expect(second.job).toMatchObject({
      status: "failed",
      errorCode: "context_changed",
      retryable: false,
    });
    expect(proposeAdjustment).toHaveBeenCalledTimes(1);
  });
});
