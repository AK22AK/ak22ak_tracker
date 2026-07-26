import { describe, expect, it } from "vitest";

import {
  normalizeGarminActivities,
  normalizeGarminWellness,
} from "@/server/integrations/garmin/normalize";

const fetchedAt = new Date("2026-07-24T03:00:00.000Z");

describe("P3b-2b Garmin activity normalization", () => {
  it("keeps only the persisted activity whitelist and stable source identity", () => {
    const [record] = normalizeGarminActivities({
      activities: [
        {
          providerRecordId: "anonymous-provider-record",
          activityType: "walking",
          startedAt: "2026-07-24T00:30:00.000Z",
          durationSeconds: 1_800,
          distanceMeters: 2_000,
          averagePaceSecondsPerKilometer: 540,
          averageHeartRateBpm: 108,
        },
      ],
      localDate: "2026-07-24",
      planningTimeZone: "Asia/Shanghai",
      fetchedAt,
    });

    expect(record).toMatchObject({
      provider: "garmin",
      providerRecordId: "anonymous-provider-record",
      kind: "activity",
      localDate: "2026-07-24",
      occurredAt: new Date("2026-07-24T00:30:00.000Z"),
      fetchedAt,
      payload: {
        activityType: "walking",
        startedAt: "2026-07-24T00:30:00.000Z",
        durationSeconds: 1_800,
        distanceMeters: 2_000,
        averagePaceSecondsPerKilometer: 540,
        averageHeartRateBpm: 108,
      },
    });
    expect(record?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(record?.payload)).not.toContain("providerRecordId");
    expect(Object.keys(record?.payload ?? {}).sort()).toEqual(
      [
        "activityType",
        "averageHeartRateBpm",
        "averagePaceSecondsPerKilometer",
        "distanceMeters",
        "durationSeconds",
        "startedAt",
      ].sort(),
    );
  });

  it("rejects activities outside the requested planning date", () => {
    expect(() =>
      normalizeGarminActivities({
        activities: [
          {
            providerRecordId: "anonymous-wrong-day",
            activityType: "walking",
            startedAt: "2026-07-23T00:30:00.000Z",
            durationSeconds: 600,
            distanceMeters: 500,
            averagePaceSecondsPerKilometer: 720,
            averageHeartRateBpm: null,
          },
        ],
        localDate: "2026-07-24",
        planningTimeZone: "Asia/Shanghai",
        fetchedAt,
      }),
    ).toThrow("invalid_response");
  });

  it("changes the content hash when a persisted metric changes", () => {
    const input = {
      activities: [
        {
          providerRecordId: "anonymous-provider-record",
          activityType: "cycling",
          startedAt: "2026-07-24T01:00:00.000Z",
          durationSeconds: 1_200,
          distanceMeters: 4_000,
          averagePaceSecondsPerKilometer: 300,
          averageHeartRateBpm: 120,
        },
      ],
      localDate: "2026-07-24",
      planningTimeZone: "Asia/Shanghai",
      fetchedAt,
    };
    const first = normalizeGarminActivities(input)[0]!;
    const changed = normalizeGarminActivities({
      ...input,
      activities: [{ ...input.activities[0], durationSeconds: 1_260 }],
    })[0]!;

    expect(changed.providerRecordId).toBe(first.providerRecordId);
    expect(changed.contentHash).not.toBe(first.contentHash);
  });
});

describe("P5a-2a Garmin daily wellness normalization", () => {
  const complete = {
    localDate: "2026-07-24",
    steps: { status: "available" as const, totalSteps: 0, stepGoal: 8000 },
    sleep: {
      status: "available" as const,
      sleepStart: "2026-07-23T22:00:00.000Z",
      sleepEnd: "2026-07-24T06:00:00.000Z",
      totalSleepSeconds: 27000,
      deepSleepSeconds: 3600,
      lightSleepSeconds: 16200,
      remSleepSeconds: 5400,
      awakeSleepSeconds: 1800,
      sleepScore: 81,
    },
  };

  it("uses one stable non-linkable record and excludes sync time from the content hash", () => {
    const [record] = normalizeGarminWellness({
      wellness: complete,
      localDate: "2026-07-24",
      planningTimeZone: "Asia/Shanghai",
      fetchedAt,
    });
    const [later] = normalizeGarminWellness({
      wellness: complete,
      localDate: "2026-07-24",
      planningTimeZone: "Asia/Shanghai",
      fetchedAt: new Date("2026-07-24T04:00:00.000Z"),
    });

    expect(record).toMatchObject({
      provider: "garmin",
      providerRecordId: "daily_wellness:2026-07-24",
      kind: "daily_wellness",
      localDate: "2026-07-24",
      payload: complete,
    });
    expect(record?.contentHash).toBe(later?.contentHash);
    expect(JSON.stringify(record?.payload)).not.toMatch(
      /calories|bodyBattery|stress|weight|spo2|providerRecordId/i,
    );
  });

  it("changes source content only when a whitelisted value or availability changes", () => {
    const [first] = normalizeGarminWellness({
      wellness: complete,
      localDate: "2026-07-24",
      planningTimeZone: "Asia/Shanghai",
      fetchedAt,
    });
    const [changed] = normalizeGarminWellness({
      wellness: {
        ...complete,
        steps: { ...complete.steps, totalSteps: 1 },
      },
      localDate: "2026-07-24",
      planningTimeZone: "Asia/Shanghai",
      fetchedAt,
    });
    const [missing] = normalizeGarminWellness({
      wellness: {
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
      },
      localDate: "2026-07-24",
      planningTimeZone: "Asia/Shanghai",
      fetchedAt,
    });

    expect(changed?.contentHash).not.toBe(first?.contentHash);
    expect(missing?.contentHash).not.toBe(first?.contentHash);
    expect(missing?.payload).toMatchObject({
      steps: { status: "missing", totalSteps: null },
      sleep: { status: "missing", totalSleepSeconds: null },
    });
  });
});
