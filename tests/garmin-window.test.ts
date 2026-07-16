import { describe, expect, it } from "vitest";

import { calculateGarminSyncWindow } from "@/server/sync/garmin-window";

describe("calculateGarminSyncWindow", () => {
  const planStartedAt = new Date("2026-07-01T00:00:00+08:00");
  const now = new Date("2026-07-16T10:00:00+08:00");

  it("starts the first sync at the plan start", () => {
    expect(calculateGarminSyncWindow({ planStartedAt, now })).toEqual({
      from: planStartedAt,
      to: now,
    });
  });

  it("overlaps two days after a successful sync", () => {
    const lastSuccessfulSyncAt = new Date("2026-07-15T09:00:00+08:00");
    expect(
      calculateGarminSyncWindow({
        planStartedAt,
        now,
        lastSuccessfulSyncAt,
      }).from,
    ).toEqual(new Date("2026-07-13T09:00:00+08:00"));
  });

  it("never reaches before the plan start", () => {
    const lastSuccessfulSyncAt = new Date("2026-07-02T09:00:00+08:00");
    expect(
      calculateGarminSyncWindow({
        planStartedAt,
        now,
        lastSuccessfulSyncAt,
      }).from,
    ).toEqual(planStartedAt);
  });
});
