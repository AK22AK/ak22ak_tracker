import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthorizedSession, status, save } = vi.hoisted(() => ({
  getAuthorizedSession: vi.fn(),
  status: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({ getAuthorizedSession }));
vi.mock("@/server/integrations/ai/credential-runtime", () => ({
  deepSeekCredentialRuntime: { status, save },
}));

import {
  GET,
  PUT,
} from "@/app/api/trackers/[trackerKey]/integrations/[provider]/credential/route";
import { PlanAdvisorError } from "@/server/integrations/ai/errors";

const connected = {
  schemaVersion: "1.0.0",
  provider: "deepseek",
  hasCredential: true,
  state: "connected",
  verifiedAt: "2026-07-26T08:00:00.000Z",
  updatedAt: "2026-07-26T08:00:00.000Z",
  lastErrorCode: null,
};

const params = {
  params: Promise.resolve({ trackerKey: "knee-rehab", provider: "deepseek" }),
};

describe("DeepSeek credential API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthorizedSession.mockResolvedValue({ user: { githubId: "10001" } });
    status.mockResolvedValue(connected);
    save.mockResolvedValue(connected);
  });

  it("authenticates before reading or saving a private key", async () => {
    getAuthorizedSession.mockResolvedValue(null);
    const getResponse = await GET(
      new Request("https://anonymous.invalid"),
      params,
    );
    const putResponse = await PUT(
      new Request("https://anonymous.invalid", {
        method: "PUT",
        body: JSON.stringify({ apiKey: "anonymous-candidate" }),
      }),
      params,
    );

    expect(getResponse.status).toBe(401);
    expect(putResponse.status).toBe(401);
    expect(status).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("returns only safe status and passes a validated key to the server runtime", async () => {
    const response = await PUT(
      new Request("https://anonymous.invalid", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "anonymous-candidate" }),
      }),
      params,
    );

    expect(response.status).toBe(200);
    expect(save).toHaveBeenCalledWith({
      trackerKey: "knee-rehab",
      apiKey: "anonymous-candidate",
    });
    const body = await response.text();
    expect(body).not.toContain("anonymous-candidate");
    expect(body).not.toContain("maskedKey");
  });

  it.each([
    ["authentication", 401],
    ["rate_limited", 429],
    ["timeout", 502],
    ["provider_unavailable", 502],
    ["invalid_response", 502],
  ] as const)(
    "maps %s without returning provider details",
    async (code, httpStatus) => {
      save.mockRejectedValue(new PlanAdvisorError(code));
      const response = await PUT(
        new Request("https://anonymous.invalid", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: "anonymous-candidate" }),
        }),
        params,
      );
      expect(response.status).toBe(httpStatus);
      expect(await response.json()).toEqual({ error: code });
    },
  );
});
