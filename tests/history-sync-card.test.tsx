// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HistorySyncCard } from "@/components/history-sync-card";
import { trackerQueryKeys } from "@/client/query-keys";

const overview = {
  schemaVersion: "1.0.0",
  range: { from: "2026-07-21", through: "2026-08-03", days: 14 },
  updatedAt: "2026-08-03T08:00:00.000Z",
  scopes: [
    {
      scope: "garmin_activity_history",
      connected: true,
      status: "succeeded",
      nextCursor: null,
      lastErrorCode: null,
      updatedAt: "2026-08-03T08:00:00.000Z",
      summary: {
        processed: 14,
        records: 2,
        empty: 12,
        failed: 0,
        unknown: 0,
      },
    },
    {
      scope: "garmin_wellness_history",
      connected: true,
      status: "failed",
      nextCursor: "2026-07-30",
      lastErrorCode: "rate_limited",
      updatedAt: "2026-08-03T08:00:00.000Z",
      summary: {
        processed: 8,
        records: 5,
        empty: 3,
        failed: 1,
        unknown: 5,
      },
    },
    {
      scope: "xunji_training_history",
      connected: true,
      status: "running",
      nextCursor: "2026-08-01",
      lastErrorCode: null,
      updatedAt: "2026-08-03T08:00:00.000Z",
      summary: {
        processed: 10,
        records: 1,
        empty: 9,
        failed: 0,
        unknown: 4,
      },
    },
  ],
  recordDates: [
    {
      date: "2026-07-31",
      sources: ["garmin_activity", "garmin_wellness"],
    },
    { date: "2026-08-02", sources: ["xunji_training"] },
  ],
};

const emptyOverview = {
  ...overview,
  range: null,
  updatedAt: null,
  scopes: overview.scopes.map((scope) => ({
    ...scope,
    status: "idle",
    nextCursor: null,
    lastErrorCode: null,
    updatedAt: null,
    summary: {
      processed: 0,
      records: 0,
      empty: 0,
      failed: 0,
      unknown: 0,
    },
  })),
  recordDates: [],
};

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <HistorySyncCard trackerKey="knee-rehab" />
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient };
}

function result(scope: string, provider: "garmin" | "xunji") {
  return {
    provider,
    scope,
    range: { from: "2026-07-21", through: "2026-08-03", days: 14 },
    batch: { from: "2026-07-21", to: "2026-07-23" },
    days: [
      {
        date: "2026-07-21",
        status: "succeeded",
        cached: false,
        created: 0,
        changed: 0,
        unchanged: 0,
        recordCount: 0,
        syncedAt: "2026-08-03T08:00:00.000Z",
      },
    ],
    summary: {
      succeeded: 1,
      empty: 1,
      failed: 0,
      created: 0,
      changed: 0,
      unchanged: 0,
    },
    nextCursor: "2026-07-24",
    complete: false,
  };
}

describe("history sync card", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("restores the latest canonical range and links only dates with records", async () => {
    const fetchMock = vi.fn(async () => Response.json(overview));
    vi.stubGlobal("fetch", fetchMock);

    renderCard();

    expect(await screen.findByText("2026-07-21 至 2026-08-03")).toBeTruthy();
    expect(screen.getByText(/已处理 14 天/)).toBeTruthy();
    expect(screen.getByText(/空记录 12 天/)).toBeTruthy();
    expect(screen.getByText(/失败 1 天/)).toBeTruthy();
    expect(screen.getByText(/未处理 5 天/)).toBeTruthy();
    expect(screen.getByText(/已处理不等于当天有记录/)).toBeTruthy();
    expect(
      screen
        .getByRole("link", {
          name: /2026-07-31.*Garmin 活动.*睡眠与步数/,
        })
        .getAttribute("href"),
    ).toBe("/calendar?date=2026-07-31");
    expect(
      screen
        .getByRole("link", { name: /2026-08-02.*训记/ })
        .getAttribute("href"),
    ).toBe("/calendar?date=2026-08-02");
    expect(screen.queryByText("2026-07-30")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/trackers/knee-rehab/integrations/history-sync",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("restores the same persisted overview after the page is remounted", async () => {
    const fetchMock = vi.fn(async () => Response.json(overview));
    vi.stubGlobal("fetch", fetchMock);

    const first = renderCard();
    expect(await screen.findByText("有记录的日期")).toBeTruthy();
    first.unmount();

    renderCard();
    expect(
      await screen.findByRole("link", { name: /2026-08-02.*训记/ }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("disables history sync when none of the three sources is connected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...emptyOverview,
          scopes: emptyOverview.scopes.map((scope) => ({
            ...scope,
            connected: false,
          })),
        }),
      ),
    );

    renderCard();
    expect(
      await screen.findByText("尚未连接 Garmin 或训记，请先完成连接。"),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "同步过去 14 天",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("invalidates only successful day and month queries after a batch", async () => {
    const succeeded = {
      ...result("garmin_activity_history", "garmin"),
      days: [
        {
          date: "2026-07-31",
          status: "succeeded" as const,
          cached: false,
          created: 1,
          changed: 0,
          unchanged: 0,
          recordCount: 1,
          syncedAt: "2026-08-03T08:00:00.000Z",
        },
        {
          date: "2026-08-01",
          status: "succeeded" as const,
          cached: false,
          created: 0,
          changed: 0,
          unchanged: 0,
          recordCount: 0,
          syncedAt: "2026-08-03T08:00:00.000Z",
        },
      ],
      summary: {
        succeeded: 2,
        empty: 1,
        failed: 0,
        created: 1,
        changed: 0,
        unchanged: 0,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input, init) =>
        !init?.method ? Response.json(emptyOverview) : Response.json(succeeded),
      ),
    );
    const { queryClient } = renderCard();
    const touched = [
      trackerQueryKeys.today("knee-rehab", "2026-07-31"),
      trackerQueryKeys.day("knee-rehab", "2026-07-31"),
      trackerQueryKeys.today("knee-rehab", "2026-08-01"),
      trackerQueryKeys.day("knee-rehab", "2026-08-01"),
      trackerQueryKeys.calendar("knee-rehab", "2026-07"),
      trackerQueryKeys.calendar("knee-rehab", "2026-08"),
    ];
    const untouched = trackerQueryKeys.calendar("knee-rehab", "2026-06");
    for (const key of [...touched, untouched]) {
      queryClient.setQueryData(key, { anonymous: true });
    }

    await screen.findByText("还没有历史补录结果。");
    fireEvent.click(screen.getByRole("button", { name: "同步过去 14 天" }));
    await screen.findByText(/本批已完成/);

    expect(
      touched.every((key) => queryClient.getQueryState(key)?.isInvalidated),
    ).toBe(true);
    expect(queryClient.getQueryState(untouched)?.isInvalidated).toBe(false);
  });

  it("defaults to 14 days and advances Garmin activity, wellness, then Xunji without arbitrary dates", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init) => {
        const url = String(input);
        if (!init?.method) return Response.json(emptyOverview);
        const body = JSON.parse(String(init?.body)) as unknown;
        calls.push({ url, body });
        const scope = url.split("/").at(-1)!;
        return Response.json(
          result(scope, scope.startsWith("xunji") ? "xunji" : "garmin"),
        );
      }),
    );

    renderCard();
    await screen.findByText("还没有历史补录结果。");
    fireEvent.click(screen.getByRole("button", { name: "同步过去 14 天" }));

    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls.map((call) => call.url)).toEqual([
      "/api/trackers/knee-rehab/integrations/history-sync/garmin_activity_history",
      "/api/trackers/knee-rehab/integrations/history-sync/garmin_wellness_history",
      "/api/trackers/knee-rehab/integrations/history-sync/xunji_training_history",
    ]);
    expect(
      calls.every((call) => JSON.stringify(call.body) === '{"days":14}'),
    ).toBe(true);
    expect(screen.getByText(/当天没有记录 3 天/)).toBeTruthy();
  });

  it("offers only 7, 14 and 30 day choices and keeps the selected value after a failure", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init) => {
        const url = String(input);
        if (!init?.method) return Response.json(emptyOverview);
        calls.push(url);
        if (url.endsWith("garmin_activity_history")) {
          return Response.json({ error: "rate_limited" }, { status: 429 });
        }
        const scope = url.split("/").at(-1)!;
        return Response.json(
          result(scope, scope.startsWith("xunji") ? "xunji" : "garmin"),
        );
      }),
    );
    renderCard();

    const select = screen.getByLabelText("补录范围");
    expect(
      Array.from((select as HTMLSelectElement).options).map(
        (option) => option.value,
      ),
    ).toEqual(["7", "14", "30"]);
    await screen.findByText("还没有历史补录结果。");
    fireEvent.change(select, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "同步过去 30 天" }));

    await waitFor(() =>
      expect(
        screen.getAllByText("请求较多，请稍后继续。已完成的日期会保留。"),
      ).toHaveLength(2),
    );
    expect(calls).toHaveLength(3);
    expect(
      screen.getByText("Garmin 活动").parentElement?.textContent,
    ).toContain("请求较多");
    expect(
      screen.getByText("Garmin 睡眠与步数").parentElement?.textContent,
    ).toContain("下次从");
    expect(screen.getByText("训记训练").parentElement?.textContent).toContain(
      "下次从",
    );
    expect((select as HTMLSelectElement).value).toBe("30");
  });
});
