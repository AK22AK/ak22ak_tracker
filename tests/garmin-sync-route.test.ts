import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthorizedSession, syncActivities, syncActivityHistory } =
  vi.hoisted(() => ({
    getAuthorizedSession: vi.fn(),
    syncActivities: vi.fn(),
    syncActivityHistory: vi.fn(),
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
      syncActivities,
      syncActivityHistory,
    }),
  };
});

import { POST } from "@/app/api/trackers/[trackerKey]/integrations/[provider]/sync/route";
import { GarminProviderError } from "@/server/integrations/garmin/errors";

function request(body: unknown) {
  return new Request("https://anonymous.invalid/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function emptyRequest() {
  return new Request("https://anonymous.invalid/api/sync", {
    method: "POST",
  });
}

const params = Promise.resolve({
  trackerKey: "anonymous-tracker",
  provider: "garmin",
});

describe("P3b-2b Garmin single-date sync route", () => {
  beforeEach(() => {
    getAuthorizedSession.mockReset();
    syncActivities.mockReset();
    syncActivityHistory.mockReset();
    getAuthorizedSession.mockResolvedValue({ user: { id: "1" } });
  });

  it("starts a bounded server-owned catch-up when the request has no body", async () => {
    syncActivityHistory.mockResolvedValue({
      provider: "garmin",
      batch: { from: "2026-07-18", to: "2026-07-22" },
      targetDate: "2026-07-24",
      days: [],
      summary: {
        succeeded: 5,
        failed: 0,
        created: 1,
        changed: 0,
        unchanged: 4,
      },
      nextCursor: "2026-07-23",
      complete: false,
      lastSucceededDate: "2026-07-22",
    });

    const response = await POST(emptyRequest(), { params });

    expect(response.status).toBe(200);
    expect(syncActivityHistory).toHaveBeenCalledWith({
      trackerKey: "anonymous-tracker",
    });
    expect(syncActivities).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      provider: "garmin",
      nextCursor: "2026-07-23",
      complete: false,
    });
  });

  it("rejects client-supplied catch-up boundaries", async () => {
    const response = await POST(request({ startedOn: "2026-01-01" }), {
      params,
    });

    expect(response.status).toBe(400);
    expect(syncActivityHistory).not.toHaveBeenCalled();
    expect(syncActivities).not.toHaveBeenCalled();
  });

  it("accepts only an authenticated local date and returns a strict safe result", async () => {
    syncActivities.mockResolvedValue({
      provider: "garmin",
      date: "2026-07-24",
      sync: {
        cached: false,
        created: 1,
        changed: 0,
        unchanged: 0,
        recordCount: 1,
        syncedAt: "2026-07-24T02:00:00.000Z",
      },
      connection: {
        provider: "garmin",
        state: "connected",
        verifiedAt: "2026-07-24T02:00:00.000Z",
        updatedAt: "2026-07-24T02:00:00.000Z",
        lastErrorCode: null,
      },
    });

    const response = await POST(request({ date: "2026-07-24" }), { params });
    expect(response.status).toBe(200);
    expect(syncActivities).toHaveBeenCalledWith({
      trackerKey: "anonymous-tracker",
      date: "2026-07-24",
    });
    expect(await response.json()).toMatchObject({
      provider: "garmin",
      sync: { recordCount: 1 },
    });
  });

  it("does not expose Provider errors and never invokes sync while unauthenticated", async () => {
    getAuthorizedSession.mockResolvedValueOnce(null);
    const unauthorized = await POST(request({ date: "2026-07-24" }), {
      params,
    });
    expect(unauthorized.status).toBe(401);
    expect(syncActivities).not.toHaveBeenCalled();

    syncActivities.mockRejectedValueOnce(
      new GarminProviderError("provider_unavailable", {
        cause: new Error("anonymous upstream detail"),
      }),
    );
    const failed = await POST(request({ date: "2026-07-24" }), { params });
    expect(failed.status).toBe(503);
    const body = await failed.json();
    expect(body).toEqual({ error: "provider_unavailable" });
    expect(JSON.stringify(body)).not.toContain("upstream detail");
  });
});
