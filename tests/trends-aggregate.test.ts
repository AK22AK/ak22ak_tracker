import { describe, expect, it, vi } from "vitest";

import type { TrendDataStore } from "@/server/trends/aggregate";
import { getTrendsAggregate } from "@/server/trends/aggregate";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("P4a-1 trends aggregate query orchestration", () => {
  it("derives the range from the Tracker time zone and starts all range reads together", async () => {
    const pendingTracker = deferred<{
      id: string;
      key: string;
      startedOn: string;
      planningTimeZone: string;
    } | null>();
    const store: TrendDataStore = {
      getTracker: vi.fn(() => pendingTracker.promise),
      getPlanVersions: vi.fn(async () => []),
      getTasks: vi.fn(async () => []),
      getFeedbacks: vi.fn(async () => []),
    };

    const aggregatePromise = getTrendsAggregate({
      trackerKey: "knee-rehab",
      store,
      now: new Date("2026-07-19T16:30:00.000Z"),
    });
    expect(store.getPlanVersions).not.toHaveBeenCalled();
    pendingTracker.resolve({
      id: "019c0000-0000-7000-8000-000000000001",
      key: "knee-rehab",
      startedOn: "2026-06-01",
      planningTimeZone: "Asia/Shanghai",
    });

    await vi.waitFor(() =>
      expect(store.getPlanVersions).toHaveBeenCalledOnce(),
    );
    expect(store.getTasks).toHaveBeenCalledOnce();
    expect(store.getFeedbacks).toHaveBeenCalledOnce();
    expect(store.getPlanVersions).toHaveBeenCalledWith(
      "019c0000-0000-7000-8000-000000000001",
      "2026-07-26",
    );
    expect(store.getTasks).toHaveBeenCalledWith(
      "019c0000-0000-7000-8000-000000000001",
      "2026-06-01",
      "2026-07-26",
    );
    expect(store.getFeedbacks).toHaveBeenCalledWith(
      "019c0000-0000-7000-8000-000000000001",
      "2026-06-01",
      "2026-07-20",
    );
    await expect(aggregatePromise).resolves.toMatchObject({
      range: {
        start: "2026-06-01",
        end: "2026-07-26",
        currentDate: "2026-07-20",
      },
      timeZone: "Asia/Shanghai",
    });
  });
});
