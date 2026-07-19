// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

import { CalendarShell } from "@/components/calendar-shell";
import type { TodayDashboard } from "@/server/dashboard";

vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

const dashboard: TodayDashboard = {
  state: "ready",
  trackerName: "Anonymous Tracker",
  startDate: "2026-07-01",
  planVersion: 1,
  tasks: [
    {
      id: "019c0000-0000-7000-8000-000000000001",
      title: "一项用于验证窄屏换行而不会横向溢出的匿名长任务名称",
      category: "strength",
      prescription: { main: "匿名处方摘要" },
      status: "completed",
      actual: null,
      subjectiveNote: null,
    },
  ],
  feedbackCount: 1,
  feedbacks: [
    {
      id: "019c0000-0000-7000-8000-000000000002",
      occurredAt: "2026-07-18T08:00:00+08:00",
      timing: "morning",
      leftPain: 0,
      rightPain: 0,
      swelling: "none",
      safetyLevel: "green",
      note: "",
    },
  ],
  externalTrainingRecords: [],
};

function renderCalendarShell(
  selectedDate = "2026-07-18",
  overrides: Partial<ComponentProps<typeof CalendarShell>> = {},
) {
  return render(
    <CalendarShell
      month="2026-07"
      today="2026-07-19"
      selectedDate={selectedDate}
      days={[
        {
          date: "2026-07-17",
          taskCount: 1,
          completedCount: 0,
          skippedCount: 1,
          feedbackCount: 0,
        },
        {
          date: "2026-07-18",
          taskCount: 1,
          completedCount: 1,
          skippedCount: 0,
          feedbackCount: 1,
        },
        {
          date: "2026-07-19",
          taskCount: 0,
          completedCount: 0,
          skippedCount: 0,
          feedbackCount: 0,
        },
        {
          date: "2026-07-20",
          taskCount: 1,
          completedCount: 0,
          skippedCount: 0,
          feedbackCount: 0,
        },
      ]}
      monthLoading={false}
      monthError={false}
      dashboard={dashboard}
      detailLoading={false}
      detailError={false}
      onRetryDetail={vi.fn()}
      onRetryMonth={vi.fn()}
      onSelectDate={vi.fn()}
      onSelectMonth={vi.fn()}
      onExternalTrainingUpdated={vi.fn()}
      {...overrides}
    />,
  );
}

describe("calendar visual semantics", () => {
  afterEach(cleanup);

  it("describes today, selection, future plans and historical outcomes without relying on color", () => {
    renderCalendarShell();

    expect(
      screen.getByRole("button", { name: /2026-07-17.*历史.*已跳过/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: /2026-07-18.*已选中.*历史.*全部完成.*1 次反馈/,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /2026-07-19.*今天.*无任务/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /2026-07-20.*未来.*1 项计划/ }),
    ).toBeTruthy();
    expect(screen.getByText("历史记录")).toBeTruthy();
    expect(screen.getByText(dashboard.tasks[0].title)).toBeTruthy();
  });

  it("keeps the calendar available and offers a focused retry when day details fail", () => {
    const onRetryDetail = vi.fn();
    renderCalendarShell("2026-07-18", {
      dashboard: null,
      detailError: true,
      onRetryDetail,
    });

    expect(screen.getByRole("region", { name: "2026 年 7 月" })).toBeTruthy();
    screen.getByRole("button", { name: "重新加载当天详情" }).click();
    expect(onRetryDetail).toHaveBeenCalledOnce();
  });

  it("distinguishes a date before the plan from an empty planned day", () => {
    renderCalendarShell("2026-07-18", {
      dashboard: {
        ...dashboard,
        state: "not_started",
        startDate: "2026-07-20",
        planVersion: null,
        tasks: [],
        feedbackCount: 0,
        feedbacks: [],
      },
    });

    expect(screen.getByText("计划尚未开始")).toBeTruthy();
    expect(screen.queryByText("当天没有计划任务")).toBeNull();
  });

  it("shows an honest empty state and source summary for a ready day without tasks", () => {
    renderCalendarShell("2026-07-19", {
      dashboard: {
        ...dashboard,
        tasks: [],
        feedbackCount: 0,
        feedbacks: [],
      },
    });

    expect(screen.getByText("当天没有计划任务")).toBeTruthy();
    expect(screen.getByLabelText("当天概览").textContent).toContain("0 项任务");
    expect(screen.getByLabelText("当天概览").textContent).toContain("0 条来源");
  });

  it("keeps dates selectable and exposes a retry when the month summary fails", () => {
    const onRetryMonth = vi.fn();
    renderCalendarShell("2026-07-19", {
      days: [],
      monthError: true,
      onRetryMonth,
    });

    expect(
      screen.getByRole("button", {
        name: /2026-07-20.*月摘要暂时不可用/,
      }),
    ).toBeTruthy();
    screen.getByRole("button", { name: "重试" }).click();
    expect(onRetryMonth).toHaveBeenCalledOnce();
  });
});
