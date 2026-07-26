import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthorizedSession, recoverWellnessHistory } = vi.hoisted(() => ({
  getAuthorizedSession: vi.fn(),
  recoverWellnessHistory: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getAuthorizedSession }));
vi.mock("@/server/integrations/garmin/runtime", () => ({
  createDefaultGarminRuntime: () => ({ recoverWellnessHistory }),
}));

import { POST } from "@/app/api/trackers/[trackerKey]/integrations/garmin/wellness/recovery/route";

const params = Promise.resolve({ trackerKey: "knee-rehab" });

describe("P5a-2b Garmin wellness recovery route", () => {
  beforeEach(() => {
    getAuthorizedSession.mockReset();
    recoverWellnessHistory.mockReset();
    getAuthorizedSession.mockResolvedValue({ user: { githubId: "10001" } });
  });

  it("authenticates before running one server-owned recovery batch", async () => {
    getAuthorizedSession.mockResolvedValueOnce(null);
    const unauthorized = await POST(
      new Request("https://anonymous.invalid/api/recovery", { method: "POST" }),
      { params },
    );
    expect(unauthorized.status).toBe(401);
    expect(recoverWellnessHistory).not.toHaveBeenCalled();

    recoverWellnessHistory.mockResolvedValue({
      status: "skipped",
      reason: "not_due",
      progress: {
        provider: "garmin",
        kind: "daily_wellness",
        sync: {
          status: "succeeded",
          lastAttemptAt: "2026-07-24T03:00:00.000Z",
          lastSucceededDate: "2026-07-24",
          nextCursor: null,
          lastErrorCode: null,
        },
      },
    });
    const response = await POST(
      new Request("https://anonymous.invalid/api/recovery", {
        method: "POST",
        body: JSON.stringify({ batchSize: 31 }),
      }),
      { params },
    );
    expect(response.status).toBe(200);
    expect(recoverWellnessHistory).toHaveBeenCalledWith({
      trackerKey: "knee-rehab",
    });
  });

  it("maps runtime failures to a safe response", async () => {
    recoverWellnessHistory.mockRejectedValueOnce(
      new Error("anonymous provider detail"),
    );
    const response = await POST(
      new Request("https://anonymous.invalid/api/recovery", { method: "POST" }),
      { params },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "recovery_unavailable" });
  });
});
