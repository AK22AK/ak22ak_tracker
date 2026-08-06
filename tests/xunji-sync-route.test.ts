import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthorizedSession, syncXunjiCatchUpBatch } = vi.hoisted(() => ({
  getAuthorizedSession: vi.fn(),
  syncXunjiCatchUpBatch: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getAuthorizedSession }));
vi.mock("@/server/integrations/xunji/runtime", () => ({
  syncXunjiCatchUpBatch,
}));

import { POST } from "@/app/api/trackers/[trackerKey]/integrations/[provider]/sync/route";
import { IntegrationOperationInProgressError } from "@/server/integrations/credentials/operation-errors";

function request() {
  return new Request("https://anonymous.invalid/api/sync", { method: "POST" });
}

const params = Promise.resolve({
  trackerKey: "anonymous-tracker",
  provider: "xunji",
});

describe("Xunji sync route safety boundary", () => {
  beforeEach(() => {
    getAuthorizedSession.mockReset();
    syncXunjiCatchUpBatch.mockReset();
    getAuthorizedSession.mockResolvedValue({ user: { id: "anonymous-user" } });
  });

  it("returns a safe retryAfterMs on a real rate-limited failed day", async () => {
    syncXunjiCatchUpBatch.mockResolvedValue({
      provider: "xunji",
      batch: { from: "2026-08-05", to: "2026-08-05" },
      targetDate: "2026-08-06",
      days: [
        {
          date: "2026-08-05",
          status: "failed",
          errorCode: "rate_limited",
          retryAfterMs: 30_000,
        },
      ],
      summary: {
        succeeded: 0,
        failed: 1,
        created: 0,
        changed: 0,
        unchanged: 0,
      },
      nextCursor: "2026-08-05",
      complete: false,
      lastSucceededDate: "2026-08-04",
    });

    const response = await POST(request(), { params });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      days: [
        {
          status: "failed",
          errorCode: "rate_limited",
          retryAfterMs: 30_000,
        },
      ],
      lastSucceededDate: "2026-08-04",
    });
  });

  it("returns canonical 409 without exposing Provider details when the lease is busy", async () => {
    syncXunjiCatchUpBatch.mockRejectedValue(
      new IntegrationOperationInProgressError(),
    );

    const response = await POST(request(), { params });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "sync_in_progress" });
  });
});
