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

import { integrationQueryKeys } from "@/client/query-keys";
import { GitHubMirrorRecovery } from "@/components/github-mirror-recovery";

function renderRecovery(queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <GitHubMirrorRecovery />
      <main aria-label="受保护页面">页面内容</main>
      <input aria-label="未提交草稿" />
    </QueryClientProvider>,
  );
}

describe("GitHub mirror recovery trigger", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("starts one bounded recovery request after the protected app opens online", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    renderRecovery();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/mirror/sync", {
      method: "POST",
    });
  });

  it("skips requests while offline and recovers once connectivity returns", async () => {
    let online = false;
    vi.spyOn(window.navigator, "onLine", "get").mockImplementation(
      () => online,
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    renderRecovery();
    expect(fetchMock).not.toHaveBeenCalled();

    online = true;
    window.dispatchEvent(new Event("online"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("coalesces overlapping triggers and throttles repeated online events", async () => {
    let now = Date.parse("2026-07-23T05:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    renderRecovery();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now += 60_000;
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it.each([401, 403])(
    "does not loop automatic recovery after an authentication response (%s)",
    async (status) => {
      let now = Date.parse("2026-07-23T05:00:00.000Z");
      vi.spyOn(Date, "now").mockImplementation(() => now);
      vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status }));
      vi.stubGlobal("fetch", fetchMock);

      renderRecovery();
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await Promise.resolve();

      now += 120_000;
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("updates only the exact status cache after a canonical response without replacing drafts", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    let resolveRequest!: (response: Response) => void;
    const request = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>(() => request);
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient();
    const status = {
      configuration: "configured" as const,
      pendingCount: 0,
      processingCount: 0,
      failedCount: 0,
      oldestPendingAt: null,
      lastSucceededAt: "2026-07-23T05:00:00.000Z",
      permissionError: false,
      delayed: false,
    };

    renderRecovery(queryClient);
    fireEvent.change(screen.getByRole("textbox", { name: "未提交草稿" }), {
      target: { value: "尚未提交的内容" },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(
      queryClient.getQueryData(integrationQueryKeys.githubMirrorStatus()),
    ).toBeUndefined();

    resolveRequest(
      Response.json({
        result: {
          status: "succeeded",
          processed: 1,
          succeeded: 1,
          failed: 0,
        },
        status,
      }),
    );

    await waitFor(() =>
      expect(
        queryClient.getQueryData(integrationQueryKeys.githubMirrorStatus()),
      ).toEqual(status),
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: "未提交草稿",
        }) as HTMLInputElement
      ).value,
    ).toBe("尚未提交的内容");
    expect(screen.getByRole("main", { name: "受保护页面" })).toBeTruthy();
  });

  it.each([
    ["server failure", new Response(null, { status: 503 })],
    [
      "invalid JSON",
      new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ],
    [
      "invalid schema",
      Response.json({ result: { status: "succeeded" }, status: {} }),
    ],
  ])("does not pollute the status cache after %s", async (_label, response) => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(response as Response),
    );
    const queryClient = new QueryClient();

    renderRecovery(queryClient);
    await waitFor(() =>
      expect(
        queryClient.getQueryState(integrationQueryKeys.githubMirrorStatus())
          ?.fetchStatus ?? "idle",
      ).toBe("idle"),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(
      queryClient.getQueryData(integrationQueryKeys.githubMirrorStatus()),
    ).toBeUndefined();
  });

  it("isolates request failures from the protected page and its draft", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    renderRecovery();
    fireEvent.change(screen.getByRole("textbox", { name: "未提交草稿" }), {
      target: { value: "继续保留" },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    expect(screen.getByRole("main", { name: "受保护页面" })).toBeTruthy();
    expect(
      (
        screen.getByRole("textbox", {
          name: "未提交草稿",
        }) as HTMLInputElement
      ).value,
    ).toBe("继续保留");
  });
});
