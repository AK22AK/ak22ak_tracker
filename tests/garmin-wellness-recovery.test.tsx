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

import { integrationQueryKeys, trackerQueryKeys } from "@/client/query-keys";
import { GarminWellnessRecovery } from "@/components/garmin-wellness-recovery";

const progress = {
  provider: "garmin" as const,
  kind: "daily_wellness" as const,
  sync: {
    status: "succeeded" as const,
    lastAttemptAt: "2026-07-24T03:00:00.000Z",
    lastSucceededDate: "2026-07-24",
    nextCursor: null,
    lastErrorCode: null,
  },
};

const completedResponse = {
  status: "completed" as const,
  sync: {
    provider: "garmin",
    batch: { from: "2026-07-23", to: "2026-07-24" },
    targetDate: "2026-07-24",
    days: ["2026-07-23", "2026-07-24"].map((date) => ({
      date,
      status: "succeeded" as const,
      cached: false,
      created: 0,
      changed: 0,
      unchanged: 1,
      recordCount: 1,
      syncedAt: "2026-07-24T03:00:00.000Z",
    })),
    summary: {
      succeeded: 2,
      failed: 0,
      created: 0,
      changed: 0,
      unchanged: 2,
    },
    nextCursor: null,
    complete: true,
    lastSucceededDate: "2026-07-24",
  },
  progress,
};

function renderRecovery(queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <GarminWellnessRecovery trackerKey="knee-rehab" />
      <main aria-label="受保护页面">页面内容</main>
      <input aria-label="未提交草稿" />
    </QueryClientProvider>,
  );
}

describe("P5a-2b Garmin wellness foreground recovery", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("runs on first online mount and online recovery, but not focus or route changes", async () => {
    let online = true;
    vi.spyOn(window.navigator, "onLine", "get").mockImplementation(
      () => online,
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    renderRecovery();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/trackers/knee-rehab/integrations/garmin/wellness/recovery",
      { method: "POST" },
    );
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    online = false;
    window.dispatchEvent(new Event("online"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits while offline and runs once when connectivity returns", async () => {
    let online = false;
    vi.spyOn(window.navigator, "onLine", "get").mockImplementation(
      () => online,
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    renderRecovery();
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();

    online = true;
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  });

  it("coalesces/throttles reconnects and stops after authentication", async () => {
    let now = Date.parse("2026-07-24T03:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    renderRecovery();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    now += 120_000;
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("updates only wellness status and successful date caches while preserving drafts", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(completedResponse)),
    );
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    renderRecovery(queryClient);
    fireEvent.change(screen.getByRole("textbox", { name: "未提交草稿" }), {
      target: { value: "继续保留" },
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryData(
          integrationQueryKeys.providerStatus("knee-rehab", "garmin_wellness"),
        ),
      ).toEqual(progress),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: trackerQueryKeys.day("knee-rehab", "2026-07-23"),
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: trackerQueryKeys.today("knee-rehab", "2026-07-24"),
      exact: true,
    });
    expect(invalidate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: trackerQueryKeys.calendar("knee-rehab", "2026-07"),
      }),
    );
    expect(
      (screen.getByRole("textbox", { name: "未提交草稿" }) as HTMLInputElement)
        .value,
    ).toBe("继续保留");
  });

  it("marks the shared connection as needing refresh after an authentication failure", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    const failed = {
      status: "completed",
      sync: {
        provider: "garmin",
        batch: { from: "2026-07-24", to: "2026-07-24" },
        targetDate: "2026-07-24",
        days: [
          {
            date: "2026-07-24",
            status: "failed",
            errorCode: "authentication",
          },
        ],
        summary: {
          succeeded: 0,
          failed: 1,
          created: 0,
          changed: 0,
          unchanged: 0,
        },
        nextCursor: "2026-07-24",
        complete: false,
        lastSucceededDate: null,
      },
      progress: {
        provider: "garmin",
        kind: "daily_wellness",
        sync: {
          status: "failed",
          lastAttemptAt: "2026-07-24T03:00:00.000Z",
          lastSucceededDate: null,
          nextCursor: "2026-07-24",
          lastErrorCode: "authentication",
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(failed)),
    );
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      integrationQueryKeys.providerStatus("knee-rehab", "garmin"),
      {
        provider: "garmin",
        state: "connected",
        verifiedAt: "2026-07-24T02:00:00.000Z",
        updatedAt: "2026-07-24T02:00:00.000Z",
        lastErrorCode: null,
      },
    );

    renderRecovery(queryClient);

    await waitFor(() =>
      expect(
        queryClient.getQueryData(
          integrationQueryKeys.providerStatus("knee-rehab", "garmin"),
        ),
      ).toMatchObject({
        state: "needs_refresh",
        lastErrorCode: "authentication",
      }),
    );
  });
});
