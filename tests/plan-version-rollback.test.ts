import { describe, expect, it } from "vitest";

import type { PlanVersionRollbackCommand } from "@/domain/ai-analysis";
import { schemaVersion, type PlanVersion } from "@/domain/schemas";
import {
  executePlanVersionRollback,
  PlanVersionRollbackNotApplicableError,
  stableRollbackPlanVersionId,
  type PlanVersionRollbackRecord,
  type PlanVersionRollbackSource,
  type PlanVersionRollbackStore,
} from "@/server/commands/plan-version-rollback-core";

const trackerId = "019c2000-0000-7000-8000-000000000001";
const proposalId = "019c2000-0000-7000-8000-000000000002";
const decisionId = "019c2000-0000-7000-8000-000000000003";
const basePlanId = "019c2000-0000-7000-8000-000000000004";
const appliedPlanId = "019c2000-0000-7000-8000-000000000005";
const commandId = "019c2000-0000-7000-8000-000000000006";

function plan(
  id: string,
  version: number,
  title: string,
  effectiveFrom: string,
): PlanVersion {
  return {
    schemaVersion,
    id,
    trackerKey: "knee-rehab",
    version,
    effectiveFrom,
    createdAt: `${effectiveFrom}T00:00:00.000Z`,
    createdBy: version === 1 ? "import" : "ai_accepted",
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
        title,
        scheduledDate: "2026-07-26",
        sortOrder: 0,
        category: "general",
        prescription: {},
      },
    ],
  };
}

function source(): PlanVersionRollbackSource {
  const basePlan = plan(basePlanId, 1, "Anonymous original task", "2026-07-01");
  const appliedPlan = plan(
    appliedPlanId,
    2,
    "Anonymous adjusted task",
    "2026-07-25",
  );
  return {
    trackerId,
    trackerKey: "knee-rehab",
    planningTimeZone: "Asia/Shanghai",
    proposalId,
    decisionId,
    decision: "accepted",
    targetBasePlan: basePlan,
    sourceAppliedPlan: appliedPlan,
    timelineHeadPlan: appliedPlan,
  };
}

function command(id = commandId): PlanVersionRollbackCommand & {
  trackerKey: string;
} {
  return {
    trackerKey: "knee-rehab",
    proposalId,
    commandId: id,
    occurredAt: "2026-07-24T08:00:00.000Z",
    occurredTimeZone: "Asia/Shanghai",
    occurredUtcOffsetMinutes: 480,
  };
}

function memoryStore(initial = source()) {
  let current = initial;
  const records = new Map<string, PlanVersionRollbackRecord>();
  const prepared: Parameters<
    PlanVersionRollbackStore["commitAtomically"]
  >[0][] = [];
  const store: PlanVersionRollbackStore = {
    async findSource(_trackerKey, id) {
      return id === current.proposalId ? current : null;
    },
    async findRollbackByCommandId(id) {
      return records.get(id) ?? null;
    },
    async findRollbackByAppliedPlanVersionId(id) {
      return (
        [...records.values()].find(
          (record) => record.sourceAppliedPlanVersionId === id,
        ) ?? null
      );
    },
    async commitAtomically(value) {
      if (
        [...records.values()].some(
          (record) =>
            record.sourceAppliedPlanVersionId ===
            value.rollback.sourceAppliedPlanVersionId,
        )
      ) {
        throw Object.assign(new Error("unique"), {
          code: "23505",
          constraint: "plan_version_rollbacks_source_applied_unique",
        });
      }
      prepared.push(value);
      const record: PlanVersionRollbackRecord = {
        ...value.rollback,
        trackerKey: current.trackerKey,
        newPlanVersion: value.plan,
        event: value.event,
      };
      records.set(record.id, record);
      current = { ...current, timelineHeadPlan: value.plan };
    },
  };
  return {
    store,
    prepared,
    setSource: (value: PlanVersionRollbackSource) => (current = value),
  };
}

describe("P4b-2b immutable plan rollback", () => {
  it("creates a new full plan version and projects only next-day tasks", async () => {
    const memory = memoryStore();
    const result = await executePlanVersionRollback(
      memory.store,
      command(),
      new Date("2026-07-24T08:00:01.000Z"),
    );

    expect(result).toMatchObject({
      status: "rolled_back",
      replayed: false,
      conflict: false,
      newPlanVersion: {
        id: stableRollbackPlanVersionId(commandId),
        version: 3,
        effectiveFrom: "2026-07-25",
      },
      affectedDates: ["2026-07-26"],
    });
    expect(memory.prepared[0]?.plan.tasks).toEqual(
      source().targetBasePlan.tasks,
    );
    expect(memory.prepared[0]?.plan.createdBy).toBe("user");
    expect(memory.prepared[0]?.taskInstances).toEqual([
      { taskDefinitionId: "anonymous-future", scheduledOn: "2026-07-26" },
    ]);
    expect(
      memory.prepared[0]?.outboxes.map((item) => item.aggregateType),
    ).toEqual(["event", "plan_version"]);
  });

  it("replays the same command and gives a canonical conflict to another command", async () => {
    const memory = memoryStore();
    const first = await executePlanVersionRollback(memory.store, command());
    const replay = await executePlanVersionRollback(memory.store, command());
    const concurrent = await executePlanVersionRollback(
      memory.store,
      command("019c2000-0000-7000-8000-000000000007"),
    );
    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({ replayed: true, conflict: false });
    expect(concurrent).toMatchObject({
      commandId,
      replayed: true,
      conflict: true,
      status: "rolled_back",
    });
    expect(memory.prepared).toHaveLength(1);
  });

  it("blocks rollback when the applied AI version is no longer the timeline head", async () => {
    const memory = memoryStore({
      ...source(),
      timelineHeadPlan: plan(
        "019c2000-0000-7000-8000-000000000008",
        3,
        "Anonymous later task",
        "2026-07-27",
      ),
    });
    const result = await executePlanVersionRollback(memory.store, command());
    expect(result).toMatchObject({
      status: "blocked",
      blockedReason: "later_plan_version",
      newPlanVersion: null,
    });
    expect(memory.prepared).toHaveLength(0);
  });

  it("rejects non-accepted decisions", async () => {
    const memory = memoryStore({
      ...source(),
      decision: "rejected",
      sourceAppliedPlan: null,
    });
    await expect(
      executePlanVersionRollback(memory.store, command()),
    ).rejects.toBeInstanceOf(PlanVersionRollbackNotApplicableError);
  });
});
