import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthorizedSession, saveModel } = vi.hoisted(() => ({
  getAuthorizedSession: vi.fn(),
  saveModel: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getAuthorizedSession }));
vi.mock("@/server/integrations/ai/credential-runtime", () => ({
  deepSeekCredentialRuntime: { saveModel },
}));

import { PUT } from "@/app/api/trackers/[trackerKey]/integrations/[provider]/preferences/route";

const params = {
  params: Promise.resolve({ trackerKey: "knee-rehab", provider: "deepseek" }),
};

function request(model: string) {
  return new Request("https://anonymous.invalid", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
}

describe("DeepSeek model preference API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthorizedSession.mockResolvedValue({ user: { githubId: "10001" } });
    saveModel.mockResolvedValue({
      schemaVersion: "1.0.0",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      hasCredential: true,
      state: "connected",
      verifiedAt: null,
      updatedAt: null,
      lastErrorCode: null,
    });
  });

  it("authenticates before reading the strict preference", async () => {
    getAuthorizedSession.mockResolvedValue(null);
    const response = await PUT(request("deepseek-v4-pro"), params);
    expect(response.status).toBe(401);
    expect(saveModel).not.toHaveBeenCalled();
  });

  it.each(["deepseek-v4-flash", "deepseek-v4-pro"])(
    "persists the allowed %s model",
    async (model) => {
      const response = await PUT(request(model), params);
      expect(response.status).toBe(200);
      expect(saveModel).toHaveBeenCalledWith({
        trackerKey: "knee-rehab",
        model,
      });
    },
  );

  it.each(["anonymous-model", "deepseek-v4-pro ", "", "gpt-5"])(
    "rejects unsupported model %j",
    async (model) => {
      const response = await PUT(request(model), params);
      expect(response.status).toBe(400);
      expect(saveModel).not.toHaveBeenCalled();
    },
  );
});
