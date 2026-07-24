// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TrendsClient } from "@/components/trends-client";

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

  it("renders accessible completion and symptom summaries without relying on color", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(aggregate)),
    );

    renderTrends();

    expect(screen.getByRole("main", { name: "趋势页面" })).toBeTruthy();
    expect(screen.getByText("正在整理最近记录…")).toBeTruthy();
    expect(
      await screen.findByRole("heading", { name: "本周完成" }),
    ).toBeTruthy();
    expect(screen.getByText("2 / 4")).toBeTruthy();
    expect(screen.getByText("反馈 2 / 3 天")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /本周任务完成率 50%/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /本周最高疼痛 6 分，反馈 2 天/ }),
    ).toBeTruthy();
    expect(screen.getByText("未反馈的日期不会按 0 分计算。")).toBeTruthy();
  });

  it("explains empty and partial records without treating missing feedback as improvement", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
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
          })),
        }),
      ),
    );

    renderTrends();

    expect(await screen.findByText("记录还不够")).toBeTruthy();
    expect(screen.getByText(/继续记录任务和身体反馈/)).toBeTruthy();
    expect(screen.queryByText(/疼痛改善/)).toBeNull();
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
    expect(await screen.findByText("2 / 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "刷新趋势" }));

    expect(screen.getByText("2 / 4")).toBeTruthy();
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

    expect(screen.getByText("2 / 4")).toBeTruthy();
    expect(screen.queryByText("正在整理最近记录…")).toBeNull();
  });
});
