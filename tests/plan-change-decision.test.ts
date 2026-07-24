import { describe, expect, it, vi } from "vitest";

import type { PlanChangeDecisionCommand } from "@/domain/ai-analysis";
import { schemaVersion } from "@/domain/schemas";
import {
  executePlanChangeDecision,
  PlanChangeNotApplicableError,
  type PlanChangeDecisionRecord,
  type PlanChangeDecisionStore,
  type PlanChangeProposalRecord,
  stablePlanVersionId,
} from "@/server/commands/plan-change-decision-core";
import type { PreparedAiAnalysisContext } from "@/server/integrations/ai/context";

const trackerId = "019c1000-0000-7000-8000-000000000401";
const proposalId = "019c1000-0000-7000-8000-000000000402";
const planId = "019c1000-0000-7000-8000-000000000403";
const commandId = "019c1000-0000-7000-8000-000000000404";

function context(): PreparedAiAnalysisContext {
  const basePlan = {
    schemaVersion,
    id: planId,
    trackerKey: "knee-rehab",
    version: 1,
    effectiveFrom: "2026-07-01",
    createdAt: "2026-07-01T00:00:00.000Z",
    createdBy: "import" as const,
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
  };
  return {
    trackerId,
    trackerKey: "knee-rehab",
    basePlanVersionId: planId,
    timelineHeadPlanVersionId: planId,
    basePlan,
    timelineHeadPlan: basePlan,
    contextVersion: "1",
    contextHash: "a".repeat(64),
    contextRevision: 7,
    contextFrom: "2026-07-11",
    contextThrough: "2026-07-24",
    safetyLevel: "green",
    modelContext: {
      currentPlan: basePlan,
      timelineHeadPlanVersionId: planId,
      planningTimeZone: "Asia/Shanghai",
      range: { from: "2026-07-11", through: "2026-07-24" },
      recentFeedback: [],
      confirmedTraining: [],
      safetyLevel: "green",
    },
  };
}

function proposalRecord(): PlanChangeProposalRecord {
  return {
    trackerId,
    trackerKey: "knee-rehab",
    planningTimeZone: "Asia/Shanghai",
    status: "proposed",
    contextVersion: "1",
    contextHash: "a".repeat(64),
    contextRevision: 7,
    basePlanVersionId: planId,
    timelineHeadPlanVersionId: planId,
    safetyLevel: "green",
    proposal: {
      schemaVersion,
      id: proposalId,
      trackerKey: "knee-rehab",
      basePlanVersionId: planId,
      createdAt: "2026-07-24T07:00:00.000Z",
      safetyLevel: "green",
      summary: "Anonymous adjustment",
      operations: [
        {
          type: "replace_task",
          taskId: "anonymous-future",
          task: {
            id: "anonymous-future",
            title: "Anonymous adjusted task",
            scheduledDate: "2026-07-27",
            sortOrder: 0,
            category: "general",
            prescription: {},
          },
          reason: "Anonymous reason",
        },
      ],
      status: "proposed",
    },
  };
}

function command(
  decision: "accepted" | "rejected" = "accepted",
  id = commandId,
): PlanChangeDecisionCommand & { trackerKey: string } {
  return {
    trackerKey: "knee-rehab",
    commandId: id,
    proposalId,
    decision,
    occurredAt: "2026-07-24T08:00:00.000Z",
    occurredTimeZone: "Asia/Shanghai",
    occurredUtcOffsetMinutes: 480,
  };
}

function memoryStore(initial = proposalRecord()) {
  let proposal = initial;
  const decisions = new Map<string, PlanChangeDecisionRecord>();
  const prepared: Parameters<PlanChangeDecisionStore["commitAtomically"]>[0][] =
    [];
  const store: PlanChangeDecisionStore = {
    async findProposal(_trackerKey, id) {
      return id === proposal.proposal.id ? proposal : null;
    },
    async findDecisionByCommandId(id) {
      return decisions.get(id) ?? null;
    },
    async findDecisionByProposalId(id) {
      return (
        [...decisions.values()].find((item) => item.proposalId === id) ?? null
      );
    },
    async expireProposal() {
      if (proposal.status !== "proposed") return false;
      proposal = {
        ...proposal,
        status: "expired",
        proposal: { ...proposal.proposal, status: "expired" },
      };
      return true;
    },
    async commitAtomically(value) {
      if (
        [...decisions.values()].some(
          (item) => item.proposalId === value.proposalId,
        )
      ) {
        throw Object.assign(new Error("unique"), { code: "23505" });
      }
      prepared.push(value);
      const saved: PlanChangeDecisionRecord = {
        id: value.decision.id,
        trackerId: value.trackerId,
        trackerKey: value.decision.trackerKey,
        proposalId: value.proposalId,
        decision: value.decision.decision,
        basePlanVersionId: value.decision.basePlanVersionId,
        timelineHeadPlanVersionId: value.decision.timelineHeadPlanVersionId,
        contextVersion: value.decision.contextVersion,
        contextHash: value.decision.contextHash,
        contextRevision: value.decision.contextRevision,
        safetyLevel: value.decision.safetyLevel,
        effectiveFrom: value.decision.effectiveFrom,
        appliedPlanVersion: value.plan,
        decidedAt: value.decision.decidedAt,
        event: value.event,
      };
      decisions.set(saved.id, saved);
      proposal = {
        ...proposal,
        status: saved.decision,
        proposal: { ...proposal.proposal, status: saved.decision },
      };
    },
  };
  return {
    store,
    prepared,
    getProposal: () => proposal,
  };
}

describe("P4b-2a plan change decisions", () => {
  it("accepts once, preserves history and projects only next-day tasks", async () => {
    const memory = memoryStore();
    const result = await executePlanChangeDecision(
      memory.store,
      async () => context(),
      command(),
      new Date("2026-07-24T08:00:01.000Z"),
    );

    expect(result).toMatchObject({
      status: "accepted",
      replayed: false,
      conflict: false,
      appliedPlanVersion: {
        id: stablePlanVersionId(commandId),
        version: 2,
        effectiveFrom: "2026-07-25",
      },
      affectedDates: ["2026-07-27"],
    });
    expect(memory.prepared[0]?.plan?.tasks[0]).toMatchObject({
      id: "anonymous-history",
      scheduledDate: "2026-07-23",
    });
    expect(memory.prepared[0]?.taskInstances).toEqual([
      { taskDefinitionId: "anonymous-future", scheduledOn: "2026-07-27" },
    ]);
    expect(
      memory.prepared[0]?.outboxes.map((item) => item.aggregateType),
    ).toEqual(["event", "plan_version"]);
  });

  it("rejects atomically without creating a plan version", async () => {
    const memory = memoryStore();
    const result = await executePlanChangeDecision(
      memory.store,
      async () => context(),
      command("rejected"),
      new Date("2026-07-24T08:00:01.000Z"),
    );
    expect(result).toMatchObject({
      status: "rejected",
      appliedPlanVersion: null,
      affectedDates: [],
    });
    expect(memory.prepared[0]).toMatchObject({
      type: "reject",
      plan: null,
      taskInstances: [],
    });
  });

  it("does not misclassify a later outbox conflict as a decision race", async () => {
    const memory = memoryStore();
    memory.store.commitAtomically = async () => {
      throw Object.assign(new Error("outbox conflict"), {
        code: "23505",
        constraint: "github_sync_outbox_aggregate_unique",
      });
    };

    await expect(
      executePlanChangeDecision(memory.store, async () => context(), command()),
    ).rejects.toThrow("outbox conflict");
    expect(memory.getProposal().status).toBe("proposed");
  });

  it("replays the same command and returns a canonical conflict for another decision", async () => {
    const memory = memoryStore();
    const prepare = vi.fn(async () => context());
    const first = await executePlanChangeDecision(
      memory.store,
      prepare,
      command(),
    );
    const replay = await executePlanChangeDecision(
      memory.store,
      prepare,
      command(),
    );
    const concurrent = await executePlanChangeDecision(
      memory.store,
      prepare,
      command("rejected", "019c1000-0000-7000-8000-000000000405"),
    );
    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, conflict: false });
    expect(concurrent).toMatchObject({
      commandId,
      status: "accepted",
      replayed: true,
      conflict: true,
    });
    expect(memory.prepared).toHaveLength(1);
  });

  it.each([
    { label: "feedback", contextHash: "b".repeat(64), contextRevision: 8 },
    { label: "training", contextHash: "c".repeat(64), contextRevision: 8 },
    { label: "date window", contextHash: "d".repeat(64), contextRevision: 7 },
  ])("expires before deciding after $label changes", async (change) => {
    const memory = memoryStore();
    const changed = { ...context(), ...change };
    const result = await executePlanChangeDecision(
      memory.store,
      async () => changed,
      command(),
    );
    expect(result.status).toBe("expired");
    expect(memory.prepared).toHaveLength(0);
    expect(memory.getProposal().status).toBe("expired");
  });

  it("blocks red and empty proposals from acceptance", async () => {
    const red = proposalRecord();
    red.safetyLevel = "red";
    red.proposal = { ...red.proposal, safetyLevel: "red" };
    const redContext = {
      ...context(),
      safetyLevel: "red" as const,
      modelContext: { ...context().modelContext, safetyLevel: "red" as const },
    };
    await expect(
      executePlanChangeDecision(
        memoryStore(red).store,
        async () => redContext,
        command(),
      ),
    ).rejects.toBeInstanceOf(PlanChangeNotApplicableError);

    const empty = proposalRecord();
    empty.proposal = { ...empty.proposal, operations: [] };
    await expect(
      executePlanChangeDecision(
        memoryStore(empty).store,
        async () => context(),
        command(),
      ),
    ).rejects.toBeInstanceOf(PlanChangeNotApplicableError);
  });
});
