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
import { GarminActivityRecovery } from "@/components/garmin-activity-recovery";

const connection = {
  provider: "garmin" as const,
  state: "connected" as const,
  verifiedAt: "2026-07-24T03:00:00.000Z",
  updatedAt: "2026-07-24T03:00:00.000Z",
  lastErrorCode: null,
  sync: {
    status: "running" as const,
    lastAttemptAt: "2026-07-24T03:00:00.000Z",
    lastSucceededDate: "2026-07-22",
    nextCursor: "2026-07-23",
    lastErrorCode: null,
  },
};

const completedResponse = {
  status: "completed" as const,
  sync: {
    provider: "garmin",
    batch: { from: "2026-07-23", to: "2026-07-24" },
    targetDate: "2026-07-24",
    days: [
      {
        date: "2026-07-23",
        status: "succeeded" as const,
        cached: false,
        created: 1,
        changed: 0,
        unchanged: 0,
        recordCount: 1,
        syncedAt: "2026-07-24T03:00:00.000Z",
      },
      {
        date: "2026-07-24",
        status: "succeeded" as const,
        cached: false,
        created: 0,
        changed: 0,
        unchanged: 1,
        recordCount: 1,
        syncedAt: "2026-07-24T03:00:00.000Z",
      },
    ],
    summary: {
      succeeded: 2,
      failed: 0,
      created: 1,
      changed: 0,
      unchanged: 1,
    },
    nextCursor: null,
    complete: true,
    lastSucceededDate: "2026-07-24",
  },
  connection: {
    ...connection,
    sync: {
      ...connection.sync,
      status: "succeeded" as const,
      lastSucceededDate: "2026-07-24",
      nextCursor: null,
    },
  },
};

function renderRecovery(queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <GarminActivityRecovery trackerKey="knee-rehab" />
      <main aria-label="受保护页面">页面内容</main>
      <input aria-label="未提交草稿" />
    </QueryClientProvider>,
  );
}

describe("P3b-2d Garmin foreground recovery", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("runs once on the first online mount and not on focus, visibility, or route events", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    renderRecovery();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/trackers/knee-rehab/integrations/garmin/recovery",
      { method: "POST" },
    );

    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new PopStateEvent("popstate"));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips while offline and runs one batch after connectivity returns", async () => {
    let online = false;
    vi.spyOn(window.navigator, "onLine", "get").mockImplementation(
      () => online,
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    renderRecovery();
    expect(fetchMock).not.toHaveBeenCalled();
    online = true;
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("coalesces overlapping events and throttles short reconnect churn", async () => {
    let now = Date.parse("2026-07-24T03:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
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
    "stops the current App Shell lifecycle after HTTP %s",
    async (status) => {
      let now = Date.parse("2026-07-24T03:00:00.000Z");
      vi.spyOn(Date, "now").mockImplementation(() => now);
      vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status }));
      vi.stubGlobal("fetch", fetchMock);

      renderRecovery();
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      now += 120_000;
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("stops after a canonical needs_refresh response", async () => {
    let now = Date.parse("2026-07-24T03:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status: "skipped",
        reason: "needs_refresh",
        connection: {
          ...connection,
          state: "needs_refresh",
          lastErrorCode: "authentication",
          sync: {
            ...connection.sync,
            status: "failed",
            lastErrorCode: "authentication",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderRecovery();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    now += 120_000;
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("updates only canonical Garmin status and affected date caches without replacing drafts", async () => {
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
          integrationQueryKeys.providerStatus("knee-rehab", "garmin"),
        ),
      ).toEqual(completedResponse.connection),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: trackerQueryKeys.day("knee-rehab", "2026-07-23"),
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: trackerQueryKeys.calendar("knee-rehab", "2026-07"),
      exact: true,
    });
    expect(
      (screen.getByRole("textbox", { name: "未提交草稿" }) as HTMLInputElement)
        .value,
    ).toBe("继续保留");
    expect(screen.getByRole("main", { name: "受保护页面" })).toBeTruthy();
  });

  it.each([
    ["network", () => Promise.reject(new TypeError("offline"))],
    ["rate limit", () => Promise.resolve(new Response(null, { status: 429 }))],
    ["timeout", () => Promise.resolve(new Response(null, { status: 504 }))],
    ["server", () => Promise.resolve(new Response(null, { status: 503 }))],
    [
      "invalid JSON",
      () =>
        Promise.resolve(
          new Response("{", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    ],
    [
      "invalid schema",
      () => Promise.resolve(Response.json({ status: "completed" })),
    ],
  ])(
    "isolates %s failures from caches and drafts",
    async (_label, response) => {
      vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(() => response()),
      );
      const queryClient = new QueryClient();
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");

      renderRecovery(queryClient);
      fireEvent.change(screen.getByRole("textbox", { name: "未提交草稿" }), {
        target: { value: "仍然保留" },
      });
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      await Promise.resolve();
      await Promise.resolve();

      expect(
        queryClient.getQueryData(
          integrationQueryKeys.providerStatus("knee-rehab", "garmin"),
        ),
      ).toBeUndefined();
      expect(invalidate).not.toHaveBeenCalled();
      expect(
        (
          screen.getByRole("textbox", {
            name: "未提交草稿",
          }) as HTMLInputElement
        ).value,
      ).toBe("仍然保留");
    },
  );
});
