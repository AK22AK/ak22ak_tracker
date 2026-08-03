// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HistorySyncCard } from "@/components/history-sync-card";

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

  it("defaults to 14 days and advances Garmin activity, wellness, then Xunji without arbitrary dates", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body)) as unknown;
        calls.push({ url, body });
        const scope = url.split("/").at(-1)!;
        return Response.json(
          result(scope, scope.startsWith("xunji") ? "xunji" : "garmin"),
        );
      }),
    );

    render(<HistorySyncCard trackerKey="knee-rehab" />);
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
      vi.fn(async (input) => {
        const url = String(input);
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
    render(<HistorySyncCard trackerKey="knee-rehab" />);

    const select = screen.getByLabelText("补录范围");
    expect(
      Array.from((select as HTMLSelectElement).options).map(
        (option) => option.value,
      ),
    ).toEqual(["7", "14", "30"]);
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
