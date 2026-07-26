import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAuthorizedSession,
  syncWellness,
  syncWellnessHistory,
  wellnessProgress,
} = vi.hoisted(() => ({
  getAuthorizedSession: vi.fn(),
  syncWellness: vi.fn(),
  syncWellnessHistory: vi.fn(),
  wellnessProgress: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getAuthorizedSession }));
vi.mock("@/server/integrations/garmin/runtime", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/server/integrations/garmin/runtime")
    >();
  return {
    ...original,
    createDefaultGarminRuntime: () => ({
      syncWellness,
      syncWellnessHistory,
      wellnessProgress,
    }),
  };
});

import {
  GET,
  POST,
} from "@/app/api/trackers/[trackerKey]/integrations/garmin/wellness/route";
import { GarminProviderError } from "@/server/integrations/garmin/errors";
import { IntegrationOperationInProgressError } from "@/server/integrations/credentials/operation-errors";
import { GarminPreviewDateOutOfRangeError } from "@/server/integrations/garmin/runtime";

const params = Promise.resolve({ trackerKey: "anonymous-tracker" });
const request = (date: string) =>
  new Request("https://anonymous.invalid/api/wellness", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date }),
  });

describe("P5a-2a Garmin wellness route", () => {
  beforeEach(() => {
    getAuthorizedSession.mockReset();
    syncWellness.mockReset();
    syncWellnessHistory.mockReset();
    wellnessProgress.mockReset();
    getAuthorizedSession.mockResolvedValue({ user: { id: "1" } });
  });

  it("returns the isolated persisted wellness progress", async () => {
    wellnessProgress.mockResolvedValue({
      provider: "garmin",
      kind: "daily_wellness",
      sync: {
        status: "running",
        lastAttemptAt: "2026-07-24T03:00:00.000Z",
        lastSucceededDate: "2026-07-22",
        nextCursor: "2026-07-23",
        lastErrorCode: null,
      },
    });
    const response = await GET(new Request("https://anonymous.invalid"), {
      params,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      kind: "daily_wellness",
      sync: { nextCursor: "2026-07-23" },
    });
  });

  it("uses an empty body for the server-owned bounded catch-up range", async () => {
    syncWellnessHistory.mockResolvedValue({
      provider: "garmin",
      batch: { from: "2026-07-18", to: "2026-07-22" },
      targetDate: "2026-07-24",
      days: [],
      summary: {
        succeeded: 0,
        failed: 0,
        created: 0,
        changed: 0,
        unchanged: 0,
      },
      nextCursor: "2026-07-23",
      complete: false,
      lastSucceededDate: "2026-07-22",
    });
    const response = await POST(
      new Request("https://anonymous.invalid/api/wellness", {
        method: "POST",
      }),
      { params },
    );

    expect(response.status).toBe(200);
    expect(syncWellnessHistory).toHaveBeenCalledWith({
      trackerKey: "anonymous-tracker",
    });
    expect(syncWellness).not.toHaveBeenCalled();

    const expanded = await POST(
      new Request("https://anonymous.invalid/api/wellness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startedOn: "2000-01-01", batchSize: 31 }),
      }),
      { params },
    );
    expect(expanded.status).toBe(400);
    expect(syncWellnessHistory).toHaveBeenCalledTimes(1);
  });

  it("requires authentication and returns only a strict sync summary", async () => {
    getAuthorizedSession.mockResolvedValueOnce(null);
    expect((await POST(request("2026-07-24"), { params })).status).toBe(401);
    expect(syncWellness).not.toHaveBeenCalled();

    syncWellness.mockResolvedValue({
      provider: "garmin",
      kind: "daily_wellness",
      date: "2026-07-24",
      sync: {
        cached: false,
        created: 1,
        changed: 0,
        unchanged: 0,
        recordCount: 1,
        syncedAt: "2026-07-24T02:00:00.000Z",
      },
    });
    const response = await POST(request("2026-07-24"), { params });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({ kind: "daily_wellness", date: "2026-07-24" }),
    );
  });

  it("rejects future dates and classifies technical failures safely", async () => {
    syncWellness.mockRejectedValueOnce(new GarminPreviewDateOutOfRangeError());
    const future = await POST(request("2026-07-25"), { params });
    expect(future.status).toBe(400);
    expect(await future.json()).toEqual({ error: "future_date_not_allowed" });

    syncWellness.mockRejectedValueOnce(
      new GarminProviderError("timeout", {
        cause: new Error("anonymous provider detail"),
      }),
    );
    const failed = await POST(request("2026-07-24"), { params });
    expect(failed.status).toBe(504);
    expect(await failed.json()).toEqual({ error: "timeout" });
  });

  it("does not record a busy shared credential operation as a failed day", async () => {
    syncWellnessHistory.mockRejectedValueOnce(
      new IntegrationOperationInProgressError(),
    );

    const response = await POST(
      new Request("https://anonymous.invalid/api/wellness", {
        method: "POST",
      }),
      { params },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "sync_in_progress" });
  });
});
