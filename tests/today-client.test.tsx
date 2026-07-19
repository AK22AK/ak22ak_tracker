// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { trackerQueryKeys } from "@/client/query-keys";
import { TodayClient } from "@/components/today-client";

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

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function aggregate(status: "planned" | "completed", feedbackCount: number) {
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
          prescription: {},
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
  };
}

describe("today background refresh", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("preserves task and feedback drafts after server data refreshes", async () => {
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

    const taskDraft = await screen.findByLabelText("实际训练与主观感受");
    fireEvent.change(taskDraft, { target: { value: "未提交任务草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "添加反馈" }));
    const feedbackDraft = screen.getByLabelText("主观感受");
    fireEvent.change(feedbackDraft, { target: { value: "未提交反馈草稿" } });

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
    expect(
      (screen.getByLabelText("主观感受") as HTMLTextAreaElement).value,
    ).toBe("未提交反馈草稿");
    expect(screen.getByRole("button", { name: "提交反馈" })).toBeTruthy();
  });
});
