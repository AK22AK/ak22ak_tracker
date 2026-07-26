import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthorizedSession, syncWellness } = vi.hoisted(() => ({
  getAuthorizedSession: vi.fn(),
  syncWellness: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getAuthorizedSession }));
vi.mock("@/server/integrations/garmin/runtime", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/server/integrations/garmin/runtime")
    >();
  return {
    ...original,
    createDefaultGarminRuntime: () => ({ syncWellness }),
  };
});

import { POST } from "@/app/api/trackers/[trackerKey]/integrations/garmin/wellness/route";
import { GarminProviderError } from "@/server/integrations/garmin/errors";
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
    getAuthorizedSession.mockResolvedValue({ user: { id: "1" } });
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
});
