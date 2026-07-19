// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { trackerQueryKeys } from "@/client/query-keys";
import { TodayClient } from "@/components/today-client";
import type { TodayAggregate } from "@/domain/api-contracts";

vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("@/domain/planning-time", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/domain/planning-time")>();
  return {
    ...original,
    localDateInTimeZone: () => "2026-07-19",
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function aggregate(
  status: "planned" | "completed" | "skipped",
  feedbackCount: number,
): TodayAggregate {
  return {
    tracker: {
      key: "knee-rehab",
      name: "Anonymous Tracker",
      startedOn: "2026-07-01",
      planningTimeZone: "Asia/Shanghai",
    },
    targetDate: "2026-07-19",
    plan: {
      id: "019c0000-0000-7000-8000-000000000001",
      version: 1,
      effectiveFrom: "2026-07-01",
    },
    day: {
      state: "ready",
      trackerName: "Anonymous Tracker",
      startDate: "2026-07-01",
      planVersion: 1,
      tasks: [
        {
          id: "019c0000-0000-7000-8000-000000000002",
          title: "Anonymous task",
          category: "general",
          prescription: {
            exercises: [{ name: "Anonymous movement", dose: "2 × 8" }],
          },
          status,
          actual: null,
          subjectiveNote: null,
        },
      ],
      feedbackCount,
      feedbacks: [],
      externalTrainingRecords: [],
    },
    safetyPolicy: {
      schemaVersion: "1.0.0",
      policyId: "019c0000-0000-7000-8000-000000000003",
      trackerKey: "knee-rehab",
      version: 1,
      effectiveFrom: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
      createdBy: "import",
      rules: [
        {
          id: "anonymous-warning",
          outcome: "yellow",
          match: "all",
          conditions: [{ operator: "number_gte", field: "score", value: 999 }],
        },
      ],
      hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    execution: {
      context: null,
      day: null,
      alternatives: [],
      safety: { blocked: false, reason: null },
    },
  };
}

describe("today background refresh", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("describes online capability without claiming that data is synced", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(aggregate("planned", 0))),
    );

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <TodayClient />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("当前在线")).toBeTruthy();
    expect(screen.getByText("网络可用")).toBeTruthy();
    expect(screen.queryByText("已同步到云端")).toBeNull();
    expect(screen.queryByText(/全部已同步|待同步 0/)).toBeNull();
  });

  it("shows an explicit offline state", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(aggregate("planned", 0))),
    );

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <TodayClient />
      </QueryClientProvider>,
    );

    expect((await screen.findAllByText("当前离线")).length).toBeGreaterThan(0);
    expect(screen.queryByText("已同步到云端")).toBeNull();
  });

  it("keeps a failed save message with its task while the network is available", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "PATCH"
          ? jsonResponse({}, 500)
          : jsonResponse(aggregate("planned", 0)),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <TodayClient />
      </QueryClientProvider>,
    );

    const task = await screen.findByRole("article", { name: "Anonymous task" });
    fireEvent.click(
      within(task).getByRole("checkbox", { name: "Anonymous task" }),
    );

    expect(
      await within(task).findByText("保存失败，请检查网络后重试"),
    ).toBeTruthy();
    expect(screen.getByText("当前在线")).toBeTruthy();
    expect(screen.queryByText("已同步到云端")).toBeNull();
  });

  it("preserves a task draft after server data refreshes", async () => {
    const refreshed = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(aggregate("planned", 0)))
      .mockImplementationOnce(() => refreshed.promise);
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <TodayClient />
      </QueryClientProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "展开 Anonymous task" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "没有同步记录？手工记录" }),
    );
    const taskDraft = screen.getByLabelText("实际训练与主观感受");
    fireEvent.change(taskDraft, { target: { value: "未提交任务草稿" } });
    const queryKey = trackerQueryKeys.today("knee-rehab", "2026-07-19");
    const initialUpdatedAt = queryClient.getQueryState(queryKey)?.dataUpdatedAt;

    await new Promise((resolve) => setTimeout(resolve, 5));

    const refetch = queryClient.refetchQueries({
      queryKey,
    });
    await act(async () => {
      refreshed.resolve(jsonResponse(aggregate("completed", 1)));
      await refetch;
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryState(queryKey)?.dataUpdatedAt).toBeGreaterThan(
      initialUpdatedAt ?? 0,
    );
    expect(await screen.findByText("已完成")).toBeTruthy();

    expect(
      (screen.getByLabelText("实际训练与主观感受") as HTMLTextAreaElement)
        .value,
    ).toBe("未提交任务草稿");
    const feedbackLink = screen.getByRole("link", { name: "再次反馈" });
    expect(feedbackLink.getAttribute("href")).toBe("/feedback");
  });

  it("preserves a task draft when an execution-context command refreshes today", async () => {
    const data = aggregate("planned", 0);
    data.execution = {
      context: {
        id: "019c0000-0000-7000-8000-000000000020",
        kind: "travel",
        startDate: "2026-07-19",
        endDate: "2026-07-24",
        status: "active",
      },
      day: null,
      alternatives: [],
      safety: { blocked: false, reason: null },
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") {
          return jsonResponse({
            commandId: JSON.parse(String(init.body)).commandId,
            replayed: false,
            day: {
              localDate: "2026-07-19",
              conditions: {
                availableMinutes: 20,
                venue: "room",
                equipment: [],
                healthStatus: "normal",
              },
              selection: null,
              safetyDisposition: "normal",
            },
          });
        }
        if (String(input).includes("/today")) return jsonResponse(data);
        return jsonResponse({}, 404);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TodayClient />
      </QueryClientProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "展开 Anonymous task" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "没有同步记录？手工记录" }),
    );
    fireEvent.change(screen.getByLabelText("实际训练与主观感受"), {
      target: { value: "Draft survives context refresh" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存今天的执行方式" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT"),
      ).toHaveLength(1),
    );
    expect(
      (screen.getByLabelText("实际训练与主观感受") as HTMLTextAreaElement)
        .value,
    ).toBe("Draft survives context refresh");
  });

  it.each([
    ["travel", "active", "出差维持模式"],
    ["equipment_limited", "active", "器械受限模式"],
    ["travel", "upcoming", "正常模式 · 已安排出差"],
  ] as const)(
    "shows the %s %s execution mode honestly",
    async (kind, status, expectedMode) => {
      const data = aggregate("planned", 0);
      data.execution = {
        context: {
          id: "019c0000-0000-7000-8000-000000000030",
          kind,
          startDate: status === "active" ? "2026-07-19" : "2026-07-20",
          endDate: "2026-07-24",
          status,
        },
        day: null,
        alternatives: [],
        safety: { blocked: false, reason: null },
      };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(data)));

      render(
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <TodayClient />
        </QueryClientProvider>,
      );

      expect(await screen.findByText(expectedMode)).toBeTruthy();
      if (status === "active") {
        expect(screen.queryByText("正常模式")).toBeNull();
      }
    },
  );

  it("keeps the today hierarchy stable and separates task expansion from completion", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") return jsonResponse({});
        return jsonResponse(aggregate("planned", 0));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <TodayClient />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("今天还剩 1 项")).toBeTruthy();
    expect(screen.getByText("Anonymous movement · 2 × 8")).toBeTruthy();
    expect(screen.getByText("待完成")).toBeTruthy();

    const plan = screen.getByRole("region", { name: "今日计划" });
    const feedback = screen.getByRole("region", { name: "身体反馈" });
    const pending = screen.getByRole("region", { name: "待处理来源" });
    expect(
      plan.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      feedback.compareDocumentPosition(pending) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const checkbox = screen.getByRole("checkbox", {
      name: "Anonymous task",
    }) as HTMLInputElement;
    fireEvent.click(
      screen.getByRole("button", { name: "展开 Anonymous task" }),
    );

    expect(checkbox.checked).toBe(false);
    expect(screen.getByText("计划处方")).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"),
    ).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: "收起 Anonymous task" }),
    );
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"),
      ).toBe(true),
    );
    expect(screen.queryByText("计划处方")).toBeNull();
  });

  it("renders completed and skipped tasks as distinct visual states", async () => {
    const data = aggregate("completed", 1);
    data.day.tasks.push({
      ...data.day.tasks[0]!,
      id: "019c0000-0000-7000-8000-000000000004",
      title: "Anonymous skipped task",
      status: "skipped",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(data)));

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <TodayClient />
      </QueryClientProvider>,
    );

    const completed = await screen.findByRole("article", {
      name: "Anonymous task",
    });
    const skipped = screen.getByRole("article", {
      name: "Anonymous skipped task",
    });
    expect(completed.getAttribute("data-status")).toBe("completed");
    expect(within(completed).getByText("已完成")).toBeTruthy();
    expect(skipped.getAttribute("data-status")).toBe("skipped");
    expect(within(skipped).getByText("已跳过")).toBeTruthy();
  });

  it("renders a useful no-task state instead of an empty task list", async () => {
    const data = aggregate("planned", 0);
    data.day.tasks = [];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(data)));

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <TodayClient />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("今天没有安排训练")).toBeTruthy();
    expect(screen.getByText(/如果有突发反应/)).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it.each([
    ["green", "绿灯", false],
    ["yellow", "黄灯", true],
    ["red", "红灯", true],
  ] as const)(
    "renders the %s safety state at the correct interruption level",
    async (safetyLevel, label, interrupted) => {
      const data = aggregate("planned", 1);
      data.day.feedbacks = [
        {
          id: "019c0000-0000-7000-8000-000000000006",
          occurredAt: "2026-07-19T02:00:00.000Z",
          timing: "morning",
          leftPain: 0,
          rightPain: 0,
          swelling: "none",
          safetyLevel,
          note: "Anonymous feedback",
        },
      ];
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(data)));

      render(
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false } },
            })
          }
        >
          <TodayClient />
        </QueryClientProvider>,
      );

      expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
      expect(
        screen.queryByRole("alert", { name: `${label}安全提示` }) !== null,
      ).toBe(interrupted);
    },
  );

  it("keeps a local page frame while loading and offers a local retry on error", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn().mockImplementationOnce(() => pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <TodayClient />
      </QueryClientProvider>,
    );

    expect(screen.getByText("正在加载今日计划…")).toBeTruthy();
    await act(async () => {
      pending.resolve(new Response(null, { status: 503 }));
    });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });
});
