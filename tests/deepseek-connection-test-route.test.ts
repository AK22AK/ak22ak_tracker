import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthorizedSession, testConnection } = vi.hoisted(() => ({
  getAuthorizedSession: vi.fn(),
  testConnection: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getAuthorizedSession }));
vi.mock("@/server/integrations/ai/credential-runtime", () => ({
  deepSeekCredentialRuntime: { test: testConnection },
}));

import { POST } from "@/app/api/trackers/[trackerKey]/integrations/[provider]/test/route";
import { PlanAdvisorError } from "@/server/integrations/ai/errors";

const params = {
  params: Promise.resolve({ trackerKey: "knee-rehab", provider: "deepseek" }),
};

describe("DeepSeek current model test API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthorizedSession.mockResolvedValue({ user: { githubId: "10001" } });
    testConnection.mockResolvedValue({
      schemaVersion: "1.0.0",
      model: "deepseek-v4-flash",
      reply: "连接正常",
    });
  });

  it("authenticates before loading the encrypted credential", async () => {
    getAuthorizedSession.mockResolvedValue(null);
    const response = await POST(
      new Request("https://anonymous.invalid", { method: "POST" }),
      params,
    );
    expect(response.status).toBe(401);
    expect(testConnection).not.toHaveBeenCalled();
  });

  it("returns the server canonical model and no analysis identifiers", async () => {
    const response = await POST(
      new Request("https://anonymous.invalid", { method: "POST" }),
      params,
    );
    expect(response.status).toBe(200);
    expect(testConnection).toHaveBeenCalledWith("knee-rehab");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      schemaVersion: "1.0.0",
      model: "deepseek-v4-flash",
      reply: "连接正常",
    });
    expect(text).not.toMatch(/job|proposal|outbox|command/i);
  });

  it.each([
    ["authentication", 401],
    ["rate_limited", 429],
    ["timeout", 502],
    ["provider_unavailable", 502],
    ["invalid_response", 502],
  ] as const)("maps %s to a safe response", async (code, status) => {
    testConnection.mockRejectedValue(new PlanAdvisorError(code));
    const response = await POST(
      new Request("https://anonymous.invalid", { method: "POST" }),
      params,
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
  });
});
