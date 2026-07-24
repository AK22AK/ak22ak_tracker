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

import { PlanAdviceClient } from "@/components/plan-advice-client";
import { schemaVersion } from "@/domain/schemas";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type JobFixture = Record<string, unknown> & {
  proposal?:
    | (Record<string, unknown> & {
        status: string;
        safetyLevel: string;
        operations: unknown[];
        application?: unknown;
        decision?: unknown;
      })
    | null;
};

function page(job: JobFixture | null = null) {
  const proposal = job?.proposal;
  return {
    schemaVersion,
    configuration: "configured",
    job: proposal
      ? {
          ...job,
          proposal: {
            ...proposal,
            application: proposal.application ?? {
              effectiveFrom:
                proposal.status === "expired" ? null : "2026-07-25",
              canAccept:
                proposal.status === "proposed" &&
                proposal.safetyLevel !== "red" &&
                proposal.operations.length > 0,
              blockedReason:
                proposal.status === "expired"
                  ? "context_changed"
                  : proposal.safetyLevel === "red"
                    ? "red_safety"
                    : proposal.operations.length === 0
                      ? "no_operations"
                      : null,
            },
            decision: proposal.decision ?? null,
          },
        }
      : job,
  };
}

function renderClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <PlanAdviceClient />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe("plan advice UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("only starts analysis after an explicit click and shows decision-ready diffs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(page()))
      .mockResolvedValueOnce(
        response(
          page({
            id: "019c1000-0000-7000-8000-000000000201",
            trackerKey: "knee-rehab",
            status: "succeeded",
            errorCode: null,
            retryable: false,
            requestedAt: "2026-07-24T08:00:00.000Z",
            completedAt: "2026-07-24T08:00:02.000Z",
            proposal: {
              id: "019c1000-0000-7000-8000-000000000201",
              basePlanVersionId: "019c1000-0000-7000-8000-000000000202",
              createdAt: "2026-07-24T08:00:02.000Z",
              safetyLevel: "yellow",
              summary: "Repeat the current level",
              operations: [
                {
                  type: "remove_task",
                  taskId: "anonymous-task",
                  reason: "Allow more recovery time",
                },
              ],
              status: "proposed",
            },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "019c1000-0000-7000-8000-000000000201",
    );
    renderClient();

    const startButton = await screen.findByRole("button", {
      name: "分析并生成建议",
    });
    await waitFor(() =>
      expect((startButton as HTMLButtonElement).disabled).toBe(false),
    );
    expect(globalThis.crypto.randomUUID()).toBe(
      "019c1000-0000-7000-8000-000000000201",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(startButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Repeat the current level")).toBeTruthy();
    expect(screen.getByText("移除一项训练安排")).toBeTruthy();
    expect(screen.getByText("Allow more recovery time")).toBeTruthy();
    expect(screen.getByRole("button", { name: "接受并更新计划" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "拒绝这份建议" })).toBeTruthy();
  });

  it("restores a running job after remount without starting another request", async () => {
    const running = page({
      id: "019c1000-0000-7000-8000-000000000203",
      trackerKey: "knee-rehab",
      status: "running",
      errorCode: null,
      retryable: false,
      requestedAt: "2026-07-24T08:00:00.000Z",
      completedAt: null,
      proposal: null,
    });
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(response(running)));
    vi.stubGlobal("fetch", fetchMock);
    const first = renderClient();
    expect(await screen.findByText(/离开页面后可以稍后回来查看/)).toBeTruthy();
    first.unmount();
    renderClient();
    expect(await screen.findByText(/离开页面后可以稍后回来查看/)).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.every((call) => !call[1]?.method)).toBe(true);
  });

  it("shows a deterministic stop message for red and no operation list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response(
          page({
            id: "019c1000-0000-7000-8000-000000000204",
            trackerKey: "knee-rehab",
            status: "succeeded",
            errorCode: null,
            retryable: false,
            requestedAt: "2026-07-24T08:00:00.000Z",
            completedAt: "2026-07-24T08:00:02.000Z",
            proposal: {
              id: "019c1000-0000-7000-8000-000000000204",
              basePlanVersionId: "019c1000-0000-7000-8000-000000000205",
              createdAt: "2026-07-24T08:00:02.000Z",
              safetyLevel: "red",
              summary: "停止并重新评估",
              operations: [],
              status: "proposed",
            },
          }),
        ),
      ),
    );
    renderClient();
    expect(
      await screen.findByRole("heading", { name: "停止并重新评估" }),
    ).toBeTruthy();
    expect(screen.getByText(/先暂停相关训练/)).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(/接受后将从/)).toBeNull();
    expect(screen.queryByRole("button", { name: "接受并更新计划" })).toBeNull();
  });

  it("starts a new analysis when the saved suggestion has expired", async () => {
    const expired = page({
      id: "019c1000-0000-7000-8000-000000000206",
      trackerKey: "knee-rehab",
      status: "succeeded",
      errorCode: null,
      retryable: false,
      requestedAt: "2026-07-24T08:00:00.000Z",
      completedAt: "2026-07-24T08:00:02.000Z",
      proposal: {
        id: "019c1000-0000-7000-8000-000000000206",
        basePlanVersionId: "019c1000-0000-7000-8000-000000000207",
        createdAt: "2026-07-24T08:00:02.000Z",
        safetyLevel: "green",
        summary: "Earlier suggestion",
        operations: [],
        status: "expired",
      },
    });
    const next = page({
      id: "019c1000-0000-7000-8000-000000000208",
      trackerKey: "knee-rehab",
      status: "running",
      errorCode: null,
      retryable: false,
      requestedAt: "2026-07-24T08:01:00.000Z",
      completedAt: null,
      proposal: null,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(expired))
      .mockResolvedValueOnce(response(next));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "019c1000-0000-7000-8000-000000000208",
    );
    renderClient();

    expect(await screen.findByText("建议已过期")).toBeTruthy();
    expect(
      screen.getByText("近期记录或计划已经变化，请重新分析。"),
    ).toBeTruthy();
    expect(screen.queryByText(/基于较早的计划/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新分析" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, request] = fetchMock.mock.calls[1]!;
    expect(JSON.parse(String(request.body))).toEqual({
      commandId: "019c1000-0000-7000-8000-000000000208",
    });
  });

  it("explains why a scheduled future plan blocks direct application", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response(
          page({
            id: "019c1000-0000-7000-8000-000000000214",
            trackerKey: "knee-rehab",
            status: "succeeded",
            errorCode: null,
            retryable: false,
            requestedAt: "2026-07-24T08:00:00.000Z",
            completedAt: "2026-07-24T08:00:02.000Z",
            proposal: {
              id: "019c1000-0000-7000-8000-000000000214",
              basePlanVersionId: "019c1000-0000-7000-8000-000000000215",
              createdAt: "2026-07-24T08:00:02.000Z",
              safetyLevel: "green",
              summary: "Anonymous future adjustment",
              operations: [
                {
                  type: "remove_task",
                  taskId: "anonymous-task",
                  reason: "Anonymous reason",
                },
              ],
              status: "proposed",
              application: {
                effectiveFrom: "2026-07-25",
                canAccept: false,
                blockedReason: "future_timeline",
              },
            },
          }),
        ),
      ),
    );

    renderClient();

    expect(
      await screen.findByText("已有后续计划版本，这份建议不能直接应用。"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "接受并更新计划" })).toBeNull();
    expect(screen.getByRole("button", { name: "拒绝这份建议" })).toBeTruthy();
  });

  it("shows the effective date, requires a second confirmation and keeps other cache", async () => {
    const proposalId = "019c1000-0000-7000-8000-000000000209";
    const decisionId = "019c1000-0000-7000-8000-000000000210";
    const proposed = page({
      id: proposalId,
      trackerKey: "knee-rehab",
      status: "succeeded",
      errorCode: null,
      retryable: false,
      requestedAt: "2026-07-24T08:00:00.000Z",
      completedAt: "2026-07-24T08:00:02.000Z",
      proposal: {
        id: proposalId,
        basePlanVersionId: "019c1000-0000-7000-8000-000000000211",
        createdAt: "2026-07-24T08:00:02.000Z",
        safetyLevel: "green",
        summary: "Anonymous future adjustment",
        operations: [
          {
            type: "remove_task",
            taskId: "anonymous-task",
            reason: "Anonymous reason",
          },
        ],
        status: "proposed",
      },
    });
    const acceptedPage = page({
      ...proposed.job,
      proposal: {
        ...(proposed.job as JobFixture).proposal!,
        status: "accepted",
        application: {
          effectiveFrom: "2026-07-25",
          canAccept: false,
          blockedReason: null,
        },
        decision: {
          type: "accepted",
          decidedAt: "2026-07-24T08:01:00.000Z",
          appliedPlanVersion: {
            id: "019c1000-0000-7000-8000-000000000212",
            version: 2,
            effectiveFrom: "2026-07-25",
          },
        },
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(proposed))
      .mockResolvedValueOnce(
        response({
          schemaVersion,
          commandId: decisionId,
          proposalId,
          replayed: false,
          conflict: false,
          status: "accepted",
          appliedPlanVersion: {
            id: "019c1000-0000-7000-8000-000000000212",
            version: 2,
            effectiveFrom: "2026-07-25",
          },
          affectedDates: ["2026-07-27"],
          page: acceptedPage,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(decisionId);
    const { queryClient } = renderClient();
    queryClient.setQueryData(["anonymous-draft"], { text: "keep" });

    expect(await screen.findByText(/2026-07-25 起更新后续安排/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "接受并更新计划" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("heading", { name: "确认更新后续计划？" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认接受并更新计划" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, request] = fetchMock.mock.calls[1]!;
    expect(JSON.parse(String(request.body))).toMatchObject({
      commandId: decisionId,
      proposalId,
      decision: "accepted",
    });
    expect(await screen.findByText("计划已由你确认更新。")).toBeTruthy();
    expect(queryClient.getQueryData(["anonymous-draft"])).toEqual({
      text: "keep",
    });
  });

  it("keeps the same decision command after a failed save", async () => {
    const proposalId = "019c1000-0000-7000-8000-000000000213";
    const decisionId = "019c1000-0000-7000-8000-000000000214";
    const proposed = page({
      id: proposalId,
      trackerKey: "knee-rehab",
      status: "succeeded",
      errorCode: null,
      retryable: false,
      requestedAt: "2026-07-24T08:00:00.000Z",
      completedAt: "2026-07-24T08:00:02.000Z",
      proposal: {
        id: proposalId,
        basePlanVersionId: "019c1000-0000-7000-8000-000000000215",
        createdAt: "2026-07-24T08:00:02.000Z",
        safetyLevel: "green",
        summary: "Anonymous future adjustment",
        operations: [
          {
            type: "remove_task",
            taskId: "anonymous-task",
            reason: "Anonymous reason",
          },
        ],
        status: "proposed",
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(proposed))
      .mockResolvedValueOnce(response({ error: "temporary" }, 503))
      .mockResolvedValueOnce(response({ error: "temporary" }, 503));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(decisionId);
    renderClient();

    await screen.findByText("Anonymous future adjustment");
    fireEvent.click(screen.getByRole("button", { name: "拒绝这份建议" }));
    fireEvent.click(screen.getByRole("button", { name: "确认拒绝" }));
    expect(await screen.findByText(/决定尚未保存/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认拒绝" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const first = JSON.parse(String(fetchMock.mock.calls[1]![1].body));
    const second = JSON.parse(String(fetchMock.mock.calls[2]![1].body));
    expect(first.commandId).toBe(decisionId);
    expect(second.commandId).toBe(decisionId);
  });
});
