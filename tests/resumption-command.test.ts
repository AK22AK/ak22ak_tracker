import { describe, expect, it, vi } from "vitest";

import type {
  ResumptionAssessmentSnapshot,
  ResumptionDecisionCommand,
} from "@/domain/resumption";
import {
  schemaVersion,
  type PlanVersion,
  type TrackerEvent,
} from "@/domain/schemas";
import {
  executeResumptionDecisionCommand,
  type PreparedResumptionCommand,
  type ResumptionAssessmentRecord,
  type ResumptionDecisionStore,
} from "@/server/commands/resumption-core";

const trackerId = "019c0000-0000-7000-8000-000000000201";
const planId = "019c0000-0000-7000-8000-000000000202";
const assessmentId = "019c0000-0000-7000-8000-000000000203";

const basePlan: PlanVersion = {
  schemaVersion,
  id: planId,
  trackerKey: "anonymous-tracker",
  version: 1,
  effectiveFrom: "2026-07-01",
  createdAt: "2026-07-01T00:00:00.000Z",
  createdBy: "import",
  tasks: [
    {
      id: "historical-task",
      title: "Historical task",
      scheduledDate: "2026-07-19",
      sortOrder: 0,
      category: "general",
      prescription: {},
    },
    {
      id: "future-task",
      title: "Future task",
      scheduledDate: "2026-07-23",
      sortOrder: 1,
      category: "general",
      prescription: {},
    },
  ],
};

function snapshot(
  id = assessmentId,
  base = basePlan,
  timelineHead = base,
): ResumptionAssessmentSnapshot {
  return {
    schemaVersion,
    id,
    trackerKey: "anonymous-tracker",
    trigger: {
      type: "pause",
      id: "019c0000-0000-7000-8000-000000000204",
      startDate: "2026-07-20",
      endDate: "2026-07-22",
      interruptionDays: 3,
      pausedDays: 3,
      restrictedDays: 0,
    },
    basePlanVersion: {
      id: base.id,
      version: base.version,
      effectiveFrom: base.effectiveFrom,
    },
    timelineHead: {
      id: timelineHead.id,
      version: timelineHead.version,
      effectiveFrom: timelineHead.effectiveFrom,
    },
    shiftAvailability:
      timelineHead.id === base.id
        ? {
            allowed: true,
            reason: null,
            blockingPlanVersion: null,
          }
        : {
            allowed: false,
            reason: "future_plan_version_exists",
            blockingPlanVersion: {
              id: timelineHead.id,
              version: timelineHead.version,
              effectiveFrom: timelineHead.effectiveFrom,
            },
          },
    planningTimeZone: "Asia/Shanghai",
    createdAt: "2026-07-22T08:00:00.000Z",
    recommendedEffectiveFrom: "2026-07-23",
    shiftDays: 3,
    lastConfirmedTraining: null,
    futureTasks: [
      {
        taskInstanceId: "019c0000-0000-7000-8000-000000000205",
        taskDefinitionId: "future-task",
        title: "Future task",
        category: "general",
        scheduledOn: "2026-07-23",
        status: "planned",
      },
    ],
    shiftPreview: [
      {
        taskDefinitionId: "future-task",
        title: "Future task",
        from: "2026-07-23",
        to: "2026-07-26",
      },
    ],
  };
}

function command(
  decision: "keep_original",
): Extract<ResumptionDecisionCommand, { decision: "keep_original" }>;
function command(
  decision: "shift",
): Extract<ResumptionDecisionCommand, { decision: "shift" }>;
function command(
  decision: "keep_original" | "shift",
): ResumptionDecisionCommand;
function command(
  decision: "keep_original" | "shift",
): ResumptionDecisionCommand {
  const metadata = {
    commandId: "019c0000-0000-7000-8000-000000000206",
    occurredAt: "2026-07-22T08:05:00.000Z",
    occurredTimeZone: "Asia/Shanghai",
    occurredUtcOffsetMinutes: 480,
    assessmentId,
    basePlanVersionId: planId,
    replacementAssessmentId: "019c0000-0000-7000-8000-000000000207",
  };
  return decision === "keep_original"
    ? { ...metadata, decision }
    : {
        ...metadata,
        decision,
        effectiveFrom: "2026-07-23",
        newPlanVersionId: "019c0000-0000-7000-8000-000000000208",
      };
}

function createStore() {
  const events = new Map<string, TrackerEvent>();
  const plans = new Map([[basePlan.id, basePlan]]);
  const assessments = new Map<string, ResumptionAssessmentRecord>([
    [
      assessmentId,
      {
        snapshot: snapshot(),
        status: "pending",
        decision: null,
        decidedAt: null,
        appliedPlanVersionId: null,
      },
    ],
  ]);
  let effectivePlanId = basePlan.id;
  let failCommit = false;

  const store: ResumptionDecisionStore = {
    findTracker: vi.fn(async (key) =>
      key === "anonymous-tracker"
        ? {
            id: trackerId,
            key,
            planningTimeZone: "Asia/Shanghai",
          }
        : null,
    ),
    findEventByCommandId: vi.fn(async (id) => events.get(id) ?? null),
    findAssessment: vi.fn(
      async (_trackerId, id) => assessments.get(id) ?? null,
    ),
    findPlanVersion: vi.fn(async (_trackerId, id) => plans.get(id) ?? null),
    findEffectivePlanVersion: vi.fn(
      async () => plans.get(effectivePlanId) ?? null,
    ),
    findPlanTimelineHead: vi.fn(
      async () =>
        [...plans.values()].sort(
          (left, right) => right.version - left.version,
        )[0] ?? null,
    ),
    nextPlanVersion: vi.fn(
      async () =>
        Math.max(...[...plans.values()].map((plan) => plan.version)) + 1,
    ),
    buildReplacementAssessment: vi.fn(async (existing, id, createdAt) => {
      const head = [...plans.values()].sort(
        (left, right) => right.version - left.version,
      )[0]!;
      return {
        ...snapshot(id, plans.get(effectivePlanId)!, head),
        trigger: existing.snapshot.trigger,
        createdAt: createdAt.toISOString(),
      };
    }),
    commitAtomically: vi.fn(async (prepared: PreparedResumptionCommand) => {
      if (failCommit) throw new Error("anonymous_commit_failure");
      if (prepared.type === "expire") {
        const current = assessments.get(prepared.assessmentId)!;
        assessments.set(prepared.assessmentId, {
          ...current,
          status: "expired",
        });
        assessments.set(prepared.replacement.snapshot.id, {
          snapshot: prepared.replacement.snapshot,
          status: "pending",
          decision: null,
          decidedAt: null,
          appliedPlanVersionId: null,
        });
      } else {
        const current = assessments.get(prepared.assessmentId)!;
        const shifted = prepared.type === "shift";
        assessments.set(prepared.assessmentId, {
          ...current,
          status: shifted ? "shifted" : "kept_original",
          decision: shifted ? "shift" : "keep_original",
          decidedAt: prepared.decidedAt.toISOString(),
          appliedPlanVersionId: shifted ? prepared.plan.id : null,
        });
        if (shifted) plans.set(prepared.plan.id, prepared.plan);
      }
      events.set(prepared.event.idempotencyKey, prepared.event);
    }),
  };

  return {
    store,
    assessments,
    plans,
    setEffectivePlan(plan: PlanVersion) {
      plans.set(plan.id, plan);
      effectivePlanId = plan.id;
    },
    addFuturePlan(plan: PlanVersion) {
      plans.set(plan.id, plan);
    },
    setFailCommit(value: boolean) {
      failCommit = value;
    },
  };
}

describe("resumption decisions", () => {
  it("keeps the original plan without creating a new version and replays", async () => {
    const { store, assessments, plans } = createStore();
    const input = command("keep_original");

    const first = await executeResumptionDecisionCommand(store, {
      ...input,
      trackerKey: "anonymous-tracker",
    });
    const replay = await executeResumptionDecisionCommand(store, {
      ...input,
      trackerKey: "anonymous-tracker",
    });

    expect(first).toMatchObject({ status: "kept_original", replayed: false });
    expect(replay).toMatchObject({ status: "kept_original", replayed: true });
    expect(plans).toHaveLength(1);
    expect(assessments.get(assessmentId)?.status).toBe("kept_original");
  });

  it("creates one immutable shifted plan without changing historical tasks", async () => {
    const { store, assessments, plans } = createStore();
    const input = command("shift");

    const first = await executeResumptionDecisionCommand(store, {
      ...input,
      trackerKey: "anonymous-tracker",
    });
    const replay = await executeResumptionDecisionCommand(store, {
      ...input,
      trackerKey: "anonymous-tracker",
    });

    expect(first).toMatchObject({
      status: "shifted",
      appliedPlanVersionId: input.newPlanVersionId,
      replayed: false,
    });
    expect(replay).toMatchObject({ status: "shifted", replayed: true });
    expect(plans).toHaveLength(2);
    expect(plans.get(input.newPlanVersionId)?.tasks).toEqual([
      expect.objectContaining({
        id: "historical-task",
        scheduledDate: "2026-07-19",
      }),
      expect.objectContaining({
        id: "future-task",
        scheduledDate: "2026-07-26",
      }),
    ]);
    expect(basePlan.tasks[1]?.scheduledDate).toBe("2026-07-23");
    expect(assessments.get(assessmentId)?.status).toBe("shifted");
  });

  it("expires and rebuilds when the base plan changed before confirmation", async () => {
    const { store, assessments, setEffectivePlan } = createStore();
    const newer = {
      ...basePlan,
      id: "019c0000-0000-7000-8000-000000000209",
      version: 2,
    };
    setEffectivePlan(newer);

    const result = await executeResumptionDecisionCommand(store, {
      ...command("keep_original"),
      trackerKey: "anonymous-tracker",
    });

    expect(result).toMatchObject({
      status: "expired",
      replacementAssessmentId: "019c0000-0000-7000-8000-000000000207",
    });
    expect(assessments.get(assessmentId)?.status).toBe("expired");
    expect(
      assessments.get("019c0000-0000-7000-8000-000000000207")?.snapshot
        .basePlanVersion.id,
    ).toBe(newer.id);
  });

  it.each(["keep_original", "shift"] as const)(
    "expires a stale %s assessment when a future timeline version was added",
    async (decision) => {
      const { store, assessments, addFuturePlan } = createStore();
      const future = {
        ...basePlan,
        id: "019c0000-0000-7000-8000-000000000219",
        version: 2,
        effectiveFrom: "2026-08-01",
      };
      addFuturePlan(future);

      const result = await executeResumptionDecisionCommand(store, {
        ...command(decision),
        trackerKey: "anonymous-tracker",
      });

      expect(result).toMatchObject({
        status: "expired",
        replacementAssessmentId: "019c0000-0000-7000-8000-000000000207",
      });
      expect(assessments.get(assessmentId)?.status).toBe("expired");
      expect(
        assessments.get("019c0000-0000-7000-8000-000000000207")?.snapshot,
      ).toMatchObject({
        timelineHead: { id: future.id, version: 2 },
        shiftAvailability: {
          allowed: false,
          reason: "future_plan_version_exists",
        },
      });
    },
  );

  it("rejects shift when a future timeline version already existed at assessment creation", async () => {
    const { store, assessments, addFuturePlan } = createStore();
    const future = {
      ...basePlan,
      id: "019c0000-0000-7000-8000-000000000220",
      version: 2,
      effectiveFrom: "2026-08-01",
    };
    addFuturePlan(future);
    const current = assessments.get(assessmentId)!;
    assessments.set(assessmentId, {
      ...current,
      snapshot: snapshot(assessmentId, basePlan, future),
    });

    await expect(
      executeResumptionDecisionCommand(store, {
        ...command("shift"),
        trackerKey: "anonymous-tracker",
      }),
    ).rejects.toMatchObject({ message: "resumption_shift_not_available" });
    expect(assessments.get(assessmentId)?.status).toBe("pending");
  });

  it("still permits keep original when a future timeline version existed at assessment creation", async () => {
    const { store, assessments, addFuturePlan } = createStore();
    const future = {
      ...basePlan,
      id: "019c0000-0000-7000-8000-000000000221",
      version: 2,
      effectiveFrom: "2026-08-01",
    };
    addFuturePlan(future);
    const current = assessments.get(assessmentId)!;
    assessments.set(assessmentId, {
      ...current,
      snapshot: snapshot(assessmentId, basePlan, future),
    });

    await expect(
      executeResumptionDecisionCommand(store, {
        ...command("keep_original"),
        trackerKey: "anonymous-tracker",
      }),
    ).resolves.toMatchObject({ status: "kept_original" });
  });

  it("does not change the assessment when the atomic commit fails", async () => {
    const { store, assessments, setFailCommit } = createStore();
    setFailCommit(true);

    await expect(
      executeResumptionDecisionCommand(store, {
        ...command("shift"),
        trackerKey: "anonymous-tracker",
      }),
    ).rejects.toThrow("anonymous_commit_failure");
    expect(assessments.get(assessmentId)?.status).toBe("pending");
  });
});
