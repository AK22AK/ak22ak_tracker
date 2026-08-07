import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  getAuthorizedSession: vi.fn(),
  coordinateLatestSync: vi.fn(),
  createDefaultGarminRuntime: vi.fn(),
  recoverXunjiHistory: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  getAuthorizedSession: harness.getAuthorizedSession,
}));
vi.mock("@/server/integrations/garmin/runtime", () => ({
  createDefaultGarminRuntime: harness.createDefaultGarminRuntime,
}));
vi.mock("@/server/integrations/today-sync-coordinator", () => ({
  coordinateLatestSync: harness.coordinateLatestSync,
}));
vi.mock("@/server/integrations/xunji/runtime", () => ({
  recoverXunjiHistory: harness.recoverXunjiHistory,
}));

import {
  maxDuration,
  POST,
} from "@/app/api/trackers/[trackerKey]/integrations/sync-latest/route";

describe("Today latest-record sync route", () => {
  it("allows enough time for the bounded three-source foreground catch-up", () => {
    expect(maxDuration).toBe(45);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    harness.getAuthorizedSession.mockResolvedValue({ user: { githubId: "1" } });
    harness.createDefaultGarminRuntime.mockReturnValue({
      recoverActivityHistory: vi.fn(),
      recoverWellnessHistory: vi.fn(),
    });
    harness.coordinateLatestSync.mockResolvedValue({
      sources: [
        {
          source: "garmin_activity",
          status: "not_connected",
          recordCount: 0,
          continueAvailable: false,
        },
        {
          source: "garmin_wellness",
          status: "not_connected",
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
  });

  it("requires the protected session", async () => {
    harness.getAuthorizedSession.mockResolvedValueOnce(null);

    const response = await POST(new Request("https://example.test"), {
      params: Promise.resolve({ trackerKey: "knee-rehab" }),
    });

    expect(response.status).toBe(401);
    expect(harness.coordinateLatestSync).not.toHaveBeenCalled();
  });

  it("coordinates the requested tracker without exposing Provider payloads", async () => {
    const response = await POST(new Request("https://example.test"), {
      params: Promise.resolve({ trackerKey: "knee-rehab" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sources: [
        {
          source: "garmin_activity",
          status: "not_connected",
          recordCount: 0,
          continueAvailable: false,
        },
        {
          source: "garmin_wellness",
          status: "not_connected",
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
    expect(harness.coordinateLatestSync).toHaveBeenCalledWith({
      trackerKey: "knee-rehab",
      garminRuntime: expect.any(Object),
      xunjiRuntime: { recoverHistory: harness.recoverXunjiHistory },
    });
  });
});
