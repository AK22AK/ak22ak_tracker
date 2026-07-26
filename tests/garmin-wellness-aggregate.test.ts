import { describe, expect, it } from "vitest";

import { projectGarminRecoveryReference } from "@/server/integrations/garmin/wellness-aggregate";

const base = {
  localDate: "2026-07-24",
  sourceVersion: 2,
  fetchedAt: new Date("2026-07-24T03:00:00.000Z"),
};

describe("P5a-2a Garmin wellness DTO", () => {
  it("returns only the recovery whitelist and the latest observation time", () => {
    const result = projectGarminRecoveryReference({
      ...base,
      document: {
        payload: {
          localDate: "2026-07-24",
          steps: { status: "available", totalSteps: 0, stepGoal: null },
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
        },
      },
    });

    expect(result).toMatchObject({
      provider: "garmin",
      sourceVersion: 2,
      steps: {
        status: "available",
        totalSteps: 0,
        observedAt: "2026-07-24T03:00:00.000Z",
        syncedAt: "2026-07-24T03:00:00.000Z",
      },
      sleep: { status: "missing", totalSleepSeconds: null },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /providerRecordId|raw|calories|bodyBattery|stress|weight|spo2|Token/i,
    );
  });

  it("fails closed on cross-date or unlisted payload fields", () => {
    const payload = {
      localDate: "2026-07-24",
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
    expect(
      projectGarminRecoveryReference({
        ...base,
        document: { payload: { ...payload, calories: 2000 } },
      }),
    ).toBeNull();
    expect(
      projectGarminRecoveryReference({
        ...base,
        localDate: "2026-07-23",
        document: { payload },
      }),
    ).toBeNull();
  });
});
