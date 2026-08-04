// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlanWorkspaceClient } from "@/components/plan-workspace-client";

const workspace = {
  schemaVersion: "1.0.0",
  trackerKey: "knee-rehab",
  localDate: "2026-08-04",
  currentWeek: 3,
  plan: {
    id: "019c0000-0000-7000-8000-000000000001",
    version: 2,
    effectiveFrom: "2026-07-21",
  },
  goals: ["逐步恢复稳定训练"],
  nextTraining: {
    localDate: "2026-08-05",
    taskCount: 2,
    titles: ["匿名力量训练", "匿名步行训练"],
  },
  pendingAdviceCount: 1,
  profileVersion: 4,
  activeMemoryCount: 3,
};

function renderWorkspace() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlanWorkspaceClient />
    </QueryClientProvider>,
  );
}

describe("plan workspace", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("answers the current week, goal, next training and pending action from one read-only aggregate", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(workspace), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWorkspace();

    const page = screen.getByRole("main", { name: "计划页面" });
    expect(within(page).getByText("正在整理计划…")).toBeTruthy();
    expect(await within(page).findByText("第 3 周")).toBeTruthy();
    expect(within(page).getByText("逐步恢复稳定训练")).toBeTruthy();
    expect(within(page).getByText("8月5日 · 2 项训练")).toBeTruthy();
    expect(within(page).getByText("匿名力量训练、匿名步行训练")).toBeTruthy();
    expect(within(page).getByText("1 条待确认建议")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/trackers/knee-rehab/plan-workspace",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("exposes the assistant, review, version, evaluation, profile and memory entry points", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(workspace), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    renderWorkspace();
    await screen.findByText("第 3 周");

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      expect.arrayContaining([
        "/plan/conversation",
        "/plan/review",
        "/plan/advice",
        "/plan/evaluation",
        "/plan/versions",
        "/plan/profile",
        "/plan/memories",
      ]),
    );
  });
});
