import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthorizedSession, getProviderHistoryOverview } = vi.hoisted(() => ({
  getAuthorizedSession: vi.fn(),
  getProviderHistoryOverview: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getAuthorizedSession }));
vi.mock("@/server/integrations/core/history-sync-overview", () => ({
  getProviderHistoryOverview,
}));

import { GET } from "@/app/api/trackers/[trackerKey]/integrations/history-sync/route";
import { IntegrationTrackerNotFoundError } from "@/server/integrations/credentials/repository";

const request = new Request("https://anonymous.invalid/history-sync");
const params = Promise.resolve({ trackerKey: "anonymous-tracker" });

describe("provider history overview route", () => {
  beforeEach(() => {
    getAuthorizedSession.mockReset();
    getProviderHistoryOverview.mockReset();
    getAuthorizedSession.mockResolvedValue({ user: { githubId: "10001" } });
  });

  it("authenticates before reading persisted history and prevents response caching", async () => {
    getAuthorizedSession.mockResolvedValueOnce(null);
    const unauthorized = await GET(request, { params });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("cache-control")).toBe("no-store");
    expect(getProviderHistoryOverview).not.toHaveBeenCalled();

    getProviderHistoryOverview.mockResolvedValue({
      schemaVersion: "1.0.0",
      range: null,
      updatedAt: null,
      scopes: [],
      recordDates: [],
    });
    const response = await GET(request, { params });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(getProviderHistoryOverview).toHaveBeenCalledWith(
      "anonymous-tracker",
    );
  });

  it("classifies missing trackers and unexpected failures without raw errors", async () => {
    getProviderHistoryOverview.mockRejectedValueOnce(
      new IntegrationTrackerNotFoundError(),
    );
    const missing = await GET(request, { params });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "tracker_not_found" });

    getProviderHistoryOverview.mockRejectedValueOnce(
      new Error("anonymous database detail"),
    );
    const failed = await GET(request, { params });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "history_sync_unavailable" });
  });
});
