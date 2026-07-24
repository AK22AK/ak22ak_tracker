import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthorizedSession, getTrendsAggregate } = vi.hoisted(() => ({
  getAuthorizedSession: vi.fn(),
  getTrendsAggregate: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getAuthorizedSession }));
vi.mock("@/server/trends/aggregate", () => ({
  AggregateTrackerNotFoundError: class AggregateTrackerNotFoundError extends Error {},
  getTrendsAggregate,
}));

import { GET } from "@/app/api/trackers/[trackerKey]/trends/route";

describe("P4a-1 trends API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthorizedSession.mockResolvedValue({ user: { githubId: "10001" } });
    getTrendsAggregate.mockResolvedValue({ trackerKey: "knee-rehab" });
  });

  it("authenticates before reading trends", async () => {
    getAuthorizedSession.mockResolvedValueOnce(null);

    const response = await GET(
      new Request("https://anonymous.invalid/api/trends"),
      { params: Promise.resolve({ trackerKey: "knee-rehab" }) },
    );

    expect(response.status).toBe(401);
    expect(getTrendsAggregate).not.toHaveBeenCalled();
  });

  it("does not let client query parameters expand the fixed server range", async () => {
    const response = await GET(
      new Request(
        "https://anonymous.invalid/api/trends?start=2000-01-01&weeks=999",
      ),
      { params: Promise.resolve({ trackerKey: "knee-rehab" }) },
    );

    expect(response.status).toBe(200);
    expect(getTrendsAggregate).toHaveBeenCalledWith({
      trackerKey: "knee-rehab",
    });
  });
});
