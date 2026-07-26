import { describe, expect, it, vi } from "vitest";

import type {
  CreateEvaluationResultCommand,
  CreateEvaluationSessionCommand,
  EvaluationDecisionDocument,
  EvaluationResultDocument,
} from "@/domain/evaluation";
import {
  schemaVersion,
  type PlanVersion,
  type TrackerEvent,
} from "@/domain/schemas";
import {
  createEvaluationRuntime,
  EvaluationNotEligibleError,
  type EvaluationContext,
  type EvaluationSessionRecord,
  type EvaluationStore,
} from "@/server/evaluation/runtime";

const trackerId = "019c0000-0000-7000-8000-000000000811";
const planId = "019c0000-0000-7000-8000-000000000812";
const commandId = "019c0000-0000-7000-8000-000000000813";

const plan: PlanVersion = {
  schemaVersion,
  id: planId,
  trackerKey: "anonymous-tracker",
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
};

function context(): EvaluationContext {
  return {
    tracker: {
      id: trackerId,
      key: "anonymous-tracker",
      startedOn: "2026-06-01",
      planningTimeZone: "Asia/Shanghai",
      aiContextRevision: 0,
    },
    planVersions: [plan],
    timelineHeadPlanVersion: plan,
    basePlanVersion: plan,
    tasks: [],
    feedbacks: [],
    pauses: [],
    contexts: [],
    degradedDates: [],
  };
}

function command(): CreateEvaluationSessionCommand {
  return {
    commandId,
    kind: "final",
    occurredAt: "2026-06-09T08:00:00.000Z",
    occurredTimeZone: "Asia/Shanghai",
    occurredUtcOffsetMinutes: 480,
  };
}

function resultCommand(): CreateEvaluationResultCommand {
  return {
    commandId: "019c0000-0000-7000-8000-000000000815",
    sessionId: commandId,
    occurredAt: "2026-06-09T09:00:00.000Z",
    occurredTimeZone: "Asia/Shanghai",
    occurredUtcOffsetMinutes: 480,
    answers: {
      goalCompletion: "partially_met",
      sides: {
        left: {
          symptomResponse: "mild",
          strengthAndControl: "ready",
          loadTolerance: "limited",
        },
        right: {
          symptomResponse: "none",
          strengthAndControl: "ready",
          loadTolerance: "ready",
        },
      },
      nextStageIntent: "undecided",
    },
  };
}

function createStore() {
  let current = context();
  let session: EvaluationSessionRecord | null = null;
  let result: EvaluationResultDocument | null = null;
  let decision: EvaluationDecisionDocument | null = null;
  const events = new Map<string, TrackerEvent>();
  let failCommit = false;
  let redSafety = false;
  const store: EvaluationStore = {
    loadContext: vi.fn(async () => current),
    findLatestSession: vi.fn(async () => session),
    findEventByCommandId: vi.fn(async (id) => events.get(id) ?? null),
    findResultBySessionId: vi.fn(async (_trackerId, sessionId) =>
      result?.sessionId === sessionId ? result : null,
    ),
    findDecisionBySessionId: vi.fn(async (_trackerId, sessionId) =>
      decision?.sessionId === sessionId ? decision : null,
    ),
    hasRedSafetySignal: vi.fn(async () => redSafety),
    expireSession: vi.fn(async (id) => {
      if (!session || session.snapshot.id !== id || session.status !== "open") {
        return false;
      }
      session = { ...session, status: "expired" };
      return true;
    }),
    commitAtomically: vi.fn(async (prepared) => {
      if (failCommit) throw new Error("anonymous_commit_failure");
      session = { snapshot: prepared.snapshot, status: "open" };
      events.set(prepared.event.idempotencyKey, prepared.event);
    }),
    commitResultAtomically: vi.fn(async (prepared) => {
      if (failCommit) throw new Error("anonymous_commit_failure");
      if (result) {
        throw Object.assign(new Error("anonymous_unique_conflict"), {
          code: "23505",
        });
      }
      result = prepared.result;
      events.set(prepared.event.idempotencyKey, prepared.event);
    }),
    commitDecisionAtomically: vi.fn(async (prepared) => {
      if (failCommit) throw new Error("anonymous_commit_failure");
      if (decision) {
        throw Object.assign(new Error("anonymous_unique_conflict"), {
          code: "23505",
        });
      }
      decision = prepared.decision;
      events.set(prepared.event.idempotencyKey, prepared.event);
    }),
  };
  return {
    store,
    setDateTarget(targetDate: string) {
      const head = current.timelineHeadPlanVersion!;
      current = {
        ...current,
        timelineHeadPlanVersion: {
          ...head,
          tasks: head.tasks.map((task) => ({
            ...task,
            scheduledDate: targetDate,
          })),
        },
      };
    },
    addTimelineVersion(next: PlanVersion) {
      current = {
        ...current,
        planVersions: [...current.planVersions, next],
        timelineHeadPlanVersion: next,
        basePlanVersion: next,
      };
    },
    failCommit() {
      failCommit = true;
    },
    setRedSafety(value: boolean) {
      redSafety = value;
    },
    getSession: () => session,
    getDecision: () => decision,
  };
}

describe("P4c-1 evaluation runtime", () => {
  it("does not open the final evaluation before the server-derived target date", async () => {
    const { store } = createStore();
    const runtime = createEvaluationRuntime({
      store,
      now: () => new Date("2026-06-08T08:00:00.000Z"),
    });

    await expect(
      runtime.create("anonymous-tracker", command()),
    ).rejects.toBeInstanceOf(EvaluationNotEligibleError);
    expect(store.commitAtomically).not.toHaveBeenCalled();
    await expect(runtime.load("anonymous-tracker")).resolves.toMatchObject({
      state: "before_target",
      targetDate: "2026-06-09",
    });
  });

  it("atomically creates one session/event/outbox and replays the stable command", async () => {
    const holder = createStore();
    const runtime = createEvaluationRuntime({
      store: holder.store,
      now: () => new Date("2026-06-09T08:05:00.000Z"),
    });

    const first = await runtime.create("anonymous-tracker", command());
    const replay = await runtime.create("anonymous-tracker", command());

    expect(first).toMatchObject({
      state: "opened",
      session: { id: commandId },
    });
    expect(replay).toEqual(first);
    expect(holder.store.commitAtomically).toHaveBeenCalledTimes(1);
    const prepared = vi.mocked(holder.store.commitAtomically).mock.calls[0]![0];
    expect(prepared.event.kind).toBe("evaluation_session_created");
    expect(prepared.outbox.targetPath).toContain(`/events/`);
    expect(prepared.snapshot.effectiveness.status).toBe("needs_policy");
  });

  it("expires an opened session when the plan timeline head changes", async () => {
    const holder = createStore();
    const runtime = createEvaluationRuntime({
      store: holder.store,
      now: () => new Date("2026-06-09T08:05:00.000Z"),
    });
    await runtime.create("anonymous-tracker", command());
    const nextPlan: PlanVersion = {
      ...plan,
      id: "019c0000-0000-7000-8000-000000000814",
      version: 2,
      effectiveFrom: "2026-06-10",
      createdAt: "2026-06-09T09:00:00.000Z",
      tasks: plan.tasks.map((task) => ({
        ...task,
        scheduledDate: "2026-06-10",
      })),
    };
    holder.addTimelineVersion(nextPlan);

    await expect(runtime.load("anonymous-tracker")).resolves.toMatchObject({
      state: "expired",
      targetDate: "2026-06-10",
      canOpenReplacement: false,
      session: { status: "expired" },
    });
    expect(holder.store.expireSession).toHaveBeenCalledTimes(1);
  });

  it("does not leave a session when the atomic commit fails", async () => {
    const holder = createStore();
    holder.failCommit();
    const runtime = createEvaluationRuntime({
      store: holder.store,
      now: () => new Date("2026-06-09T08:05:00.000Z"),
    });

    await expect(
      runtime.create("anonymous-tracker", command()),
    ).rejects.toThrow("anonymous_commit_failure");
    expect(holder.getSession()).toBeNull();
  });
});

describe("P4c-2a immutable evaluation result runtime", () => {
  it("records one canonical result and replays the stable command", async () => {
    const holder = createStore();
    const runtime = createEvaluationRuntime({
      store: holder.store,
      now: () => new Date("2026-06-09T09:05:00.000Z"),
    });
    await runtime.create("anonymous-tracker", command());

    const first = await runtime.submitResult(
      "anonymous-tracker",
      resultCommand(),
    );
    const replay = await runtime.submitResult(
      "anonymous-tracker",
      resultCommand(),
    );

    expect(first).toMatchObject({
      state: "opened",
      result: {
        id: resultCommand().commandId,
        sessionId: commandId,
        sides: {
          left: { symptomResponse: "mild" },
          right: { symptomResponse: "none" },
        },
      },
    });
    expect(replay).toEqual(first);
  });

  it("fails closed when a red safety signal exists", async () => {
    const holder = createStore();
    const runtime = createEvaluationRuntime({
      store: holder.store,
      now: () => new Date("2026-06-09T09:05:00.000Z"),
    });
    await runtime.create("anonymous-tracker", command());
    holder.setRedSafety(true);

    await expect(
      runtime.submitResult("anonymous-tracker", resultCommand()),
    ).rejects.toThrow("red_safety");
    expect(holder.store.commitResultAtomically).not.toHaveBeenCalled();
    await expect(runtime.load("anonymous-tracker")).resolves.toMatchObject({
      state: "opened",
      resultSubmission: { allowed: false, blockedReason: "red_safety" },
    });
  });

  it("expires the session instead of saving after the plan timeline changes", async () => {
    const holder = createStore();
    const runtime = createEvaluationRuntime({
      store: holder.store,
      now: () => new Date("2026-06-09T09:05:00.000Z"),
    });
    await runtime.create("anonymous-tracker", command());
    holder.addTimelineVersion({
      ...plan,
      id: "019c0000-0000-7000-8000-000000000816",
      version: 2,
      effectiveFrom: "2026-06-10",
      createdAt: "2026-06-09T09:01:00.000Z",
    });

    await expect(
      runtime.submitResult("anonymous-tracker", resultCommand()),
    ).rejects.toThrow("evaluation_result_not_eligible");
    expect(holder.store.commitResultAtomically).not.toHaveBeenCalled();
  });
});

describe("P4c-2b manual evaluation decision runtime", () => {
  it("records one canonical manual decision without creating a plan", async () => {
    const holder = createStore();
    const runtime = createEvaluationRuntime({
      store: holder.store,
      now: () => new Date("2026-06-09T10:05:00.000Z"),
    });
    await runtime.create("anonymous-tracker", command());
    await runtime.submitResult("anonymous-tracker", resultCommand());
    const decisionCommand = {
      commandId: "019c0000-0000-7000-8000-000000000818",
      sessionId: commandId,
      occurredAt: "2026-06-09T10:00:00.000Z",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
      decision: {
        weeklyConfirmations: [
          {
            weekStart: "2026-06-01",
            weekEnd: "2026-06-07",
            status: "effective" as const,
          },
          {
            weekStart: "2026-06-08",
            weekEnd: "2026-06-14",
            status: "uncertain" as const,
          },
        ],
        branch: "maintain" as const,
      },
    };

    const first = await runtime.submitDecision(
      "anonymous-tracker",
      decisionCommand,
    );
    const replay = await runtime.submitDecision(
      "anonymous-tracker",
      decisionCommand,
    );

    expect(first).toMatchObject({
      state: "opened",
      decision: { id: decisionCommand.commandId, branch: "maintain" },
    });
    expect(replay).toEqual(first);
    expect(holder.store.commitDecisionAtomically).toHaveBeenCalledTimes(1);
  });

  it("allows only professional review when frozen or current evidence is red", async () => {
    const holder = createStore();
    const runtime = createEvaluationRuntime({
      store: holder.store,
      now: () => new Date("2026-06-09T10:05:00.000Z"),
    });
    await runtime.create("anonymous-tracker", command());
    await runtime.submitResult("anonymous-tracker", resultCommand());
    holder.setRedSafety(true);

    await expect(
      runtime.submitDecision("anonymous-tracker", {
        commandId: "019c0000-0000-7000-8000-000000000819",
        sessionId: commandId,
        occurredAt: "2026-06-09T10:00:00.000Z",
        occurredTimeZone: "Asia/Shanghai",
        occurredUtcOffsetMinutes: 480,
        decision: {
          weeklyConfirmations: [
            {
              weekStart: "2026-06-01",
              weekEnd: "2026-06-07",
              status: "effective",
            },
            {
              weekStart: "2026-06-08",
              weekEnd: "2026-06-14",
              status: "uncertain",
            },
          ],
          branch: "extend",
        },
      }),
    ).rejects.toThrow("red_safety");
    expect(holder.store.commitDecisionAtomically).not.toHaveBeenCalled();
  });
});
