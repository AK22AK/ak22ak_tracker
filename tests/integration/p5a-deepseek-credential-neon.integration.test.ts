import { randomBytes, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/db/client";
import { trackers } from "@/server/db/schema";
import { createDeepSeekCredentialRuntime } from "@/server/integrations/ai/credential-runtime";
import { PlanAdvisorError } from "@/server/integrations/ai/errors";
import {
  readIntegrationCredential,
  saveIntegrationCredential,
} from "@/server/integrations/credentials/repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("P5a DeepSeek private credential database boundary", () => {
  const trackerId = randomUUID();
  const trackerKey = `anonymous-${randomUUID()}`;
  const otherTrackerId = randomUUID();
  const otherTrackerKey = `anonymous-${randomUUID()}`;
  const runtimeConfiguration = {
    endpoint: "https://api.example.invalid/chat/completions",
    model: "anonymous-model",
    timeoutMs: 1_000,
    maxTokens: 1_024,
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY =
      randomBytes(32).toString("base64");
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY_VERSION = "1";
    await getDatabase().insert(trackers).values({
      id: trackerId,
      key: trackerKey,
      name: "Anonymous Tracker",
      module: "anonymous",
      startedOn: "2026-07-01",
      planningTimeZone: "Asia/Shanghai",
    });
    await getDatabase().insert(trackers).values({
      id: otherTrackerId,
      key: otherTrackerKey,
      name: "Other Anonymous Tracker",
      module: "anonymous",
      startedOn: "2026-07-01",
      planningTimeZone: "Asia/Shanghai",
    });
    await saveIntegrationCredential({
      trackerId,
      provider: "deepseek",
      plaintext: "anonymous-existing-key",
      verifiedAt: new Date("2026-07-26T08:00:00.000Z"),
    });
  });

  afterAll(async () => {
    if (testDatabaseUrl) {
      await getDatabase().delete(trackers).where(eq(trackers.id, trackerId));
      await getDatabase()
        .delete(trackers)
        .where(eq(trackers.id, otherTrackerId));
    }
    delete process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY;
    delete process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY_VERSION;
  });

  it("keeps the encrypted existing key when validation fails, then replaces it after success", async () => {
    const failedRuntime = createDeepSeekCredentialRuntime({
      readRuntimeConfiguration: () => ({
        status: "configured",
        value: runtimeConfiguration,
      }),
      verifyCredential: async () => {
        throw new PlanAdvisorError("authentication");
      },
    });
    await expect(
      failedRuntime.save({ trackerKey, apiKey: "anonymous-invalid-key" }),
    ).rejects.toMatchObject({ code: "authentication" });
    await expect(
      readIntegrationCredential({ trackerId, provider: "deepseek" }),
    ).resolves.toBe("anonymous-existing-key");

    const successfulRuntime = createDeepSeekCredentialRuntime({
      readRuntimeConfiguration: () => ({
        status: "configured",
        value: runtimeConfiguration,
      }),
      verifyCredential: async () => undefined,
      now: () => new Date("2026-07-26T09:00:00.000Z"),
    });
    const status = await successfulRuntime.save({
      trackerKey,
      apiKey: "anonymous-replacement-key",
    });

    expect(status).toMatchObject({ state: "connected" });
    expect(JSON.stringify(status)).not.toContain("replacement-key");
    await expect(
      readIntegrationCredential({ trackerId, provider: "deepseek" }),
    ).resolves.toBe("anonymous-replacement-key");
  });

  it("persists the strict model per tracker while absent preferences default to Flash", async () => {
    const runtime = createDeepSeekCredentialRuntime({
      readRuntimeConfiguration: () => ({
        status: "configured",
        value: runtimeConfiguration,
      }),
    });

    await expect(runtime.status(trackerKey)).resolves.toMatchObject({
      model: "deepseek-v4-flash",
    });
    await runtime.saveModel({
      trackerKey,
      model: "deepseek-v4-pro",
    });
    await expect(
      createDeepSeekCredentialRuntime({
        readRuntimeConfiguration: () => ({
          status: "configured",
          value: runtimeConfiguration,
        }),
      }).status(trackerKey),
    ).resolves.toMatchObject({ model: "deepseek-v4-pro" });
    await expect(runtime.status(otherTrackerKey)).resolves.toMatchObject({
      model: "deepseek-v4-flash",
      hasCredential: false,
    });
  });
});
