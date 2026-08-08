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

import { TodayClient } from "@/components/today-client";
import { CalendarClient } from "@/components/calendar-client";
import { trackerQueryKeys } from "@/client/query-keys";
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

const taskId = "019c0000-0000-7000-8000-000000000102";
const recordId = "019c0000-0000-7000-8000-000000000103";

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

function todayAggregate(): TodayAggregate {
  return {
    tracker: {
      key: "knee-rehab",
      name: "Anonymous Tracker",
      startedOn: "2026-07-01",
      planningTimeZone: "Asia/Shanghai",
    },
    targetDate: "2026-07-19",
    plan: {
      id: "019c0000-0000-7000-8000-000000000101",
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
          id: taskId,
          title: "Anonymous strength task",
          category: "strength",
          prescription: {
            exercises: [{ name: "Anonymous movement", dose: "2 × 8" }],
          },
          status: "planned",
          actual: null,
          subjectiveNote: null,
        },
      ],
      feedbackCount: 0,
      feedbacks: [],
      externalTrainingRecords: [
        {
          id: recordId,
          provider: "xunji",
          localDate: "2026-07-19",
          occurredAt: "2026-07-19T02:00:00.000Z",
          sourceVersion: 2,
          details: {
            kind: "strength_training",
            title: "Anonymous session",
            startedAt: "2026-07-19T02:00:00.000Z",
            endedAt: "2026-07-19T03:00:00.000Z",
            durationSeconds: 3600,
            movements: [
              {
                name: "Anonymous movement",
                sets: [
                  {
                    index: 1,
                    completed: false,
                    weight: 10,
                    unit: "lb",
                    reps: 8,
                    duration: null,
                    durationUnit: null,
                    selfWeight: false,
                    rpe: 6,
                    restSeconds: 60,
                    note: null,
                    items: [],
                  },
                  {
                    index: 2,
                    completed: true,
                    weight: null,
                    unit: null,
                    reps: null,
                    duration: 45,
                    durationUnit: "s",
                    selfWeight: true,
                    rpe: null,
                    restSeconds: null,
                    note: null,
                    items: [
                      {
                        name: "Anonymous nested set",
                        completed: true,
                        weight: 5,
                        unit: "kg",
                        reps: 10,
                        duration: null,
                        durationUnit: null,
                        selfWeight: null,
                        rpe: null,
                        restSeconds: null,
                        note: null,
                      },
                    ],
                  },
                ],
                difficulty: "hard",
                rpe: null,
                restSeconds: null,
                note: null,
              },
            ],
            rpe: 6,
            restSeconds: null,
            note: "Anonymous note",
          },
          association: null,
          suggestion: {
            taskId,
            reason: "匿名动作与计划动作一致",
          },
        },
      ],
    },
    safetyPolicy: {
      schemaVersion: "1.0.0",
      policyId: "019c0000-0000-7000-8000-000000000104",
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

describe("external training association UI", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps resolved records compact while listing them in the Today records section", async () => {
    const data = todayAggregate();
    data.day.externalTrainingRecords[0]!.association = {
      status: "confirmed",
      taskId,
      sourceVersion: 2,
      needsReview: false,
    };
    data.day.externalTrainingRecords[0]!.suggestion = null;
    data.day.externalTrainingRecords.push({
      id: "019c0000-0000-7000-8000-000000000107",
      provider: "garmin",
      localDate: "2026-07-19",
      occurredAt: "2026-07-19T05:00:00.000Z",
      sourceVersion: 1,
      details: {
        kind: "activity",
        activityType: "walking",
        startedAt: "2026-07-19T05:00:00.000Z",
        durationSeconds: 1_200,
        distanceMeters: 1_500,
        averagePaceSecondsPerKilometer: 800,
        averageHeartRateBpm: 92,
      },
      association: {
        status: "unrelated",
        taskId: null,
        sourceVersion: 1,
        needsReview: false,
      },
      suggestion: null,
    });
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

    expect(
      await screen.findByRole("heading", { name: "Anonymous session" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "步行" })).toBeTruthy();
    expect(screen.getByText("已标记为与计划无关")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "与计划无关" })).toBeNull();
    expect(screen.queryByLabelText("待处理来源")).toBeNull();
  });

  it("projects the PUT canonical association into Today and Calendar persistent-tab caches", async () => {
    const today = todayAggregate();
    const day = {
      trackerKey: today.tracker.key,
      targetDate: today.targetDate,
      plan: today.plan,
      day: structuredClone(today.day),
    };
    const canonical = {
      status: "confirmed" as const,
      taskId,
      sourceVersion: 2,
      needsReview: false,
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "PUT") {
          const decision = JSON.parse(String(init.body)).decision as
            "link" | "unrelated";
          return jsonResponse({
            commandId: "019c0000-0000-7000-8000-000000000108",
            replayed: false,
            recordId,
            association:
              decision === "link"
                ? canonical
                : {
                    status: "unrelated",
                    taskId: null,
                    sourceVersion: 2,
                    needsReview: false,
                  },
          });
        }
        if (url.includes("/calendar?month=")) {
          return jsonResponse({
            trackerKey: "knee-rehab",
            month: "2026-07",
            days: [],
          });
        }
        if (url.includes("/days/")) return jsonResponse(day);
        return jsonResponse(today);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", {
      randomUUID: () => "019c0000-0000-7000-8000-000000000108",
    });
    window.history.replaceState(null, "", "/calendar?date=2026-07-19");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <TodayClient />
        <CalendarClient initialDate="2026-07-19" />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(
        view.container.querySelector(".today-page .today-records-section"),
      ).toBeTruthy(),
    );
    const todayPage = view.container.querySelector<HTMLElement>(".today-page");
    expect(todayPage).toBeTruthy();
    fireEvent.click(
      await within(todayPage!).findByRole("button", {
        name: "关联到此任务",
      }),
    );

    expect(
      await within(todayPage!).findByText("已关联：Anonymous strength task"),
    ).toBeTruthy();
    const calendarPage =
      view.container.querySelector<HTMLElement>(".calendar-shell");
    expect(calendarPage).toBeTruthy();
    expect(
      await within(calendarPage!).findByRole("button", { name: "修改关联" }),
    ).toBeTruthy();
    expect(
      queryClient.getQueryData<{
        day: TodayAggregate["day"];
      }>(trackerQueryKeys.day("knee-rehab", "2026-07-19"))?.day
        .externalTrainingRecords[0]?.association,
    ).toEqual(canonical);

    fireEvent.click(
      within(calendarPage!).getByRole("button", { name: "修改关联" }),
    );
    fireEvent.click(
      within(calendarPage!).getByRole("button", { name: "与计划无关" }),
    );

    expect(
      await within(calendarPage!).findByText("已标记为与计划无关"),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        within(todayPage!).queryByText("已关联：Anonymous strength task"),
      ).toBeNull(),
    );
    expect(
      queryClient.getQueryData<{
        day: TodayAggregate["day"];
      }>(trackerQueryKeys.today("knee-rehab", "2026-07-19"))?.day
        .externalTrainingRecords[0]?.association,
    ).toEqual({
      status: "unrelated",
      taskId: null,
      sourceVersion: 2,
      needsReview: false,
    });
  });

  it("sends one stable command while a slow association PUT is pending", async () => {
    const pendingPut = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT"
        ? pendingPut.promise
        : Promise.resolve(jsonResponse(todayAggregate())),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", {
      randomUUID: () => "019c0000-0000-7000-8000-000000000109",
    });
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TodayClient />
      </QueryClientProvider>,
    );

    const button = await screen.findByRole("button", {
      name: "关联到此任务",
    });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(
      (screen.getByRole("button", { name: "保存中…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT"),
    ).toHaveLength(1);

    pendingPut.resolve(
      jsonResponse({
        commandId: "019c0000-0000-7000-8000-000000000109",
        replayed: false,
        recordId,
        association: {
          status: "confirmed",
          taskId,
          sourceVersion: 2,
          needsReview: false,
        },
      }),
    );
    expect(
      await screen.findByText("已关联：Anonymous strength task"),
    ).toBeTruthy();
  });

  it("refreshes canonical source state after PUT 409 and re-emphasizes needsReview", async () => {
    const initial = todayAggregate();
    const refreshed = structuredClone(initial);
    refreshed.day.externalTrainingRecords[0]!.sourceVersion = 3;
    refreshed.day.externalTrainingRecords[0]!.association = {
      status: "confirmed",
      taskId,
      sourceVersion: 2,
      needsReview: true,
    };
    refreshed.day.externalTrainingRecords[0]!.suggestion = null;
    let todayReads = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "PUT") return jsonResponse({}, 409);
        if (url.includes("/calendar?month=")) {
          return jsonResponse({
            trackerKey: "knee-rehab",
            month: "2026-07",
            days: [],
          });
        }
        if (url.includes("/days/")) {
          return jsonResponse({
            trackerKey: "knee-rehab",
            targetDate: refreshed.targetDate,
            plan: refreshed.plan,
            day: refreshed.day,
          });
        }
        todayReads += 1;
        return jsonResponse(todayReads === 1 ? initial : refreshed);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", {
      randomUUID: () => "019c0000-0000-7000-8000-000000000110",
    });
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
      await screen.findByRole("button", { name: "关联到此任务" }),
    );

    expect(
      await screen.findByText("来源记录已更新，已载入最新状态，请重新确认"),
    ).toBeTruthy();
    expect(
      await screen.findByText("训练内容已更新，请重新确认关联。"),
    ).toBeTruthy();
    expect(screen.getByLabelText("训练记录")).toBeTruthy();
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Anonymous strength task",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
  });

  it("keeps task status and unsaved drafts while confirming a Xunji link", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method || init.method === "GET") {
          return jsonResponse(todayAggregate());
        }
        if (init.method === "PUT") {
          return jsonResponse({
            commandId: "019c0000-0000-7000-8000-000000000105",
            replayed: false,
            recordId,
            association: {
              status: "confirmed",
              taskId,
              sourceVersion: 2,
              needsReview: false,
            },
          });
        }
        return jsonResponse({}, 500);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", {
      randomUUID: () => "019c0000-0000-7000-8000-000000000105",
    });

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

    await screen.findByRole("button", {
      name: "收起 Anonymous strength task",
    });
    expect(
      screen.getByRole("heading", { name: "Anonymous session" }),
    ).toBeTruthy();
    expect(screen.getByText(/未完成 · 10 lb · 8 次 · 6 RPE/)).toBeTruthy();
    expect(screen.queryByText(/10 kg/)).toBeNull();
    expect(screen.getByText(/已完成 · 自重 · 45 秒/)).toBeTruthy();
    expect(
      screen.getByText(/Anonymous nested set：已完成 · 5 kg · 10 次/),
    ).toBeTruthy();
    expect(screen.getByText("难度：困难")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "没有同步记录？手工记录" }),
    );
    fireEvent.change(screen.getByLabelText("实际训练与主观感受"), {
      target: { value: "未提交任务草稿" },
    });
    const taskCheckbox = screen.getByRole("checkbox", {
      name: "Anonymous strength task",
    }) as HTMLInputElement;
    expect(taskCheckbox.checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "关联到此任务" }));

    expect(
      await screen.findByText(
        "训记训练已关联到“Anonymous strength task”；任务完成状态未改变，可在日历当天修改。",
      ),
    ).toBeTruthy();
    expect(taskCheckbox.checked).toBe(false);
    expect(
      (screen.getByLabelText("实际训练与主观感受") as HTMLTextAreaElement)
        .value,
    ).toBe("未提交任务草稿");
    const putCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PUT",
    );
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String(putCall?.[1]?.body));
    expect(body).toMatchObject({
      externalRecordId: recordId,
      sourceVersion: 2,
      decision: "link",
      taskId,
      commandId: "019c0000-0000-7000-8000-000000000105",
    });
    expect(JSON.stringify(body)).not.toContain("Anonymous note");
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"),
    ).toBe(false);
    await waitFor(() =>
      expect(screen.getByText("已关联：Anonymous strength task")).toBeTruthy(),
    );
  });

  it("shows a reviewed link as needing confirmation without completing the task", async () => {
    const data = todayAggregate();
    const record = data.day.externalTrainingRecords[0]!;
    record.association = {
      status: "confirmed",
      taskId,
      sourceVersion: 1,
      needsReview: true,
    };
    record.suggestion = null;
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

    await screen.findByRole("button", {
      name: "收起 Anonymous strength task",
    });

    expect(screen.getByText(/已关联/)).toBeTruthy();
    expect(screen.getByText("训练内容已更新，请重新确认关联。")).toBeTruthy();
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Anonymous strength task",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
  });

  it("renders Xunji and Garmin together and keeps Garmin association independent from task status", async () => {
    const data = todayAggregate();
    const garminRecordId = "019c0000-0000-7000-8000-000000000106";
    data.day.externalTrainingRecords.push({
      id: garminRecordId,
      provider: "garmin",
      localDate: "2026-07-19",
      occurredAt: "2026-07-19T04:00:00.000Z",
      sourceVersion: 1,
      details: {
        kind: "activity",
        activityType: "running",
        startedAt: "2026-07-19T04:00:00.000Z",
        durationSeconds: 1_500,
        distanceMeters: 2_500,
        averagePaceSecondsPerKilometer: 360,
        averageHeartRateBpm: 118,
      },
      association: null,
      suggestion: {
        taskId,
        reason: "Garmin 活动类型与计划任务一致",
      },
    });
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method || init.method === "GET") return jsonResponse(data);
        if (init.method === "PUT") {
          return jsonResponse({
            commandId: "019c0000-0000-7000-8000-000000000105",
            replayed: false,
            recordId: garminRecordId,
            association: {
              status: "confirmed",
              taskId,
              sourceVersion: 1,
              needsReview: false,
            },
          });
        }
        return jsonResponse({}, 500);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("crypto", {
      randomUUID: () => "019c0000-0000-7000-8000-000000000105",
    });

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TodayClient />
      </QueryClientProvider>,
    );

    await screen.findByRole("button", {
      name: "收起 Anonymous strength task",
    });
    expect(screen.getAllByText("Anonymous session").length).toBeGreaterThan(0);
    const heading = screen.getAllByRole("heading", { name: "跑步" })[0]!;
    const card = heading.closest("article");
    expect(card).toBeTruthy();
    expect(within(card!).getByText("Garmin")).toBeTruthy();
    expect(within(card!).getByText(/2.50 km/)).toBeTruthy();
    expect(within(card!).getByText(/6'00"\/km/)).toBeTruthy();
    expect(within(card!).getByText(/平均心率 118/)).toBeTruthy();

    const checkbox = screen.getByRole("checkbox", {
      name: "Anonymous strength task",
    }) as HTMLInputElement;
    fireEvent.click(
      within(card!).getByRole("button", { name: "关联到此任务" }),
    );
    await within(card!).findByText("已关联到任务");
    expect(checkbox.checked).toBe(false);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(
      "anonymous-provider-record",
    );
  });
});
