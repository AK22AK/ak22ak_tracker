import { describe, expect, it, vi } from "vitest";

import { PlanAdvisorError } from "@/server/integrations/ai/errors";
import { createDeepSeekCredentialRuntime } from "@/server/integrations/ai/credential-runtime";
import { IntegrationCredentialNotFoundError } from "@/server/integrations/credentials/repository";

const runtimeConfiguration = {
  endpoint: "https://api.example.invalid/chat/completions",
  timeoutMs: 1_000,
  maxTokens: 1_024,
};
const defaultPreferenceDependencies = {
  requireTracker: async () => ({ id: "anonymous-tracker-id" }),
  readPreference: async () => null,
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
  it("defaults existing trackers to Flash and persists only the two allowed models", async () => {
    let selected: "deepseek-v4-flash" | "deepseek-v4-pro" | null = null;
    const verifyCredential = vi.fn();
    const savePreference = vi.fn(async (input) => {
      selected = input.document.settings.model;
    });
    const runtime = createDeepSeekCredentialRuntime({
      ...defaultPreferenceDependencies,
      readRuntimeConfiguration: () => ({
        status: "configured",
        value: runtimeConfiguration,
      }),
      requireTracker: async () => ({ id: "anonymous-tracker-id" }),
      getStoredStatus: async () => storedStatus(true),
      readPreference: async () =>
        selected
          ? {
              schemaVersion: "1.0.0",
              provider: "deepseek",
              settings: { model: selected },
            }
          : null,
      savePreference,
      verifyCredential,
    });

    await expect(runtime.status("knee-rehab")).resolves.toMatchObject({
      model: "deepseek-v4-flash",
    });
    await expect(
      runtime.saveModel({
        trackerKey: "knee-rehab",
        model: "deepseek-v4-pro",
      }),
    ).resolves.toMatchObject({ model: "deepseek-v4-pro" });
    expect(savePreference).toHaveBeenCalledOnce();
    expect(verifyCredential).not.toHaveBeenCalled();
  });

  it("validates a candidate before replacing the encrypted credential and never returns it", async () => {
    let connected = false;
    const order: string[] = [];
    const saveCredential = vi.fn(async () => {
      order.push("save");
      connected = true;
    });
    const runtime = createDeepSeekCredentialRuntime({
      ...defaultPreferenceDependencies,
      readRuntimeConfiguration: () => ({
        status: "configured",
        value: runtimeConfiguration,
      }),
      requireTracker: async () => ({ id: "anonymous-tracker-id" }),
      getStoredStatus: async () => storedStatus(connected),
      verifyCredential: async (configuration) => {
        order.push("verify");
        expect(configuration.apiKey).toBe("anonymous-candidate-key");
        expect(configuration.model).toBe("deepseek-v4-flash");
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
      ...defaultPreferenceDependencies,
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
      ...defaultPreferenceDependencies,
      readRuntimeConfiguration: () => ({
        status: "configured",
        value: runtimeConfiguration,
      }),
      requireTracker: async () => ({ id: "anonymous-tracker-id" }),
      readCredential,
      readPreference: async () => ({
        schemaVersion: "1.0.0",
        provider: "deepseek",
        settings: { model: "deepseek-v4-pro" },
      }),
    });

    await expect(runtime.resolveConfiguration("knee-rehab")).resolves.toEqual({
      status: "configured",
      value: {
        ...runtimeConfiguration,
        model: "deepseek-v4-pro",
        apiKey: "anonymous-stored-key",
      },
    });
    expect(readCredential).toHaveBeenCalledWith({
      trackerId: "anonymous-tracker-id",
      provider: "deepseek",
    });
  });

  it("does not configure PlanAdvisor or call a provider without a saved key", async () => {
    const runtime = createDeepSeekCredentialRuntime({
      ...defaultPreferenceDependencies,
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
      model: "deepseek-v4-flash",
    });
  });

  it("tests the encrypted key and selected model without creating analysis state", async () => {
    const testConnection = vi.fn().mockResolvedValue({
      schemaVersion: "1.0.0",
      model: "deepseek-v4-pro",
      reply: "连接正常",
    });
    const runtime = createDeepSeekCredentialRuntime({
      ...defaultPreferenceDependencies,
      readRuntimeConfiguration: () => ({
        status: "configured",
        value: runtimeConfiguration,
      }),
      requireTracker: async () => ({ id: "anonymous-tracker-id" }),
      readCredential: async () => "anonymous-stored-key",
      readPreference: async () => ({
        schemaVersion: "1.0.0",
        provider: "deepseek",
        settings: { model: "deepseek-v4-pro" },
      }),
      testConnection,
      markSuccess: vi.fn().mockResolvedValue(undefined),
    });

    await expect(runtime.test("knee-rehab")).resolves.toMatchObject({
      model: "deepseek-v4-pro",
      reply: "连接正常",
    });
    expect(testConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "deepseek-v4-pro",
        apiKey: "anonymous-stored-key",
      }),
    );
  });

  it.each([
    ["authentication", "needs_update"],
    ["rate_limited", "unavailable"],
    ["timeout", "unavailable"],
    ["provider_unavailable", "unavailable"],
    ["invalid_response", "unavailable"],
  ] as const)("maps %s to the safe %s state", async (errorCode, state) => {
    const runtime = createDeepSeekCredentialRuntime({
      ...defaultPreferenceDependencies,
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
