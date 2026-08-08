// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExternalTrainingRecord } from "@/domain/external-training";
import type { ExecutionContextToday } from "@/domain/execution-context";
import type { TodayDashboard } from "@/server/dashboard";
import { DashboardShell } from "@/components/dashboard-shell";

vi.mock("@/offline/private-offline-context", () => ({
  usePrivateOfflineIdentity: () => "anonymous-test-user",
}));

vi.mock("@/offline/offline-command-context", () => ({
  useOfflineCommands: () => ({
    commands: [],
    confirmedCommandIds: [],
    enqueue: vi.fn(),
    ready: true,
  }),
}));

vi.mock("@/client/use-network-state", () => ({
  useNetworkState: () => true,
}));

const execution = {
  context: null,
  day: null,
  alternatives: [],
  safety: { blocked: false, reason: null },
} as ExecutionContextToday;

const task = {
  id: "019c0000-0000-7000-8000-000000000002",
  title: "匿名力量训练",
  category: "strength",
  prescription: {
    exercises: [{ name: "匿名动作", dose: "2 × 8" }],
  },
  status: "planned" as const,
  actual: null,
  subjectiveNote: null,
};

const garminRecord: ExternalTrainingRecord = {
  id: "019c0000-0000-7000-8000-000000000004",
  provider: "garmin",
  localDate: "2026-08-08",
  occurredAt: "2026-08-08T02:00:00+08:00",
  sourceVersion: 1,
  details: {
    kind: "activity",
    activityType: "running",
    startedAt: "2026-08-08T02:00:00+08:00",
    durationSeconds: 1_800,
    distanceMeters: 3_000,
    averagePaceSecondsPerKilometer: 360,
    averageHeartRateBpm: 120,
  },
  association: {
    status: "confirmed",
    taskId: task.id,
    sourceVersion: 1,
    needsReview: false,
  },
  suggestion: null,
};

function dashboard(overrides: Partial<TodayDashboard> = {}): TodayDashboard {
  return {
    state: "ready",
    trackerName: "匿名 Tracker",
    startDate: "2026-07-01",
    planVersion: 1,
    tasks: [task],
    feedbackCount: 0,
    feedbacks: [],
    externalTrainingRecords: [],
    ...overrides,
  };
}

function renderDashboard(initialDashboard: TodayDashboard) {
  return render(
    <DashboardShell
      today="8月8日 · 周六"
      localDate="2026-08-08"
      planVersion={1}
      planStartsToday={false}
      initialDashboard={initialDashboard}
      execution={execution}
      onRefresh={vi.fn(async () => undefined)}
      onLatestSyncCompleted={vi.fn(async () => undefined)}
      onExecutionChanged={vi.fn(async () => undefined)}
      onTaskUpdated={vi.fn()}
      onExternalTrainingUpdated={vi.fn()}
      onExternalTrainingConflict={vi.fn()}
      onRetryPending={vi.fn(async () => undefined)}
    />,
  );
}

describe("UI-R8 Today hierarchy", () => {
  afterEach(() => cleanup());

  it("keeps the header concise and hides an empty records section", () => {
    renderDashboard(dashboard());

    expect(
      screen.getByRole("heading", { name: "今天", level: 1 }),
    ).toBeTruthy();
    expect(screen.getByText("8月8日 · 周六")).toBeTruthy();
    expect(screen.queryByText("今日训练", { selector: ".eyebrow" })).toBeNull();
    expect(screen.getByRole("button", { name: "刷新今日数据" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "同步外部训练记录" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("today-records")).toBeNull();
    expect(screen.queryByText("尚未检查新记录")).toBeNull();
  });

  it("shows actual records in one section without repeating the source under a task", () => {
    renderDashboard(dashboard({ externalTrainingRecords: [garminRecord] }));

    expect(screen.getByTestId("today-records")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "训练记录" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "跑步" })).toBeTruthy();
    expect(screen.getByText("已关联：匿名力量训练")).toBeTruthy();
    expect(screen.queryByText(/已关联 1 条来源/)).toBeNull();
  });

  it("keeps normal zero-feedback state to one formal feedback action", () => {
    renderDashboard(dashboard());

    const feedback = screen.getByRole("region", { name: "身体反馈" });
    expect(feedback.textContent).not.toContain("今天还没有");
    expect(feedback.textContent).not.toContain("告诉康复助手");
    expect(screen.getAllByRole("link", { name: "记录身体反馈" })).toHaveLength(
      1,
    );
  });

  it.each([
    ["yellow", "黄灯", "今天不要升级"],
    ["red", "红灯", "停止相关诱发负荷"],
  ] as const)(
    "keeps %s safety guidance ahead of the single formal feedback action",
    (safetyLevel, label, guidance) => {
      renderDashboard(
        dashboard({
          feedbackCount: 1,
          feedbacks: [
            {
              id: "019c0000-0000-7000-8000-000000000005",
              occurredAt: "2026-08-08T02:00:00+08:00",
              timing: "morning",
              leftPain: 0,
              rightPain: 0,
              swelling: "none",
              safetyLevel,
              note: "匿名反馈",
            },
          ],
        }),
      );

      const feedback = screen.getByRole("region", { name: "身体反馈" });
      expect(feedback.textContent).toContain(label);
      expect(feedback.textContent).toContain(guidance);
      expect(feedback.textContent).toContain("今日已记录 1 次");
      expect(
        within(feedback).getByRole("link", { name: "再次反馈" }),
      ).toBeTruthy();
      expect(within(feedback).queryByText("告诉康复助手")).toBeNull();
      expect(within(feedback).getAllByRole("link")).toHaveLength(1);
    },
  );
});
