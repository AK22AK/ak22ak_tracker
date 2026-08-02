import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthorizedSession, getTodayAggregate } = vi.hoisted(() => ({
  getAuthorizedSession: vi.fn(),
  getTodayAggregate: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getAuthorizedSession }));
vi.mock("@/server/aggregates/tracker", () => ({
  AggregateTrackerNotFoundError: class extends Error {},
  getTodayAggregate,
}));

import { GET } from "@/app/api/trackers/[trackerKey]/today/route";

describe("Today startup Server-Timing", () => {
  beforeEach(() => {
    getAuthorizedSession.mockReset();
    getTodayAggregate.mockReset();
    getAuthorizedSession.mockResolvedValue({
      user: { githubId: "private-user-10001" },
    });
    getTodayAggregate.mockResolvedValue({
      privateRule: "never-expose-this-rule",
      credential: "never-expose-this-credential",
    });
  });

  it("reports only fixed phase names and durations", async () => {
    const response = await GET(
      new Request(
        "https://anonymous.invalid/api/trackers/private-tracker/today?date=2026-08-02",
      ),
      { params: Promise.resolve({ trackerKey: "private-tracker" }) },
    );

    expect(response.status).toBe(200);
    const timing = response.headers.get("Server-Timing");
    expect(timing).toMatch(
      /^ak_auth;dur=\d+\.\d, ak_today;dur=\d+\.\d, ak_total;dur=\d+\.\d$/,
    );
    expect(timing).not.toMatch(
      /private|tracker|10001|rule|credential|2026-08-02/i,
    );
  });
});
