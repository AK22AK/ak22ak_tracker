// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExecutionContextCard } from "@/components/execution-context-card";
import type { ExecutionContextToday } from "@/domain/execution-context";

const contextId = "019c0000-0000-7000-8000-000000000001";
const optionId = "019c0000-0000-7000-8000-000000000002";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function activeExecution(
  overrides: Partial<ExecutionContextToday> = {},
): ExecutionContextToday {
  return {
    context: {
      id: contextId,
      kind: "travel",
      startDate: "2026-07-19",
      endDate: "2026-07-24",
      status: "active",
    },
    day: null,
    alternatives: [
      {
        id: optionId,
        optionKey: "anonymous-option",
        version: 1,
        kind: "alternative",
        title: "Anonymous private option",
        summary: "Anonymous summary",
        estimatedMinutes: { min: 15, max: 25 },
        steps: ["Anonymous step one", "Anonymous step two"],
      },
    ],
    safety: { blocked: false, reason: null },
    ...overrides,
  };
}

describe("execution context card", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates a dated travel context without changing the base plan", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        commandId: "019c0000-0000-7000-8000-000000000010",
        replayed: false,
        context: {
          id: contextId,
          kind: "travel",
          startDate: "2026-07-20",
          endDate: "2026-07-24",
          status: "upcoming",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn().mockResolvedValue(undefined);

    render(
      <ExecutionContextCard
        trackerKey="anonymous-tracker"
        localDate="2026-07-19"
        planVersion={3}
        execution={{
          context: null,
          day: null,
          alternatives: [],
          safety: { blocked: false, reason: null },
        }}
        onChanged={onChanged}
      />,
    );

    expect(screen.getByText("正常计划")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "安排出差或受限模式" }));
    fireEvent.change(screen.getByLabelText("开始日期"), {
      target: { value: "2026-07-20" },
    });
    fireEvent.change(screen.getByLabelText("结束日期"), {
      target: { value: "2026-07-24" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存执行上下文" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/execution-contexts");
    expect(String(url)).not.toContain("plan");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      kind: "travel",
      startDate: "2026-07-20",
      endDate: "2026-07-24",
    });
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("shows the base plan beside the active context and saves a private option without completing a task", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        commandId: "019c0000-0000-7000-8000-000000000011",
        replayed: false,
        day: {
          localDate: "2026-07-19",
          conditions: {
            availableMinutes: 20,
            venue: "room",
            equipment: ["chair"],
            healthStatus: "normal",
          },
          selection: { optionId, optionVersion: 1 },
          safetyDisposition: "normal",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ExecutionContextCard
        trackerKey="anonymous-tracker"
        localDate="2026-07-19"
        planVersion={3}
        execution={activeExecution()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText("基础计划 v3 保持不变")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("可用时间（分钟）"), {
      target: { value: "20" },
    });
    fireEvent.change(screen.getByLabelText("场地条件"), {
      target: { value: "room" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "稳定椅子" }));
    fireEvent.click(
      screen.getByRole("radio", { name: /Anonymous private option/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存今天的执行方式" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(`/days/2026-07-19`);
    expect(String(url)).not.toContain("/tasks/");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      conditions: {
        availableMinutes: 20,
        venue: "room",
        equipment: ["chair"],
      },
      selection: { optionId, optionVersion: 1 },
    });
  });

  it("routes red, illness and acute states to stop and reassess instead of alternatives", () => {
    render(
      <ExecutionContextCard
        trackerKey="anonymous-tracker"
        localDate="2026-07-19"
        planVersion={3}
        execution={activeExecution({
          alternatives: [],
          safety: { blocked: true, reason: "red_feedback" },
        })}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("停止并重新评估");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByText("Anonymous private option")).toBeNull();
  });

  it("keeps the full draft and command id when saving fails and is retried", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ error: "temporary_failure" }, 503))
      .mockResolvedValueOnce(
        response({
          commandId: "019c0000-0000-7000-8000-000000000012",
          replayed: false,
          day: {
            localDate: "2026-07-19",
            conditions: {
              availableMinutes: 12,
              venue: "room",
              equipment: ["chair"],
              healthStatus: "normal",
              note: "Anonymous draft",
            },
            selection: null,
            safetyDisposition: "normal",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ExecutionContextCard
        trackerKey="anonymous-tracker"
        localDate="2026-07-19"
        planVersion={3}
        execution={activeExecution()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByLabelText("可用时间（分钟）"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("当天条件补充"), {
      target: { value: "Anonymous draft" },
    });
    const save = screen.getByRole("button", { name: "保存今天的执行方式" });
    fireEvent.click(save);

    expect(await screen.findByText("尚未保存，请重试")).toBeTruthy();
    expect(
      (screen.getByLabelText("当天条件补充") as HTMLTextAreaElement).value,
    ).toBe("Anonymous draft");
    fireEvent.click(save);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const first = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const second = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(second.commandId).toBe(first.commandId);
    expect(second.conditions.note).toBe("Anonymous draft");
  });

  it("keeps a draft for the same logical day but resets it for a new context or plan date", () => {
    const view = render(
      <ExecutionContextCard
        trackerKey="anonymous-tracker"
        localDate="2026-07-19"
        planVersion={3}
        execution={activeExecution()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByLabelText("当天条件补充"), {
      target: { value: "Old context draft" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "稳定椅子" }));
    fireEvent.click(
      screen.getByRole("radio", { name: /Anonymous private option/ }),
    );

    view.rerender(
      <ExecutionContextCard
        trackerKey="anonymous-tracker"
        localDate="2026-07-19"
        planVersion={3}
        execution={activeExecution()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(
      (screen.getByLabelText("当天条件补充") as HTMLTextAreaElement).value,
    ).toBe("Old context draft");

    view.rerender(
      <ExecutionContextCard
        trackerKey="anonymous-tracker"
        localDate="2026-07-19"
        planVersion={3}
        execution={activeExecution({
          context: {
            ...activeExecution().context!,
            id: "019c0000-0000-7000-8000-000000000099",
          },
        })}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(
      (screen.getByLabelText("当天条件补充") as HTMLTextAreaElement).value,
    ).toBe("");
    expect(
      (screen.getByRole("checkbox", { name: "稳定椅子" }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(
      (
        screen.getByRole("radio", {
          name: /Anonymous private option/,
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);

    fireEvent.change(screen.getByLabelText("当天条件补充"), {
      target: { value: "New context draft" },
    });
    view.rerender(
      <ExecutionContextCard
        trackerKey="anonymous-tracker"
        localDate="2026-07-20"
        planVersion={3}
        execution={activeExecution({
          context: {
            ...activeExecution().context!,
            id: "019c0000-0000-7000-8000-000000000099",
          },
        })}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(
      (screen.getByLabelText("当天条件补充") as HTMLTextAreaElement).value,
    ).toBe("");
  });
});
