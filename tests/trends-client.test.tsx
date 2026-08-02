// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TrendsClient } from "@/components/trends-client";
import type { TrendsAggregate } from "@/domain/trends";

const weekDates = [
  ["2026-06-01", "2026-06-07"],
  ["2026-06-08", "2026-06-14"],
  ["2026-06-15", "2026-06-21"],
  ["2026-06-22", "2026-06-28"],
  ["2026-06-29", "2026-07-05"],
  ["2026-07-06", "2026-07-12"],
  ["2026-07-13", "2026-07-19"],
  ["2026-07-20", "2026-07-26"],
] as const;

const weeks = weekDates.map(([weekStart, weekEnd], index) => ({
  weekStart,
  weekEnd,
  isCurrentWeek: index === 7,
  tasks: {
    planned: index === 7 ? 1 : 0,
    completed: index === 7 ? 2 : 1,
    skipped: index === 7 ? 1 : 0,
    total: index === 7 ? 4 : 1,
    completionRate: index === 7 ? 0.5 : 1,
  },
  symptoms: {
    feedbackDays: index === 7 ? 2 : 1,
    expectedDays: index === 7 ? 3 : 7,
    maxPain: index === 7 ? 6 : 2,
    safetyDays: {
      green: index === 7 ? 1 : 1,
      yellow: index === 7 ? 1 : 0,
      red: 0,
    },
  },
  load: {
    completedTrainingDays: index === 7 ? 2 : 1,
    measuredDurationMinutes: index === 7 ? 75 : null,
    durationCoveredTasks: index === 7 ? 1 : 0,
    completedTasks: index === 7 ? 2 : 1,
    measuredDistanceKm: index === 7 ? 5.2 : null,
    distanceCoveredTasks: index === 7 ? 1 : 0,
    sourceCoverage: {
      manual: index === 7 ? 1 : 0,
      garmin: 0,
      xunji: 0,
      fallbackUnmeasured: index === 7 ? 1 : 1,
    },
  },
  recovery: {
    sleep: {
      availableDays: index === 7 ? 2 : 0,
      expectedDays: index === 7 ? 3 : 7,
      averageTotalSleepSeconds: index === 7 ? 27_000 : null,
      averageSleepScore: index === 7 ? 80 : null,
      scoreCoverageDays: index === 7 ? 1 : 0,
    },
    steps: {
      availableDays: index === 7 ? 2 : 0,
      expectedDays: index === 7 ? 2 : 7,
      throughDate: index === 7 ? "2026-07-21" : weekEnd,
      averageDailySteps: index === 7 ? 2_000 : null,
    },
  },
}));

const aggregate = {
  trackerKey: "knee-rehab",
  range: {
    start: weeks[0].weekStart,
    end: weeks[7].weekEnd,
    currentDate: "2026-07-22",
  },
  timeZone: "Asia/Shanghai",
  generatedAt: "2026-07-22T04:00:00.000Z",
  weeks,
};

function aggregateWithoutRecords(): TrendsAggregate {
  return {
    ...aggregate,
    weeks: aggregate.weeks.map((week) => ({
      ...week,
      tasks: {
        planned: 0,
        completed: 0,
        skipped: 0,
        total: 0,
        completionRate: null,
      },
      symptoms: {
        feedbackDays: 0,
        expectedDays: week.symptoms.expectedDays,
        maxPain: null,
        safetyDays: { green: 0, yellow: 0, red: 0 },
      },
      load: {
        completedTrainingDays: 0,
        measuredDurationMinutes: null,
        durationCoveredTasks: 0,
        completedTasks: 0,
        measuredDistanceKm: null,
        distanceCoveredTasks: 0,
        sourceCoverage: {
          manual: 0,
          garmin: 0,
          xunji: 0,
          fallbackUnmeasured: 0,
        },
      },
      recovery: {
        sleep: {
          availableDays: 0,
          expectedDays: week.recovery.sleep.expectedDays,
          averageTotalSleepSeconds: null,
          averageSleepScore: null,
          scoreCoverageDays: 0,
        },
        steps: {
          availableDays: 0,
          expectedDays: week.recovery.steps.expectedDays,
          throughDate: week.recovery.steps.throughDate,
          averageDailySteps: null,
        },
      },
    })),
  };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function renderTrends(
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TrendsClient />
    </QueryClientProvider>,
  );
}

describe("P4a-1 TrendsClient", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders a compact accessible eight-week summary without relying on color", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(aggregate)),
    );

    renderTrends();

    expect(screen.getByRole("main", { name: "趋势页面" })).toBeTruthy();
    expect(screen.getByText("正在整理最近记录…")).toBeTruthy();
    expect(
      await screen.findByRole("heading", { name: "完成 2/4（50%）" }),
    ).toBeTruthy();
    expect(
      screen.getAllByText("最高疼痛 6/10（2/3 天）").length,
    ).toBeGreaterThan(0);
    const trendList = screen.getByRole("list", { name: "最近八周趋势" });
    expect(trendList).toBeTruthy();
    expect(within(trendList).getAllByRole("listitem")).toHaveLength(8);
    expect(
      screen.getByRole("listitem", {
        name: /本周：完成 2\/4（50%）；最高疼痛 6\/10（2\/3 天）；训练 75 分钟 · 5.2 公里；睡眠 7 小时 30 分钟 · 步数 2,000。/,
      }),
    ).toBeTruthy();
    expect(screen.getByText(/缺失记录不会按 0 计算/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      "本周有 1 天黄灯，请留意身体反馈。",
    );
    expect(screen.getByText("查看数据覆盖与说明")).toBeTruthy();
    expect(screen.getByText(/来源：手工 1 项；未测量 1 项/)).toBeTruthy();
    expect(screen.getByText(/绿灯 1 天；黄灯 1 天；红灯 0 天/)).toBeTruthy();
    expect(screen.getByText(/睡眠评分 80，覆盖 1 天/)).toBeTruthy();
    expect(screen.getByText("更多")).toBeTruthy();
  });

  it("keeps partial records visible without treating missing values as zeros", async () => {
    const partialAggregate = aggregateWithoutRecords();
    partialAggregate.weeks[7] = aggregate.weeks[7];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(partialAggregate)),
    );

    renderTrends();

    expect(
      await screen.findByRole("heading", { name: "完成 2/4（50%）" }),
    ).toBeTruthy();
    expect(screen.queryByText("还没有可回顾的趋势")).toBeNull();
    expect(
      screen.getByRole("listitem", {
        name: /6月1日当周：没有安排任务；无身体反馈（0\/7 天）；训练 没有可用训练记录；没有恢复参考记录。/,
      }),
    ).toBeTruthy();
  });

  it("uses one actionable empty state instead of an eight-week wall", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(aggregateWithoutRecords())),
    );

    renderTrends();

    expect(
      await screen.findByRole("heading", { name: "还没有可回顾的趋势" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "回到今天" }).getAttribute("href"),
    ).toBe("/");
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(screen.queryByText("查看调整建议")).toBeNull();
    expect(screen.queryByText("查看阶段评估")).toBeNull();
  });

  it("keeps the last successful content visible during a failed background refresh", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        call += 1;
        return call === 1
          ? Promise.resolve(jsonResponse(aggregate))
          : Promise.resolve(new Response(null, { status: 503 }));
      }),
    );

    renderTrends();
    expect(
      await screen.findByRole("heading", { name: "完成 2/4（50%）" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "刷新趋势" }));

    expect(
      screen.getByRole("heading", { name: "完成 2/4（50%）" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText("暂时无法更新，继续显示上次内容。")).toBeTruthy(),
    );
    expect(screen.queryByText("趋势暂时无法加载")).toBeNull();
  });

  it("renders a warm cached response immediately without a page-level loading state", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["trends", "knee-rehab"], aggregate);
    vi.stubGlobal("fetch", vi.fn());

    renderTrends(queryClient);

    expect(
      screen.getByRole("heading", { name: "完成 2/4（50%）" }),
    ).toBeTruthy();
    expect(screen.queryByText("正在整理最近记录…")).toBeNull();
  });
});
