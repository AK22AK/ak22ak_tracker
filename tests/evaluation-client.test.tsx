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

import { EvaluationClient } from "@/components/evaluation-client";
import { schemaVersion } from "@/domain/schemas";

const base = {
  trackerKey: "knee-rehab",
  currentDate: "2026-06-09",
  targetDate: "2026-06-09",
  planningTimeZone: "Asia/Shanghai",
};

const snapshot = {
  schemaVersion,
  id: "019c0000-0000-7000-8000-000000000821",
  trackerKey: "knee-rehab",
  kind: "final",
  triggerDate: "2026-06-09",
  targetDate: "2026-06-09",
  planningTimeZone: "Asia/Shanghai",
  calculationVersion: "evaluation-evidence-v1",
  createdAt: "2026-06-09T08:00:00.000Z",
  evidenceRange: { from: "2026-06-01", through: "2026-06-09" },
  basePlanVersion: {
    id: "019c0000-0000-7000-8000-000000000822",
    version: 1,
    effectiveFrom: "2026-06-01",
  },
  timelineHeadPlanVersion: {
    id: "019c0000-0000-7000-8000-000000000822",
    version: 1,
    effectiveFrom: "2026-06-01",
  },
  effectiveness: { status: "needs_policy", policyVersion: null },
  weeks: [
    {
      weekStart: "2026-06-01",
      weekEnd: "2026-06-07",
      tasks: { total: 2, completed: 1, skipped: 0, planned: 1 },
      feedback: {
        feedbackDays: 2,
        expectedDays: 7,
        maxPain: 4,
        worstSafetyLevel: "yellow",
      },
      execution: {
        pauseDays: 1,
        travelDays: 2,
        equipmentLimitedDays: 0,
        degradedDays: 1,
      },
      loadCoverage: {
        completedTasks: 1,
        durationCoveredTasks: 1,
        distanceCoveredTasks: 0,
        sourceCoveredTasks: 1,
      },
      effectiveness: { status: "needs_policy", policyVersion: null },
    },
  ],
};

const savedResult = {
  schemaVersion,
  resultVersion: "evaluation-result-v1",
  id: "019c0000-0000-7000-8000-000000000825",
  sessionId: snapshot.id,
  trackerKey: "knee-rehab",
  kind: "final",
  submittedAt: "2026-06-09T09:00:00.000Z",
  submittedLocalDate: "2026-06-09",
  basePlanVersionId: snapshot.basePlanVersion.id,
  timelineHeadPlanVersionId: snapshot.timelineHeadPlanVersion.id,
  goalCompletion: "partially_met",
  sides: {
    left: {
      symptomResponse: "mild",
      strengthAndControl: "ready",
      loadTolerance: "limited",
    },
    right: {
      symptomResponse: "none",
      strengthAndControl: "limited",
      loadTolerance: "ready",
    },
  },
  nextStageIntent: "undecided",
  note: "Anonymous note",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <EvaluationClient />
      </QueryClientProvider>,
    ),
  };
}

describe("P4c-1 evaluation UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("explains that reaching the target only opens an evaluation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({ ...base, state: "eligible", session: null }),
      ),
    );
    renderClient();

    expect(await screen.findByText("评估尚未等于完成")).toBeTruthy();
    expect(screen.getByRole("button", { name: "开启评估" })).toBeTruthy();
    expect(screen.queryByText(/左膝|右膝|进阶|延长/)).toBeNull();
  });

  it("creates a session once and renders raw weekly evidence without a verdict", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ ...base, state: "eligible", session: null }),
      )
      .mockResolvedValueOnce(
        response({
          ...base,
          state: "opened",
          session: { ...snapshot, status: "open" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "019c0000-0000-7000-8000-000000000821",
    );
    renderClient();

    fireEvent.click(await screen.findByRole("button", { name: "开启评估" }));
    expect(await screen.findByText("训练周证据")).toBeTruthy();
    expect(screen.getByText("完成 1 / 2 项")).toBeTruthy();
    expect(screen.getByText("反馈 2 / 7 天 · 最高疼痛 4 / 10")).toBeTruthy();
    expect(screen.getByText("暂停 1 天 · 出差 2 天 · 降级 1 天")).toBeTruthy();
    expect(screen.getByText(/有效训练周需要结合私人规则确认/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps an expired session visible and offers a replacement only when eligible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ...base,
          state: "expired",
          targetDate: "2026-06-10",
          canOpenReplacement: false,
          session: { ...snapshot, status: "expired" },
        }),
      ),
    );
    renderClient();

    expect(await screen.findByText("这次评估已过期")).toBeTruthy();
    expect(screen.getByText(/近期计划已经变化/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重新开启评估" })).toBeNull();
  });

  it("shows a local error and keeps the page shell when creation fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ ...base, state: "eligible", session: null }),
      )
      .mockResolvedValueOnce(
        response({ error: "evaluation_unavailable" }, 503),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderClient();

    fireEvent.click(await screen.findByRole("button", { name: "开启评估" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("暂时无法开启"),
    );
    expect(screen.getByRole("heading", { name: "阶段评估" })).toBeTruthy();
  });
});

describe("P4c-2a immutable evaluation result UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("previews independent left and right answers before any permanent write", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      response({
        ...base,
        state: "opened",
        session: { ...snapshot, status: "open" },
        result: null,
        resultSubmission: { allowed: true, blockedReason: null },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(savedResult.id);
    renderClient();

    fireEvent.change(await screen.findByLabelText("目标完成情况"), {
      target: { value: "partially_met" },
    });
    fireEvent.change(screen.getByLabelText("左侧反应"), {
      target: { value: "mild" },
    });
    fireEvent.change(screen.getByLabelText("左侧力量和动作控制"), {
      target: { value: "ready" },
    });
    fireEvent.change(screen.getByLabelText("左侧负荷耐受"), {
      target: { value: "limited" },
    });
    fireEvent.change(screen.getByLabelText("右侧反应"), {
      target: { value: "none" },
    });
    fireEvent.change(screen.getByLabelText("右侧力量和动作控制"), {
      target: { value: "limited" },
    });
    fireEvent.change(screen.getByLabelText("右侧负荷耐受"), {
      target: { value: "ready" },
    });
    fireEvent.change(screen.getByLabelText("下一阶段意向"), {
      target: { value: "undecided" },
    });
    fireEvent.change(screen.getByLabelText("补充说明（可选）"), {
      target: { value: "Anonymous note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查评估结果" }));

    expect(await screen.findByText("确认评估结果")).toBeTruthy();
    expect(screen.getByText("轻微反应 · 表现稳定 · 仍有限制")).toBeTruthy();
    expect(screen.getByText("没有不适反应 · 仍有限制 · 表现稳定")).toBeTruthy();
    expect(screen.getByText("Anonymous note")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /维护|进阶|延长/ })).toBeNull();
  });

  it("returns from confirmation with the complete draft unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      response({
        ...base,
        state: "opened",
        session: { ...snapshot, status: "open" },
        result: null,
        resultSubmission: { allowed: true, blockedReason: null },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderClient();

    fireEvent.change(await screen.findByLabelText("右侧反应"), {
      target: { value: "moderate" },
    });
    fireEvent.change(screen.getByLabelText("补充说明（可选）"), {
      target: { value: "Anonymous editable note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查评估结果" }));
    fireEvent.click(screen.getByRole("button", { name: "返回修改" }));

    expect((screen.getByLabelText("右侧反应") as HTMLSelectElement).value).toBe(
      "moderate",
    );
    expect(
      (screen.getByLabelText("补充说明（可选）") as HTMLTextAreaElement).value,
    ).toBe("Anonymous editable note");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends only one permanent write while confirmation is in flight", async () => {
    let resolvePost: (value: Response) => void = () => undefined;
    const postResponse = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          ...base,
          state: "opened",
          session: { ...snapshot, status: "open" },
          result: null,
          resultSubmission: { allowed: true, blockedReason: null },
        }),
      )
      .mockReturnValueOnce(postResponse);
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(savedResult.id);
    renderClient();

    fireEvent.click(
      await screen.findByRole("button", { name: "检查评估结果" }),
    );
    const confirm = screen.getByRole("button", { name: "确认并保存" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolvePost(
      response({
        ...base,
        state: "opened",
        session: { ...snapshot, status: "open" },
        result: savedResult,
        resultSubmission: {
          allowed: false,
          blockedReason: "already_recorded",
        },
      }),
    );
    expect(await screen.findByText("评估结果已保存")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the complete draft and command id when a save retry is unchanged", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          ...base,
          state: "opened",
          session: { ...snapshot, status: "open" },
          result: null,
          resultSubmission: { allowed: true, blockedReason: null },
        }),
      )
      .mockResolvedValueOnce(response({ error: "evaluation_unavailable" }, 503))
      .mockResolvedValueOnce(
        response({
          ...base,
          state: "opened",
          session: { ...snapshot, status: "open" },
          result: savedResult,
          resultSubmission: {
            allowed: false,
            blockedReason: "already_recorded",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(savedResult.id);
    renderClient();

    fireEvent.change(await screen.findByLabelText("左侧反应"), {
      target: { value: "mild" },
    });
    fireEvent.change(screen.getByLabelText("补充说明（可选）"), {
      target: { value: "Anonymous note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查评估结果" }));
    fireEvent.click(screen.getByRole("button", { name: "确认并保存" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "当前内容仍会保留",
    );
    expect(screen.getByText("Anonymous note")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    expect(await screen.findByText("评估结果已保存")).toBeTruthy();
    const first = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    const retry = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(retry.commandId).toBe(first.commandId);
    expect(retry.answers).toEqual(first.answers);
  });

  it("keeps a draft through a background refetch and blocks red safety", async () => {
    const opened = {
      ...base,
      state: "opened",
      session: { ...snapshot, status: "open" },
      result: null,
      resultSubmission: { allowed: true, blockedReason: null },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(opened))
      .mockResolvedValueOnce(response(opened))
      .mockResolvedValueOnce(
        response({
          ...opened,
          resultSubmission: {
            allowed: false,
            blockedReason: "red_safety",
          },
        }),
      )
      .mockResolvedValueOnce(response(opened));
    vi.stubGlobal("fetch", fetchMock);
    const { client } = renderClient();

    fireEvent.change(await screen.findByLabelText("补充说明（可选）"), {
      target: { value: "Draft survives refresh" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查评估结果" }));
    expect(screen.getByRole("button", { name: "确认并保存" })).toBeTruthy();
    await client.refetchQueries({
      queryKey: ["evaluation", "knee-rehab"],
    });
    expect(screen.getByText("Draft survives refresh")).toBeTruthy();

    await client.refetchQueries({
      queryKey: ["evaluation", "knee-rehab"],
    });
    expect(await screen.findByText("先停止并重新评估")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "确认并保存" })).toBeNull();

    await client.refetchQueries({
      queryKey: ["evaluation", "knee-rehab"],
    });
    expect(
      (
        (await screen.findByLabelText(
          "补充说明（可选）",
        )) as HTMLTextAreaElement
      ).value,
    ).toBe("Draft survives refresh");
  });
});
