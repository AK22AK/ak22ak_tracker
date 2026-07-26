import { describe, expect, it, vi } from "vitest";

import { PlanAdvisorError } from "@/server/integrations/ai/errors";
import { createDeepSeekCredentialRuntime } from "@/server/integrations/ai/credential-runtime";
import { IntegrationCredentialNotFoundError } from "@/server/integrations/credentials/repository";

const runtimeConfiguration = {
  endpoint: "https://api.example.invalid/chat/completions",
  model: "anonymous-model",
  timeoutMs: 1_000,
  maxTokens: 1_024,
};

function storedStatus(configured = false, lastErrorCode: string | null = null) {
  return {
    provider: "deepseek",
    configured,
    maskedKey: configured ? ("••••••••" as const) : null,
    verifiedAt: configured ? "2026-07-26T08:00:00.000Z" : null,
    updatedAt: configured ? "2026-07-26T08:00:00.000Z" : null,
    sync: {
      status: lastErrorCode ? ("failed" as const) : ("idle" as const),
      lastAttemptAt: null,
      lastSucceededAt: null,
      lastSucceededDate: null,
      nextCursor: null,
      lastErrorCode,
    },
  };
}

describe("DeepSeek private credential runtime", () => {
  it("validates a candidate before replacing the encrypted credential and never returns it", async () => {
    let connected = false;
    const order: string[] = [];
    const saveCredential = vi.fn(async () => {
      order.push("save");
      connected = true;
    });
    const runtime = createDeepSeekCredentialRuntime({
      readRuntimeConfiguration: () => ({
        status: "configured",
        value: runtimeConfiguration,
      }),
      requireTracker: async () => ({ id: "anonymous-tracker-id" }),
      getStoredStatus: async () => storedStatus(connected),
      verifyCredential: async (configuration) => {
        order.push("verify");
        expect(configuration.apiKey).toBe("anonymous-candidate-key");
      },
      saveCredential,
      now: () => new Date("2026-07-26T08:00:00.000Z"),
    });

    const result = await runtime.save({
      trackerKey: "knee-rehab",
      apiKey: "anonymous-candidate-key",
    });

    expect(order).toEqual(["verify", "save"]);
    expect(saveCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        trackerId: "anonymous-tracker-id",
        provider: "deepseek",
        plaintext: "anonymous-candidate-key",
      }),
    );
    expect(result).toMatchObject({ provider: "deepseek", state: "connected" });
    expect(JSON.stringify(result)).not.toContain("anonymous-candidate-key");
    expect(JSON.stringify(result)).not.toContain("ciphertext");
  });

  it("keeps the old usable credential when candidate validation fails", async () => {
    const saveCredential = vi.fn();
    const runtime = createDeepSeekCredentialRuntime({
      readRuntimeConfiguration: () => ({
        status: "configured",
        value: runtimeConfiguration,
      }),
      requireTracker: async () => ({ id: "anonymous-tracker-id" }),
      getStoredStatus: async () => storedStatus(true),
      verifyCredential: async () => {
        throw new PlanAdvisorError("authentication");
      },
      saveCredential,
    });

    await expect(
      runtime.save({ trackerKey: "knee-rehab", apiKey: "invalid-candidate" }),
    ).rejects.toMatchObject({ code: "authentication" });
    expect(saveCredential).not.toHaveBeenCalled();
    await expect(runtime.status("knee-rehab")).resolves.toMatchObject({
      state: "connected",
    });
  });

  it("builds the PlanAdvisor configuration from the encrypted stored key", async () => {
    const readCredential = vi.fn().mockResolvedValue("anonymous-stored-key");
    const runtime = createDeepSeekCredentialRuntime({
      readRuntimeConfiguration: () => ({
        status: "configured",
        value: runtimeConfiguration,
      }),
      requireTracker: async () => ({ id: "anonymous-tracker-id" }),
      readCredential,
    });

    await expect(runtime.resolveConfiguration("knee-rehab")).resolves.toEqual({
      status: "configured",
      value: { ...runtimeConfiguration, apiKey: "anonymous-stored-key" },
    });
    expect(readCredential).toHaveBeenCalledWith({
      trackerId: "anonymous-tracker-id",
      provider: "deepseek",
    });
  });

  it("does not configure PlanAdvisor or call a provider without a saved key", async () => {
    const runtime = createDeepSeekCredentialRuntime({
      readRuntimeConfiguration: () => ({
        status: "configured",
        value: runtimeConfiguration,
      }),
      requireTracker: async () => ({ id: "anonymous-tracker-id" }),
      readCredential: async () => {
        throw new IntegrationCredentialNotFoundError();
      },
    });

    await expect(runtime.resolveConfiguration("knee-rehab")).resolves.toEqual({
      status: "not_configured",
    });
  });

  it.each([
    ["authentication", "needs_update"],
    ["rate_limited", "unavailable"],
    ["timeout", "unavailable"],
    ["provider_unavailable", "unavailable"],
    ["invalid_response", "unavailable"],
  ] as const)("maps %s to the safe %s state", async (errorCode, state) => {
    const runtime = createDeepSeekCredentialRuntime({
      readRuntimeConfiguration: () => ({
        status: "configured",
        value: runtimeConfiguration,
      }),
      getStoredStatus: async () => storedStatus(true, errorCode),
    });

    await expect(runtime.status("knee-rehab")).resolves.toMatchObject({
      state,
      lastErrorCode: errorCode,
    });
  });
});
