import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthorizedSession, submitResult, scheduleMirror } = vi.hoisted(
  () => ({
    getAuthorizedSession: vi.fn(),
    submitResult: vi.fn(),
    scheduleMirror: vi.fn(),
  }),
);

vi.mock("@/server/auth/session", () => ({ getAuthorizedSession }));
vi.mock("@/server/evaluation/repository", () => ({
  evaluationRuntime: { submitResult },
}));
vi.mock("@/server/mirror/after-response", () => ({
  scheduleGitHubMirrorAfterResponse: scheduleMirror,
}));

import { POST } from "@/app/api/trackers/[trackerKey]/evaluation/[sessionId]/result/route";

const params = {
  params: Promise.resolve({
    trackerKey: "anonymous-tracker",
    sessionId: "019c0000-0000-7000-8000-000000000841",
  }),
};

const command = {
  commandId: "019c0000-0000-7000-8000-000000000842",
  sessionId: "019c0000-0000-7000-8000-000000000841",
  occurredAt: "2026-06-09T09:00:00.000Z",
  occurredTimeZone: "Asia/Shanghai",
  occurredUtcOffsetMinutes: 480,
  answers: {
    goalCompletion: "partially_met",
    sides: {
      left: {
        symptomResponse: "mild",
        strengthAndControl: "ready",
        loadTolerance: "limited",
      },
      right: {
        symptomResponse: "none",
        strengthAndControl: "ready",
        loadTolerance: "ready",
      },
    },
    nextStageIntent: "undecided",
  },
};

describe("P4c-2a evaluation result route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthorizedSession.mockResolvedValue({ user: { githubId: "10001" } });
    submitResult.mockResolvedValue({ state: "opened", result: {} });
  });

  it("authenticates before parsing or writing a result", async () => {
    getAuthorizedSession.mockResolvedValue(null);
    const response = await POST(
      new Request("https://anonymous.invalid/api/evaluation/result", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      params,
    );

    expect(response.status).toBe(401);
    expect(submitResult).not.toHaveBeenCalled();
  });

  it("binds the path session and schedules mirroring only after success", async () => {
    const response = await POST(
      new Request("https://anonymous.invalid/api/evaluation/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      }),
      params,
    );

    expect(response.status).toBe(200);
    expect(submitResult).toHaveBeenCalledWith("anonymous-tracker", command);
    expect(scheduleMirror).toHaveBeenCalledTimes(1);
  });

  it("rejects a body that targets a different session", async () => {
    const response = await POST(
      new Request("https://anonymous.invalid/api/evaluation/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...command,
          sessionId: "019c0000-0000-7000-8000-000000000843",
        }),
      }),
      params,
    );

    expect(response.status).toBe(400);
    expect(submitResult).not.toHaveBeenCalled();
    expect(scheduleMirror).not.toHaveBeenCalled();
  });
});
