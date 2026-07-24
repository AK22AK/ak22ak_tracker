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

function page(job: unknown = null) {
  return { schemaVersion, configuration: "configured", job };
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

describe("read-only plan advice UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("only starts analysis after an explicit click and shows read-only diffs", async () => {
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
    expect(
      screen.queryByRole("button", { name: /接受|应用|拒绝|回滚/ }),
    ).toBeNull();
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

    expect(await screen.findByText(/基于较早的计划/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新分析" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, request] = fetchMock.mock.calls[1]!;
    expect(JSON.parse(String(request.body))).toEqual({
      commandId: "019c1000-0000-7000-8000-000000000208",
    });
  });
});
