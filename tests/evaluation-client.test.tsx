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
  return render(
    <QueryClientProvider client={client}>
      <EvaluationClient />
    </QueryClientProvider>,
  );
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
