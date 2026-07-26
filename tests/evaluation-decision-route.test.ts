import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthorizedSession, submitDecision, scheduleMirror } = vi.hoisted(
  () => ({
    getAuthorizedSession: vi.fn(),
    submitDecision: vi.fn(),
    scheduleMirror: vi.fn(),
  }),
);

vi.mock("@/server/auth/session", () => ({ getAuthorizedSession }));
vi.mock("@/server/evaluation/repository", () => ({
  evaluationRuntime: { submitDecision },
}));
vi.mock("@/server/mirror/after-response", () => ({
  scheduleGitHubMirrorAfterResponse: scheduleMirror,
}));

import { POST } from "@/app/api/trackers/[trackerKey]/evaluation/[sessionId]/decision/route";

const sessionId = "019c0000-0000-7000-8000-000000000851";
const params = {
  params: Promise.resolve({ trackerKey: "anonymous-tracker", sessionId }),
};
const command = {
  commandId: "019c0000-0000-7000-8000-000000000852",
  sessionId,
  occurredAt: "2026-06-09T10:00:00.000Z",
  occurredTimeZone: "Asia/Shanghai",
  occurredUtcOffsetMinutes: 480,
  decision: {
    weeklyConfirmations: [
      {
        weekStart: "2026-06-01",
        weekEnd: "2026-06-07",
        status: "effective",
      },
    ],
    branch: "maintain",
  },
};

describe("P4c-2b evaluation decision route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthorizedSession.mockResolvedValue({ user: { githubId: "10001" } });
    submitDecision.mockResolvedValue({ state: "opened", decision: {} });
  });

  it("authenticates before parsing or writing a decision", async () => {
    getAuthorizedSession.mockResolvedValue(null);
    const response = await POST(
      new Request("https://anonymous.invalid/api/evaluation/decision", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      params,
    );
    expect(response.status).toBe(401);
    expect(submitDecision).not.toHaveBeenCalled();
  });

  it("binds the path session and schedules mirroring only after success", async () => {
    const response = await POST(
      new Request("https://anonymous.invalid/api/evaluation/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      }),
      params,
    );
    expect(response.status).toBe(200);
    expect(submitDecision).toHaveBeenCalledWith("anonymous-tracker", command);
    expect(scheduleMirror).toHaveBeenCalledTimes(1);
  });

  it("rejects a body that targets a different session", async () => {
    const response = await POST(
      new Request("https://anonymous.invalid/api/evaluation/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...command,
          sessionId: "019c0000-0000-7000-8000-000000000853",
        }),
      }),
      params,
    );
    expect(response.status).toBe(400);
    expect(submitDecision).not.toHaveBeenCalled();
  });
});
