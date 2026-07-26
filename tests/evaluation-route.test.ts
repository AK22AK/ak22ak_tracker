import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthorizedSession, load, create, scheduleMirror } = vi.hoisted(
  () => ({
    getAuthorizedSession: vi.fn(),
    load: vi.fn(),
    create: vi.fn(),
    scheduleMirror: vi.fn(),
  }),
);

vi.mock("@/server/auth/session", () => ({ getAuthorizedSession }));
vi.mock("@/server/evaluation/repository", () => ({
  evaluationRuntime: { load, create },
}));
vi.mock("@/server/mirror/after-response", () => ({
  scheduleGitHubMirrorAfterResponse: scheduleMirror,
}));

import { GET, POST } from "@/app/api/trackers/[trackerKey]/evaluation/route";

const params = { params: Promise.resolve({ trackerKey: "anonymous-tracker" }) };

describe("P4c-1 evaluation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthorizedSession.mockResolvedValue({ user: { githubId: "10001" } });
    load.mockResolvedValue({ state: "eligible" });
    create.mockResolvedValue({ state: "opened" });
  });

  it("authenticates before reading or creating a session", async () => {
    getAuthorizedSession.mockResolvedValue(null);
    const getResponse = await GET(
      new Request("https://anonymous.invalid/api/evaluation"),
      params,
    );
    const postResponse = await POST(
      new Request("https://anonymous.invalid/api/evaluation", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      params,
    );
    expect(getResponse.status).toBe(401);
    expect(postResponse.status).toBe(401);
    expect(load).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("validates stable command metadata and schedules mirror only after success", async () => {
    const invalid = await POST(
      new Request("https://anonymous.invalid/api/evaluation", {
        method: "POST",
        body: JSON.stringify({ commandId: "unstable" }),
      }),
      params,
    );
    expect(invalid.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
    expect(scheduleMirror).not.toHaveBeenCalled();

    const command = {
      commandId: "019c0000-0000-7000-8000-000000000831",
      kind: "final",
      occurredAt: "2026-06-09T08:00:00.000Z",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
    };
    const created = await POST(
      new Request("https://anonymous.invalid/api/evaluation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      }),
      params,
    );
    expect(created.status).toBe(200);
    expect(create).toHaveBeenCalledWith("anonymous-tracker", command);
    expect(scheduleMirror).toHaveBeenCalledTimes(1);
  });
});
