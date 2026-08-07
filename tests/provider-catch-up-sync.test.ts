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
  it("keeps zero-record dates successful during catch-up", async () => {
    const store = createStore();
    const syncDate = vi.fn(async (date: string) => ({
      ...synced(date),
      created: 0,
      recordCount: 0,
    }));

    const result = await syncProviderCatchUpBatch({
      trackerId,
      provider: "xunji",
      startedOn: "2026-07-01",
      today: "2026-07-01",
      now: new Date("2026-07-01T08:00:00.000Z"),
      batchSize: 1,
      store,
      syncDate,
    });

    expect(result).toMatchObject({
      days: [{ date: "2026-07-01", status: "succeeded", recordCount: 0 }],
      summary: { succeeded: 1, failed: 0, created: 0 },
      complete: true,
      nextCursor: null,
    });
    expect(store.saveProgress).toHaveBeenCalledWith(
      expect.objectContaining({ status: "succeeded", lastErrorCode: null }),
    );
  });

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

  it("uses the automatic prior-success date inclusively while the claim state is running", async () => {
    const store = createStore({
      overallStatus: "running",
      states: [{ date: "2026-08-06", status: "succeeded" }],
    });
    const syncDate = vi.fn(async (date: string) => synced(date));

    const result = await syncProviderCatchUpBatch({
      trackerId,
      provider: "garmin",
      startedOn: "2026-08-01",
      today: "2026-08-07",
      now: new Date("2026-08-07T00:27:00.000Z"),
      batchSize: 2,
      startDate: "2026-08-06",
      store,
      syncDate,
    });

    expect(syncDate.mock.calls.map(([date]) => date)).toEqual([
      "2026-08-06",
      "2026-08-07",
    ]);
    expect(result).toMatchObject({
      nextCursor: null,
      complete: true,
    });
  });

  it("keeps a persisted cursor ahead of a newer automatic prior-success date", async () => {
    const store = createStore({
      cursorDate: "2026-08-02",
      overallStatus: "running",
      states: [],
    });
    const syncDate = vi.fn(async (date: string) => synced(date));

    await syncProviderCatchUpBatch({
      trackerId,
      provider: "xunji",
      startedOn: "2026-08-01",
      today: "2026-08-07",
      now: new Date("2026-08-07T00:27:00.000Z"),
      batchSize: 1,
      startDate: "2026-08-06",
      store,
      syncDate,
    });

    expect(syncDate).toHaveBeenCalledWith("2026-08-02");
  });

  it("completes a long automatic gap over multiple bounded cursor rounds", async () => {
    let cursorDate: string | null = null;
    let overallStatus: "running" | "succeeded" = "running";
    const states = new Map<
      string,
      { date: string; status: "running" | "succeeded" | "failed" }
    >();
    const store: ProviderCatchUpStore = {
      loadProgress: vi.fn(async () => ({
        cursorDate,
        overallStatus,
        states: [...states.values()],
      })),
      saveProgress: vi.fn(async (input) => {
        cursorDate = input.cursorDate;
        overallStatus = input.status;
      }),
    };
    const syncDate = vi.fn(async (date: string) => {
      states.set(date, { date, status: "succeeded" });
      return synced(date);
    });

    for (let round = 0; round < 4; round += 1) {
      await syncProviderCatchUpBatch({
        trackerId,
        provider: "xunji",
        startedOn: "2026-08-01",
        today: "2026-08-07",
        now: new Date("2026-08-07T00:27:00.000Z"),
        batchSize: 2,
        startDate: "2026-08-01",
        store,
        syncDate,
      });
    }

    expect(syncDate.mock.calls.map(([date]) => date)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ]);
    expect(cursorDate).toBeNull();
    expect(overallStatus).toBe("succeeded");
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

  it("stops at the first failed date and persists that date as the retry cursor", async () => {
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

    expect(syncDate).toHaveBeenCalledTimes(1);
    expect(result.days).toEqual([
      { date: "2026-07-01", status: "failed", errorCode: "rate_limited" },
    ]);
    expect(result.summary).toMatchObject({ succeeded: 0, failed: 1 });
    expect(result.nextCursor).toBe("2026-07-01");
    expect(result.complete).toBe(false);
    expect(store.saveProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        cursorDate: "2026-07-01",
        lastErrorCode: "rate_limited",
      }),
    );
  });

  it("retries the failed cursor and continues only after that date succeeds", async () => {
    const store = createStore({
      cursorDate: "2026-07-01",
      overallStatus: "failed",
      states: [{ date: "2026-07-01", status: "failed" }],
    });
    const syncDate = vi.fn(async (date: string) => synced(date));

    const result = await syncProviderCatchUpBatch({
      trackerId,
      provider: "xunji",
      startedOn: "2026-07-01",
      today: "2026-07-02",
      now: new Date("2026-07-02T08:01:00.000Z"),
      batchSize: 5,
      store,
      syncDate,
    });

    expect(syncDate.mock.calls.map(([date]) => date)).toEqual([
      "2026-07-01",
      "2026-07-02",
    ]);
    expect(result).toMatchObject({
      nextCursor: null,
      complete: true,
      summary: { succeeded: 2, failed: 0 },
    });
    expect(store.saveProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        cursorDate: null,
        lastErrorCode: null,
      }),
    );
  });
});
