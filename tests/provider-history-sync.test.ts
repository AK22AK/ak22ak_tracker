import { describe, expect, it, vi } from "vitest";

import {
  syncProviderHistoryBatch,
  type ProviderHistoryStore,
} from "@/server/integrations/core/sync-provider-history";
import { projectProviderHistoryOverview } from "@/server/integrations/core/history-sync-overview";

const trackerId = "019c0000-0000-7000-8000-000000000001";

function store(input?: {
  rangeFrom?: string;
  rangeThrough?: string;
  nextDate?: string | null;
  states?: Array<{
    date: string;
    status: "running" | "succeeded" | "failed";
  }>;
}): ProviderHistoryStore {
  return {
    load: vi.fn(async () =>
      input?.rangeFrom && input.rangeThrough
        ? {
            rangeFrom: input.rangeFrom,
            rangeThrough: input.rangeThrough,
            nextDate: input.nextDate ?? null,
            states: input.states ?? [],
          }
        : null,
    ),
    save: vi.fn(async () => undefined),
  };
}

function success(date: string, recordCount = 1) {
  return {
    cached: false,
    created: recordCount,
    changed: 0,
    unchanged: 0,
    recordCount,
    syncedAt: `${date}T08:00:00.000Z`,
  };
}

describe("provider-neutral bounded history sync", () => {
  it("projects the latest cross-month range, honest daily counts and record-only dates", () => {
    const updatedAt = new Date("2026-08-03T08:00:00.000Z");
    const missingWellness = {
      localDate: "2026-07-30",
      steps: { status: "missing", totalSteps: null, stepGoal: null },
      sleep: {
        status: "missing",
        sleepStart: null,
        sleepEnd: null,
        totalSleepSeconds: null,
        deepSleepSeconds: null,
        lightSleepSeconds: null,
        remSleepSeconds: null,
        awakeSleepSeconds: null,
        sleepScore: null,
      },
    };
    const result = projectProviderHistoryOverview({
      syncRows: [
        {
          provider: "garmin_activity_history",
          status: "succeeded",
          cursor: {
            kind: "bounded_date_range_v1",
            rangeFrom: "2026-07-21",
            rangeThrough: "2026-08-03",
            nextDate: null,
          },
          lastErrorCode: null,
          updatedAt,
        },
        {
          provider: "garmin_wellness_history",
          status: "failed",
          cursor: {
            kind: "bounded_date_range_v1",
            rangeFrom: "2026-07-21",
            rangeThrough: "2026-08-03",
            nextDate: "2026-07-23",
          },
          lastErrorCode: "anonymous_internal_error",
          updatedAt,
        },
        {
          provider: "xunji_training_history",
          status: "running",
          cursor: {
            kind: "bounded_date_range_v1",
            rangeFrom: "2026-07-28",
            rangeThrough: "2026-08-03",
            nextDate: "2026-07-30",
          },
          lastErrorCode: null,
          updatedAt: new Date("2026-08-03T07:59:00.000Z"),
        },
      ],
      dateStates: [
        {
          provider: "garmin_activity_history",
          localDate: "2026-07-21",
          status: "succeeded",
          recordCount: 0,
        },
        {
          provider: "garmin_activity_history",
          localDate: "2026-07-22",
          status: "succeeded",
          recordCount: 2,
        },
        {
          provider: "garmin_wellness_history",
          localDate: "2026-07-21",
          status: "succeeded",
          recordCount: 1,
        },
        {
          provider: "garmin_wellness_history",
          localDate: "2026-07-23",
          status: "failed",
          recordCount: 0,
        },
      ],
      records: [
        {
          provider: "garmin",
          kind: "activity",
          localDate: "2026-07-22",
          document: { payload: {} },
        },
        {
          provider: "garmin",
          kind: "daily_wellness",
          localDate: "2026-07-30",
          document: { payload: missingWellness },
        },
        {
          provider: "garmin",
          kind: "daily_wellness",
          localDate: "2026-07-21",
          document: {
            payload: {
              ...missingWellness,
              localDate: "2026-07-21",
              steps: { status: "available", totalSteps: 0, stepGoal: null },
            },
          },
        },
        {
          provider: "xunji",
          kind: "strength_training",
          localDate: "2026-08-02",
          document: { payload: {} },
        },
      ],
      connectedProviders: ["garmin", "xunji"],
    });

    expect(result.range).toEqual({
      from: "2026-07-21",
      through: "2026-08-03",
      days: 14,
    });
    expect(result.scopes).toEqual([
      expect.objectContaining({
        scope: "garmin_activity_history",
        summary: {
          processed: 2,
          records: 1,
          empty: 1,
          failed: 0,
          unknown: 12,
        },
      }),
      expect.objectContaining({
        scope: "garmin_wellness_history",
        nextCursor: "2026-07-23",
        lastErrorCode: "provider_unavailable",
        summary: {
          processed: 1,
          records: 1,
          empty: 0,
          failed: 1,
          unknown: 12,
        },
      }),
      expect.objectContaining({
        scope: "xunji_training_history",
        status: "idle",
        summary: {
          processed: 0,
          records: 0,
          empty: 0,
          failed: 0,
          unknown: 14,
        },
      }),
    ]);
    expect(result.recordDates).toEqual([
      { date: "2026-08-02", sources: ["xunji_training"] },
      { date: "2026-07-22", sources: ["garmin_activity"] },
      { date: "2026-07-21", sources: ["garmin_wellness"] },
    ]);
  });

  it("derives the exact 14-day range on the server and persists zero-record days", async () => {
    const progress = store();
    const syncDate = vi.fn(async (date: string) => success(date, 0));

    const result = await syncProviderHistoryBatch({
      trackerId,
      provider: "garmin",
      scope: "garmin_activity_history",
      days: 14,
      today: "2026-08-03",
      now: new Date("2026-08-03T08:00:00.000Z"),
      batchSize: 3,
      store: progress,
      syncDate,
    });

    expect(syncDate.mock.calls.map(([date]) => date)).toEqual([
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
    ]);
    expect(result).toMatchObject({
      scope: "garmin_activity_history",
      range: { from: "2026-07-21", through: "2026-08-03", days: 14 },
      nextCursor: "2026-07-24",
      complete: false,
      summary: { succeeded: 3, empty: 3, failed: 0 },
    });
  });

  it("resets to an earlier server-derived start when the user expands 14 days to 30", async () => {
    const progress = store({
      rangeFrom: "2026-07-21",
      rangeThrough: "2026-08-03",
      nextDate: "2026-07-25",
      states: [
        { date: "2026-07-21", status: "succeeded" },
        { date: "2026-07-22", status: "succeeded" },
      ],
    });
    const syncDate = vi.fn(async (date: string) => success(date));

    await syncProviderHistoryBatch({
      trackerId,
      provider: "garmin",
      scope: "garmin_activity_history",
      days: 30,
      today: "2026-08-03",
      now: new Date("2026-08-03T08:00:00.000Z"),
      batchSize: 2,
      store: progress,
      syncDate,
    });

    expect(syncDate.mock.calls.map(([date]) => date)).toEqual([
      "2026-07-05",
      "2026-07-06",
    ]);
  });

  it("stops on the first failure and resumes that same date without touching normal cursor state", async () => {
    const progress = store();
    const syncDate = vi.fn(async (date: string) => {
      if (date === "2026-08-01") {
        throw Object.assign(new Error("temporary"), { code: "timeout" });
      }
      return success(date);
    });

    const result = await syncProviderHistoryBatch({
      trackerId,
      provider: "xunji",
      scope: "xunji_training_history",
      days: 7,
      today: "2026-08-03",
      now: new Date("2026-08-03T08:00:00.000Z"),
      batchSize: 5,
      store: progress,
      syncDate,
    });

    expect(result.nextCursor).toBe("2026-08-01");
    expect(result.summary).toMatchObject({ succeeded: 4, failed: 1 });
    expect(progress.save).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "xunji_training_history",
        nextDate: "2026-08-01",
        status: "failed",
      }),
    );
  });
});
