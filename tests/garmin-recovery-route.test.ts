import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthorizedSession, recoverActivityHistory } = vi.hoisted(() => ({
  getAuthorizedSession: vi.fn(),
  recoverActivityHistory: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getAuthorizedSession }));
vi.mock("@/server/integrations/garmin/runtime", () => ({
  createDefaultGarminRuntime: () => ({ recoverActivityHistory }),
}));

import { POST } from "@/app/api/trackers/[trackerKey]/integrations/garmin/recovery/route";

describe("P3b-2d Garmin automatic recovery route", () => {
  beforeEach(() => {
    getAuthorizedSession.mockReset();
    recoverActivityHistory.mockReset();
    getAuthorizedSession.mockResolvedValue({ user: { githubId: "12345" } });
  });

  it("requires a user session before considering automatic recovery", async () => {
    getAuthorizedSession.mockResolvedValueOnce(null);

    const response = await POST(new Request("https://anonymous.invalid"), {
      params: Promise.resolve({ trackerKey: "knee-rehab" }),
    });

    expect(response.status).toBe(401);
    expect(recoverActivityHistory).not.toHaveBeenCalled();
  });

  it("returns only the canonical bounded recovery result", async () => {
    recoverActivityHistory.mockResolvedValue({
      status: "skipped",
      reason: "not_due",
      connection: {
        provider: "garmin",
        state: "connected",
        verifiedAt: "2026-07-24T03:00:00.000Z",
        updatedAt: "2026-07-24T03:00:00.000Z",
        lastErrorCode: null,
        sync: {
          status: "succeeded",
          lastAttemptAt: "2026-07-24T02:55:00.000Z",
          lastSucceededDate: "2026-07-24",
          nextCursor: null,
          lastErrorCode: null,
        },
      },
    });

    const response = await POST(new Request("https://anonymous.invalid"), {
      params: Promise.resolve({ trackerKey: "knee-rehab" }),
    });

    expect(response.status).toBe(200);
    expect(recoverActivityHistory).toHaveBeenCalledWith({
      trackerKey: "knee-rehab",
    });
    expect(await response.json()).toMatchObject({
      status: "skipped",
      reason: "not_due",
      connection: { state: "connected" },
    });
  });

  it("fails safely without exposing internal Provider details", async () => {
    recoverActivityHistory.mockRejectedValueOnce(
      new Error("private provider response"),
    );

    const response = await POST(new Request("https://anonymous.invalid"), {
      params: Promise.resolve({ trackerKey: "knee-rehab" }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "recovery_unavailable" });
  });
});
