import { describe, expect, it, vi } from "vitest";

import { coordinateLatestSync } from "@/server/integrations/today-sync-coordinator";

function completedSync(
  provider: string,
  overrides: Partial<{
    complete: boolean;
    recordCount: number;
    errorCode: string;
  }> = {},
) {
  const day = overrides.errorCode
    ? {
        date: "2026-08-07",
        status: "failed" as const,
        errorCode: overrides.errorCode,
      }
    : {
        date: "2026-08-07",
        status: "succeeded" as const,
        cached: false,
        created: 0,
        changed: 0,
        unchanged: 0,
        recordCount: overrides.recordCount ?? 0,
        syncedAt: "2026-08-07T00:00:00.000Z",
      };
  return {
    provider,
    batch: { from: "2026-08-07", to: "2026-08-07" },
    targetDate: "2026-08-07",
    days: [day],
    summary: {
      succeeded: overrides.errorCode ? 0 : 1,
      failed: overrides.errorCode ? 1 : 0,
      created: 0,
      changed: 0,
      unchanged: 0,
    },
    nextCursor: overrides.complete === false ? "2026-08-08" : null,
    complete: overrides.complete ?? true,
    lastSucceededDate: overrides.errorCode ? null : "2026-08-07",
  };
}

describe("Today latest-record sync coordinator", () => {
  it("runs connected sources in order and reports a bounded continuation", async () => {
    const order: string[] = [];
    const garminActivity = vi.fn(async () => {
      order.push("garmin_activity");
      return {
        status: "completed" as const,
        sync: completedSync("garmin", { recordCount: 1, complete: false }),
        connection: { state: "connected" },
      };
    });
    const garminWellness = vi.fn(async () => {
      order.push("garmin_wellness");
      return {
        status: "completed" as const,
        sync: completedSync("garmin", { recordCount: 0 }),
        progress: {},
      };
    });
    const xunji = vi.fn(async () => {
      order.push("xunji");
      return { status: "skipped" as const, reason: "not_connected" as const };
    });

    await expect(
      coordinateLatestSync({
        trackerKey: "knee-rehab",
        garminRuntime: {
          recoverActivityHistory: garminActivity,
          recoverWellnessHistory: garminWellness,
        },
        xunjiRuntime: { recoverHistory: xunji },
      }),
    ).resolves.toEqual({
      sources: [
        {
          source: "garmin_activity",
          status: "records",
          recordCount: 1,
          continueAvailable: true,
        },
        {
          source: "garmin_wellness",
          status: "no_records",
          recordCount: 0,
          continueAvailable: false,
        },
        {
          source: "xunji_training",
          status: "not_connected",
          recordCount: 0,
          continueAvailable: false,
        },
      ],
    });
    expect(order).toEqual(["garmin_activity", "garmin_wellness", "xunji"]);
    expect(garminActivity).toHaveBeenCalledWith({
      trackerKey: "knee-rehab",
      profile: "foreground",
    });
    expect(xunji).toHaveBeenCalledWith({
      trackerKey: "knee-rehab",
      profile: "foreground",
    });
  });

  it("keeps later sources running when one source fails and hides provider detail", async () => {
    const garminActivity = vi.fn(async () => {
      throw Object.assign(new Error("private provider response"), {
        code: "timeout",
      });
    });
    const garminWellness = vi.fn(async () => ({
      status: "skipped" as const,
      reason: "in_progress" as const,
      progress: {},
    }));
    const xunji = vi.fn(async () => ({
      status: "completed" as const,
      sync: completedSync("xunji", { recordCount: 2 }),
    }));

    await expect(
      coordinateLatestSync({
        trackerKey: "knee-rehab",
        garminRuntime: {
          recoverActivityHistory: garminActivity,
          recoverWellnessHistory: garminWellness,
        },
        xunjiRuntime: { recoverHistory: xunji },
      }),
    ).resolves.toEqual({
      sources: [
        {
          source: "garmin_activity",
          status: "temporarily_failed",
          recordCount: 0,
          continueAvailable: false,
        },
        {
          source: "garmin_wellness",
          status: "syncing",
          recordCount: 0,
          continueAvailable: true,
        },
        {
          source: "xunji_training",
          status: "records",
          recordCount: 2,
          continueAvailable: false,
        },
      ],
    });
    expect(garminWellness).toHaveBeenCalledTimes(1);
    expect(xunji).toHaveBeenCalledTimes(1);
  });
});
