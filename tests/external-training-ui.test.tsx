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

const taskId = "019c0000-0000-7000-8000-000000000102";
const recordId = "019c0000-0000-7000-8000-000000000103";

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
  };
}

describe("external training association UI", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
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

    fireEvent.click(
      await screen.findByRole("button", {
        name: "展开 Anonymous strength task",
      }),
    );
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
      await screen.findByText("关联已保存；任务完成状态没有改变"),
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
    await waitFor(() => expect(screen.getByText(/已关联/)).toBeTruthy());
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

    fireEvent.click(
      await screen.findByRole("button", {
        name: "展开 Anonymous strength task",
      }),
    );

    expect(screen.getByText(/已关联/)).toBeTruthy();
    expect(screen.getByText("训记内容已更新，请重新确认关联。")).toBeTruthy();
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Anonymous strength task",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
  });
});
