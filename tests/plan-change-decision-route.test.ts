import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthorizedSession, decide, schedule } = vi.hoisted(() => ({
  getAuthorizedSession: vi.fn(),
  decide: vi.fn(),
  schedule: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getAuthorizedSession }));
vi.mock("@/server/integrations/ai/decision-runtime", () => ({
  planChangeDecisionRuntime: { decide },
}));
vi.mock("@/server/mirror/after-response", () => ({
  scheduleGitHubMirrorAfterResponse: schedule,
}));

import { PUT } from "@/app/api/trackers/[trackerKey]/ai-analysis/[proposalId]/decision/route";
import { schemaVersion } from "@/domain/schemas";

const proposalId = "019c1000-0000-7000-8000-000000000501";
const commandId = "019c1000-0000-7000-8000-000000000502";

function request() {
  return new Request("https://anonymous.invalid/api/decision", {
    method: "PUT",
    body: JSON.stringify({
      commandId,
      proposalId: "019c1000-0000-7000-8000-000000000599",
      decision: "rejected",
      occurredAt: "2026-07-24T08:00:00.000Z",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
    }),
  });
}

describe("plan change decision API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthorizedSession.mockResolvedValue({ user: { githubId: "10001" } });
    decide.mockResolvedValue({
      schemaVersion,
      commandId,
      proposalId,
      replayed: false,
      conflict: false,
      status: "rejected",
      appliedPlanVersion: null,
      affectedDates: [],
      page: { schemaVersion, configuration: "configured", job: null },
    });
  });

  it("authenticates before parsing or deciding", async () => {
    getAuthorizedSession.mockResolvedValue(null);
    const response = await PUT(request(), {
      params: Promise.resolve({ trackerKey: "knee-rehab", proposalId }),
    });
    expect(response.status).toBe(401);
    expect(decide).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("uses the authenticated path proposal and schedules only after a saved decision", async () => {
    const response = await PUT(request(), {
      params: Promise.resolve({ trackerKey: "knee-rehab", proposalId }),
    });
    expect(response.status).toBe(200);
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        trackerKey: "knee-rehab",
        proposalId,
        commandId,
        decision: "rejected",
      }),
    );
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("does not schedule mirror consumption when the proposal expires", async () => {
    decide.mockResolvedValue({
      schemaVersion,
      commandId,
      proposalId,
      replayed: false,
      conflict: false,
      status: "expired",
      appliedPlanVersion: null,
      affectedDates: [],
      page: { schemaVersion, configuration: "configured", job: null },
    });
    const response = await PUT(request(), {
      params: Promise.resolve({ trackerKey: "knee-rehab", proposalId }),
    });
    expect(response.status).toBe(200);
    expect(schedule).not.toHaveBeenCalled();
  });
});
