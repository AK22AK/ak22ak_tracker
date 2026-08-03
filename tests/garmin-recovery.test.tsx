// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { integrationQueryKeys, trackerQueryKeys } from "@/client/query-keys";
import { GarminRecovery } from "@/components/garmin-recovery";

const connection = {
  provider: "garmin" as const,
  state: "connected" as const,
  verifiedAt: "2026-07-24T03:00:00.000Z",
  updatedAt: "2026-07-24T03:00:00.000Z",
  lastErrorCode: null,
  sync: {
    status: "succeeded" as const,
    lastAttemptAt: "2026-07-24T03:00:00.000Z",
    lastSucceededDate: "2026-07-24",
    nextCursor: null,
    lastErrorCode: null,
  },
};

const wellnessProgress = {
  provider: "garmin" as const,
  kind: "daily_wellness" as const,
  sync: {
    status: "succeeded" as const,
    lastAttemptAt: "2026-07-24T03:00:01.000Z",
    lastSucceededDate: "2026-07-24",
    nextCursor: null,
    lastErrorCode: null,
  },
};

function completedSync(date: string) {
  return {
    provider: "garmin",
    batch: { from: date, to: date },
    targetDate: date,
    days: [
      {
        date,
        status: "succeeded" as const,
        cached: false,
        created: 1,
        changed: 0,
        unchanged: 0,
        recordCount: 1,
        syncedAt: "2026-07-24T03:00:00.000Z",
      },
    ],
    summary: {
      succeeded: 1,
      failed: 0,
      created: 1,
      changed: 0,
      unchanged: 0,
    },
    nextCursor: null,
    complete: true,
    lastSucceededDate: date,
  };
}

const xunjiNotDue = { status: "skipped", reason: "not_due" } as const;

function renderRecovery(queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <GarminRecovery trackerKey="knee-rehab" />
      <input aria-label="未提交草稿" />
    </QueryClientProvider>,
  );
}

describe("P5a-2b coordinated Garmin foreground recovery", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("runs activity before wellness and continues after activity is not due", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    const calls: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/garmin/recovery")) {
        return Response.json({
          status: "skipped",
          reason: "not_due",
          connection,
        });
      }
      return Response.json({
        status: "skipped",
        reason: "not_due",
        progress: wellnessProgress,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderRecovery();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(calls).toEqual([
      "/api/trackers/knee-rehab/integrations/garmin/recovery",
      "/api/trackers/knee-rehab/integrations/garmin/wellness/recovery",
      "/api/trackers/knee-rehab/integrations/xunji/recovery",
    ]);
  });

  it("continues to wellness after a temporary activity failure", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          status: "completed",
          sync: {
            ...completedSync("2026-07-24"),
            days: [
              {
                date: "2026-07-24",
                status: "failed",
                errorCode: "rate_limited",
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
          connection: {
            ...connection,
            sync: {
              ...connection.sync,
              status: "failed",
              lastErrorCode: "rate_limited",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          status: "skipped",
          reason: "not_due",
          progress: wellnessProgress,
        }),
      )
      .mockResolvedValueOnce(Response.json(xunjiNotDue));
    vi.stubGlobal("fetch", fetchMock);

    renderRecovery();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/trackers/knee-rehab/integrations/garmin/wellness/recovery",
    );
  });

  it("retries one coordinated sequence when another page owns the provider lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T03:00:00.000Z"));
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          status: "skipped",
          reason: "in_progress",
          connection,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          status: "skipped",
          reason: "not_due",
          connection,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          status: "skipped",
          reason: "not_due",
          progress: wellnessProgress,
        }),
      )
      .mockResolvedValueOnce(Response.json(xunjiNotDue))
      .mockResolvedValueOnce(Response.json(xunjiNotDue));
    vi.stubGlobal("fetch", fetchMock);

    renderRecovery();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/trackers/knee-rehab/integrations/garmin/recovery",
      "/api/trackers/knee-rehab/integrations/xunji/recovery",
      "/api/trackers/knee-rehab/integrations/garmin/recovery",
      "/api/trackers/knee-rehab/integrations/garmin/wellness/recovery",
      "/api/trackers/knee-rehab/integrations/xunji/recovery",
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("stops Garmin after its credential needs refresh while Xunji can still recover", async () => {
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
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderRecovery();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    now += 120_000;
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("updates both exact caches in sequence without clearing an editing draft", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    const activityDate = "2026-07-23";
    const wellnessDate = "2026-07-24";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          status: "completed",
          sync: completedSync(activityDate),
          connection,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          status: "completed",
          sync: completedSync(wellnessDate),
          progress: wellnessProgress,
        }),
      )
      .mockResolvedValueOnce(Response.json(xunjiNotDue));
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    renderRecovery(queryClient);
    fireEvent.change(screen.getByRole("textbox", { name: "未提交草稿" }), {
      target: { value: "继续保留" },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(
      queryClient.getQueryData(
        integrationQueryKeys.providerStatus("knee-rehab", "garmin"),
      ),
    ).toEqual(connection);
    expect(
      queryClient.getQueryData(
        integrationQueryKeys.providerStatus("knee-rehab", "garmin_wellness"),
      ),
    ).toEqual(wellnessProgress);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: trackerQueryKeys.calendar("knee-rehab", "2026-07"),
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: trackerQueryKeys.day("knee-rehab", wellnessDate),
      exact: true,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: trackerQueryKeys.today("knee-rehab", wellnessDate),
      exact: true,
    });
    expect(
      (screen.getByRole("textbox", { name: "未提交草稿" }) as HTMLInputElement)
        .value,
    ).toBe("继续保留");
  });

  it("uses the same sequential coordinator after offline connectivity returns", async () => {
    let online = false;
    vi.spyOn(window.navigator, "onLine", "get").mockImplementation(
      () => online,
    );
    const calls: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      calls.push(url);
      return url.endsWith("/wellness/recovery")
        ? Response.json({
            status: "skipped",
            reason: "not_due",
            progress: wellnessProgress,
          })
        : Response.json({
            status: "skipped",
            reason: "not_due",
            connection,
          });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderRecovery();
    expect(fetchMock).not.toHaveBeenCalled();

    online = true;
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(calls).toEqual([
      "/api/trackers/knee-rehab/integrations/garmin/recovery",
      "/api/trackers/knee-rehab/integrations/garmin/wellness/recovery",
      "/api/trackers/knee-rehab/integrations/xunji/recovery",
    ]);

    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new PopStateEvent("popstate"));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("lets a winning page run both scopes and gives a busy page one later chance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T03:00:00.000Z"));
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    let releaseFirstActivity: ((response: Response) => void) | undefined;
    const firstActivity = new Promise<Response>((resolve) => {
      releaseFirstActivity = resolve;
    });
    let activityAttempt = 0;
    const calls: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/wellness/recovery")) {
        return Response.json({
          status: "skipped",
          reason: "not_due",
          progress: wellnessProgress,
        });
      }
      if (url.endsWith("/xunji/recovery")) {
        return Response.json(xunjiNotDue);
      }
      activityAttempt += 1;
      if (activityAttempt === 1) return firstActivity;
      return Response.json({
        status: "skipped",
        reason: activityAttempt === 2 ? "in_progress" : "not_due",
        connection,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderRecovery();
    renderRecovery();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(calls.slice(0, 3)).toEqual([
      "/api/trackers/knee-rehab/integrations/garmin/recovery",
      "/api/trackers/knee-rehab/integrations/garmin/recovery",
      "/api/trackers/knee-rehab/integrations/xunji/recovery",
    ]);

    await act(async () => {
      releaseFirstActivity?.(
        Response.json({
          status: "skipped",
          reason: "not_due",
          connection,
        }),
      );
      await firstActivity;
      await Promise.resolve();
    });
    expect(calls[3]).toBe(
      "/api/trackers/knee-rehab/integrations/garmin/wellness/recovery",
    );
    expect(calls[4]).toBe(
      "/api/trackers/knee-rehab/integrations/xunji/recovery",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(calls.slice(5)).toEqual([
      "/api/trackers/knee-rehab/integrations/garmin/recovery",
      "/api/trackers/knee-rehab/integrations/garmin/wellness/recovery",
      "/api/trackers/knee-rehab/integrations/xunji/recovery",
    ]);
  });
});
