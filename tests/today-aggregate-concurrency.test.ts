import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTracker: vi.fn(),
  getPlan: vi.fn(),
  getTrackerAndPlan: vi.fn(),
  getDay: vi.fn(),
  getPolicy: vi.fn(),
  getExternalRecords: vi.fn(),
  createExecutionStore: vi.fn(() => ({ anonymous: true })),
  getExecution: vi.fn(),
}));

vi.mock("@/server/dashboard", () => ({
  getCalendarMonthForTracker: vi.fn(),
  getEffectivePlanDashboardContext: mocks.getPlan,
  getTrackerAndEffectivePlanDashboardContext: mocks.getTrackerAndPlan,
  getTodayDashboardForTracker: mocks.getDay,
  getTrackerDashboardContext: mocks.getTracker,
}));
vi.mock("@/server/safety-policy/repository", () => ({
  getEffectiveTrackerSafetyPolicyByTrackerId: mocks.getPolicy,
}));
vi.mock("@/server/integrations/core/external-training-aggregate", () => ({
  getExternalTrainingRecordsForDay: mocks.getExternalRecords,
}));
vi.mock("@/server/execution-context/aggregate", () => ({
  createNeonExecutionContextAggregateStore: mocks.createExecutionStore,
}));
vi.mock("@/server/execution-context/aggregate-core", () => ({
  getExecutionContextToday: mocks.getExecution,
}));

import { getTodayAggregate } from "@/server/aggregates/tracker";

const tracker = {
  id: "019c0000-0000-7000-8000-000000000001",
  key: "knee-rehab",
  name: "Anonymous Tracker",
  startedOn: "2026-07-01",
  planningTimeZone: "Asia/Shanghai",
};
const plan = {
  id: "019c0000-0000-7000-8000-000000000002",
  version: 1,
  effectiveFrom: "2026-07-01",
};
const day = {
  state: "ready" as const,
  trackerName: tracker.name,
  startDate: tracker.startedOn,
  planVersion: 1,
  tasks: [],
  feedbackCount: 0,
  feedbacks: [],
};
const policy = {
  schemaVersion: "1.0.0" as const,
  policyId: "019c0000-0000-7000-8000-000000000003",
  trackerKey: tracker.key,
  version: 1,
  effectiveFrom: "2026-07-01T00:00:00.000Z",
  createdAt: "2026-07-01T00:00:00.000Z",
  createdBy: "import" as const,
  rules: [
    {
      id: "anonymous-warning",
      outcome: "yellow" as const,
      match: "all" as const,
      conditions: [
        {
          operator: "number_gte" as const,
          field: "score",
          value: 999,
        },
      ],
    },
  ],
  hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};
const execution = {
  pause: null,
  context: null,
  day: null,
  alternatives: [],
  resumption: null,
  safety: { blocked: false, reason: null },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("today aggregate query waves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTracker.mockResolvedValue(tracker);
    mocks.getDay.mockResolvedValue(day);
    mocks.getPolicy.mockResolvedValue(policy);
    mocks.getExternalRecords.mockResolvedValue([]);
    mocks.getExecution.mockImplementation(
      async (_store, _date, hasRedFeedback: boolean | Promise<boolean>) => {
        await hasRedFeedback;
        return execution;
      },
    );
  });

  it("starts day, safety policy, and execution reads in the same post-context wave", async () => {
    const pendingContext = deferred<{
      tracker: typeof tracker;
      plan: typeof plan;
    }>();
    mocks.getTrackerAndPlan.mockReturnValue(pendingContext.promise);

    const aggregatePromise = getTodayAggregate(tracker.key, "2026-07-24");

    await vi.waitFor(() =>
      expect(mocks.getTrackerAndPlan).toHaveBeenCalledOnce(),
    );
    expect(mocks.getDay).not.toHaveBeenCalled();
    expect(mocks.getPolicy).not.toHaveBeenCalled();
    expect(mocks.getExecution).not.toHaveBeenCalled();

    pendingContext.resolve({ tracker, plan });
    await vi.waitFor(() => expect(mocks.getDay).toHaveBeenCalledOnce());
    expect(mocks.getPolicy).toHaveBeenCalledOnce();
    expect(mocks.getExecution).toHaveBeenCalledOnce();
    await expect(aggregatePromise).resolves.toMatchObject({
      targetDate: "2026-07-24",
      tracker: { key: tracker.key },
    });
  });
});
