import { describe, expect, it, vi } from "vitest";

import {
  syncProviderCatchUpBatch,
  type ProviderCatchUpStore,
} from "@/server/integrations/core/sync-provider-catch-up";

const trackerId = "019c0000-0000-7000-8000-000000000001";

function createStore(input?: {
  cursorDate?: string | null;
  overallStatus?: "idle" | "running" | "succeeded" | "failed";
  states?: Array<{
    date: string;
    status: "running" | "succeeded" | "failed";
  }>;
}): ProviderCatchUpStore {
  return {
    loadProgress: vi.fn(async () => ({
      cursorDate: input?.cursorDate ?? null,
      overallStatus: input?.overallStatus ?? "idle",
      states: input?.states ?? [],
    })),
    saveProgress: vi.fn(async () => undefined),
  };
}

function synced(date: string) {
  return {
    cached: false,
    created: 1,
    changed: 0,
    unchanged: 0,
    recordCount: 1,
    syncedAt: `${date}T08:00:00.000Z`,
  };
}

describe("provider-neutral catch-up sync", () => {
  it("starts at tracker.startedOn and returns a bounded next cursor", async () => {
    const store = createStore();
    const syncDate = vi.fn(async (date: string) => synced(date));

    const result = await syncProviderCatchUpBatch({
      trackerId,
      provider: "xunji",
      startedOn: "2026-07-01",
      today: "2026-07-05",
      now: new Date("2026-07-05T08:00:00.000Z"),
      batchSize: 2,
      store,
      syncDate,
    });

    expect(syncDate.mock.calls.map(([date]) => date)).toEqual([
      "2026-07-01",
      "2026-07-02",
    ]);
    expect(result).toMatchObject({
      batch: { from: "2026-07-01", to: "2026-07-02" },
      targetDate: "2026-07-05",
      nextCursor: "2026-07-03",
      complete: false,
      summary: { succeeded: 2, failed: 0 },
    });
  });

  it("recovers from persisted date states instead of repeating an interrupted batch", async () => {
    const store = createStore({
      cursorDate: "2026-07-01",
      states: [
        { date: "2026-07-01", status: "succeeded" },
        { date: "2026-07-02", status: "succeeded" },
      ],
    });
    const syncDate = vi.fn(async (date: string) => synced(date));

    const result = await syncProviderCatchUpBatch({
      trackerId,
      provider: "xunji",
      startedOn: "2026-07-01",
      today: "2026-07-05",
      now: new Date("2026-07-05T08:00:00.000Z"),
      batchSize: 2,
      store,
      syncDate,
    });

    expect(syncDate.mock.calls.map(([date]) => date)).toEqual([
      "2026-07-03",
      "2026-07-04",
    ]);
    expect(result.nextCursor).toBe("2026-07-05");
  });

  it("retries gaps without re-reading successful dates around them", async () => {
    const store = createStore({
      states: [
        { date: "2026-07-01", status: "succeeded" },
        { date: "2026-07-02", status: "failed" },
        { date: "2026-07-03", status: "succeeded" },
      ],
    });
    const syncDate = vi.fn(async (date: string) => synced(date));

    await syncProviderCatchUpBatch({
      trackerId,
      provider: "xunji",
      startedOn: "2026-07-01",
      today: "2026-07-04",
      now: new Date("2026-07-04T08:00:00.000Z"),
      batchSize: 5,
      store,
      syncDate,
    });

    expect(syncDate.mock.calls.map(([date]) => date)).toEqual([
      "2026-07-02",
      "2026-07-04",
    ]);
  });

  it("uses a two-day overlap after the full range has succeeded and never precedes startedOn", async () => {
    const store = createStore({
      states: [
        { date: "2026-07-03", status: "succeeded" },
        { date: "2026-07-04", status: "succeeded" },
        { date: "2026-07-05", status: "succeeded" },
      ],
    });
    const syncDate = vi.fn(async (date: string) => synced(date));

    const result = await syncProviderCatchUpBatch({
      trackerId,
      provider: "xunji",
      startedOn: "2026-07-03",
      today: "2026-07-05",
      now: new Date("2026-07-05T08:00:00.000Z"),
      batchSize: 5,
      overlapDays: 2,
      store,
      syncDate,
    });

    expect(syncDate.mock.calls.map(([date]) => date)).toEqual([
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
    ]);
    expect(result.complete).toBe(true);
    expect(result.nextCursor).toBeNull();
  });

  it("starts a later run two days before the latest success before catching up new dates", async () => {
    const store = createStore({
      overallStatus: "succeeded",
      states: [
        { date: "2026-07-01", status: "succeeded" },
        { date: "2026-07-02", status: "succeeded" },
        { date: "2026-07-03", status: "succeeded" },
      ],
    });
    const syncDate = vi.fn(async (date: string) => synced(date));

    await syncProviderCatchUpBatch({
      trackerId,
      provider: "xunji",
      startedOn: "2026-07-01",
      today: "2026-07-05",
      now: new Date("2026-07-05T08:00:00.000Z"),
      batchSize: 5,
      overlapDays: 2,
      store,
      syncDate,
    });

    expect(syncDate.mock.calls.map(([date]) => date)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
    ]);
  });

  it("continues after one date fails and preserves the failed day in the result", async () => {
    const store = createStore();
    const syncDate = vi.fn(async (date: string) => {
      if (date === "2026-07-01") {
        throw Object.assign(new Error("provider failed"), {
          code: "rate_limited",
        });
      }
      return synced(date);
    });

    const result = await syncProviderCatchUpBatch({
      trackerId,
      provider: "xunji",
      startedOn: "2026-07-01",
      today: "2026-07-02",
      now: new Date("2026-07-02T08:00:00.000Z"),
      batchSize: 5,
      store,
      syncDate,
    });

    expect(syncDate).toHaveBeenCalledTimes(2);
    expect(result.days).toEqual([
      { date: "2026-07-01", status: "failed", errorCode: "rate_limited" },
      expect.objectContaining({ date: "2026-07-02", status: "succeeded" }),
    ]);
    expect(result.summary).toMatchObject({ succeeded: 1, failed: 1 });
    expect(result.complete).toBe(true);
    expect(store.saveProgress).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", cursorDate: null }),
    );
  });
});
