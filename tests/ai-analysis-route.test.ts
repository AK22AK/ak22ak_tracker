import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthorizedSession, load, request } = vi.hoisted(() => ({
  getAuthorizedSession: vi.fn(),
  load: vi.fn(),
  request: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getAuthorizedSession }));
vi.mock("@/server/integrations/ai/runtime", () => ({
  aiAnalysisRuntime: { load, request },
}));

import { GET, POST } from "@/app/api/trackers/[trackerKey]/ai-analysis/route";

describe("AI analysis API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthorizedSession.mockResolvedValue({ user: { githubId: "10001" } });
    load.mockResolvedValue({
      schemaVersion: "1.0.0",
      configuration: "configured",
      job: null,
    });
    request.mockResolvedValue({
      schemaVersion: "1.0.0",
      configuration: "configured",
      job: null,
    });
  });

  it("authenticates before loading or starting analysis", async () => {
    getAuthorizedSession.mockResolvedValue(null);
    const params = { params: Promise.resolve({ trackerKey: "knee-rehab" }) };
    const getResponse = await GET(
      new Request("https://anonymous.invalid/api/ai-analysis"),
      params,
    );
    const postResponse = await POST(
      new Request("https://anonymous.invalid/api/ai-analysis", {
        method: "POST",
        body: JSON.stringify({ commandId: crypto.randomUUID() }),
      }),
      params,
    );
    expect(getResponse.status).toBe(401);
    expect(postResponse.status).toBe(401);
    expect(load).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects an unstable command id before the runtime", async () => {
    const response = await POST(
      new Request("https://anonymous.invalid/api/ai-analysis", {
        method: "POST",
        body: JSON.stringify({ commandId: "unstable" }),
      }),
      { params: Promise.resolve({ trackerKey: "knee-rehab" }) },
    );
    expect(response.status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });

  it("passes only the authenticated tracker and validated command", async () => {
    const commandId = "019c1000-0000-7000-8000-000000000301";
    const response = await POST(
      new Request("https://anonymous.invalid/api/ai-analysis", {
        method: "POST",
        body: JSON.stringify({ commandId }),
      }),
      { params: Promise.resolve({ trackerKey: "knee-rehab" }) },
    );
    expect(response.status).toBe(200);
    expect(request).toHaveBeenCalledWith({
      trackerKey: "knee-rehab",
      commandId,
    });
  });
});
