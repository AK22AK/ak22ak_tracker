import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthorizedSession, rollback, schedule } = vi.hoisted(() => ({
  getAuthorizedSession: vi.fn(),
  rollback: vi.fn(),
  schedule: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getAuthorizedSession }));
vi.mock("@/server/integrations/ai/rollback-runtime", () => ({
  planVersionRollbackRuntime: { rollback },
}));
vi.mock("@/server/mirror/after-response", () => ({
  scheduleGitHubMirrorAfterResponse: schedule,
}));

import { PUT } from "@/app/api/trackers/[trackerKey]/ai-analysis/[proposalId]/rollback/route";
import { schemaVersion } from "@/domain/schemas";

const proposalId = "019c2000-0000-7000-8000-000000000101";
const commandId = "019c2000-0000-7000-8000-000000000102";

function request() {
  return new Request("https://anonymous.invalid/api/rollback", {
    method: "PUT",
    body: JSON.stringify({
      commandId,
      proposalId: "019c2000-0000-7000-8000-000000000199",
      occurredAt: "2026-07-24T08:00:00.000Z",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
    }),
  });
}

describe("plan version rollback API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthorizedSession.mockResolvedValue({ user: { githubId: "10001" } });
    rollback.mockResolvedValue({
      schemaVersion,
      commandId,
      proposalId,
      replayed: false,
      conflict: false,
      status: "rolled_back",
      blockedReason: null,
      newPlanVersion: {
        id: "019c2000-0000-7000-8000-000000000103",
        version: 3,
        effectiveFrom: "2026-07-25",
      },
      affectedDates: ["2026-07-26"],
      page: { schemaVersion, configuration: "configured", job: null },
    });
  });

  it("authenticates before parsing or rolling back", async () => {
    getAuthorizedSession.mockResolvedValue(null);
    const response = await PUT(request(), {
      params: Promise.resolve({ trackerKey: "knee-rehab", proposalId }),
    });
    expect(response.status).toBe(401);
    expect(rollback).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("uses the path proposal and schedules mirroring after a saved rollback", async () => {
    const response = await PUT(request(), {
      params: Promise.resolve({ trackerKey: "knee-rehab", proposalId }),
    });
    expect(response.status).toBe(200);
    expect(rollback).toHaveBeenCalledWith(
      expect.objectContaining({
        trackerKey: "knee-rehab",
        proposalId,
        commandId,
      }),
    );
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("does not schedule mirroring for a blocked rollback", async () => {
    rollback.mockResolvedValue({
      schemaVersion,
      commandId,
      proposalId,
      replayed: false,
      conflict: false,
      status: "blocked",
      blockedReason: "later_plan_version",
      newPlanVersion: null,
      affectedDates: [],
      page: { schemaVersion, configuration: "configured", job: null },
    });
    await PUT(request(), {
      params: Promise.resolve({ trackerKey: "knee-rehab", proposalId }),
    });
    expect(schedule).not.toHaveBeenCalled();
  });
});
