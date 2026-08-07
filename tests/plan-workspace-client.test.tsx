// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlanWorkspaceClient } from "@/components/plan-workspace-client";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const workspace = {
  schemaVersion: "1.0.0",
  trackerKey: "knee-rehab",
  localDate: "2026-08-04",
  calendarWeek: 3,
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
  if (!globalThis.localStorage) {
    const localValues = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => localValues.get(key) ?? null,
      setItem: (key: string, value: string) => localValues.set(key, value),
      removeItem: (key: string) => localValues.delete(key),
    });
  }
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

  it("answers the current goal, next training and pending action from one read-only aggregate", async () => {
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
    expect(await within(page).findByText("下一次训练")).toBeTruthy();
    expect(within(page).queryByText("起算后第 3 个日历周")).toBeNull();
    expect(within(page).queryByText("日历周不等于有效训练阶段。")).toBeNull();
    expect(within(page).getByText("逐步恢复稳定训练")).toBeTruthy();
    expect(within(page).getByText("8月5日 · 2 项训练")).toBeTruthy();
    expect(within(page).getByText("匿名力量训练、匿名步行训练")).toBeTruthy();
    expect(within(page).getByText("1 条待确认建议")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/trackers/knee-rehab/plan-workspace",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("hides the goal block when no structured user goal exists", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ...workspace, goals: [], nextTraining: null }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderWorkspace();

    const page = screen.getByRole("main", { name: "计划页面" });
    await within(page).findByText("说说最近的训练和身体感受");
    expect(within(page).queryByText("当前目标")).toBeNull();
    expect(within(page).queryByText("按当前安排继续")).toBeNull();
  });

  it("exposes the assistant, review, version, evaluation, profile and memory entry points", async () => {
    const localValues = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => localValues.get(key) ?? null,
      setItem: (key: string, value: string) => localValues.set(key, value),
      removeItem: (key: string) => localValues.delete(key),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = url.endsWith("/assistant")
          ? {
              schemaVersion: "1.0.0",
              conversationId: "019c0000-0000-7000-8000-000000000011",
              turns: [
                {
                  id: "019c0000-0000-7000-8000-000000000012",
                  commandId: "019c0000-0000-7000-8000-000000000013",
                  message: "最近训练怎么样？",
                  association: { kind: "auto" },
                  status: "succeeded",
                  response: {
                    reply: "最近一次回复。",
                    followUpQuestions: [],
                    feedbackDraft: null,
                    planReview: "not_needed",
                    memoryActions: [],
                    evidenceReferences: [],
                  },
                  errorCode: null,
                  model: "deepseek-v4-flash",
                  contextHash: "a".repeat(64),
                  confirmedFeedbackId: null,
                  createdAt: "2026-08-04T00:00:00.000Z",
                  completedAt: "2026-08-04T00:00:01.000Z",
                },
              ],
              memories: [],
              profile: null,
              nextCursor: null,
            }
          : workspace;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    renderWorkspace();
    await screen.findByText("下一次训练");

    expect(await screen.findByText("最近一次回复。")).toBeTruthy();
    expect(screen.getByLabelText("训练、身体感受或计划问题")).toBeTruthy();
    expect(screen.queryByText("版本 2")).toBeNull();

    fireEvent.click(screen.getByText("更多计划信息"));
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
