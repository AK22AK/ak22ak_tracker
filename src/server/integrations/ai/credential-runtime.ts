import "server-only";

import {
  aiAnalysisErrorCodeSchema,
  type AiAnalysisErrorCode,
} from "@/domain/ai-analysis";
import {
  deepSeekConnectionStatusSchema,
  type DeepSeekConnectionStatus,
} from "@/domain/deepseek";
import { schemaVersion } from "@/domain/schemas";
import {
  getIntegrationStatus,
  IntegrationCredentialNotFoundError,
  markIntegrationConnectionFailure,
  markIntegrationConnectionSuccess,
  readIntegrationCredential,
  requireIntegrationTracker,
  saveIntegrationCredentialAndResetState,
} from "@/server/integrations/credentials/repository";

import {
  createDeepSeekConfiguration,
  readDeepSeekRuntimeConfiguration,
} from "./config";
import { verifyDeepSeekCredential } from "./deepseek";
import { PlanAdvisorError } from "./errors";

type RuntimeConfigurationResult = ReturnType<
  typeof readDeepSeekRuntimeConfiguration
>;

type StoredCredentialStatus = {
  configured: boolean;
  verifiedAt: string | null;
  updatedAt: string | null;
  sync: { lastErrorCode: string | null };
};

type CredentialRuntimeDependencies = {
  readRuntimeConfiguration?: typeof readDeepSeekRuntimeConfiguration;
  requireTracker?: (trackerKey: string) => Promise<{ id: string }>;
  getStoredStatus?: (
    trackerKey: string,
    provider: string,
  ) => Promise<StoredCredentialStatus>;
  readCredential?: (input: {
    trackerId: string;
    provider: string;
  }) => Promise<string>;
  verifyCredential?: typeof verifyDeepSeekCredential;
  saveCredential?: (input: {
    trackerId: string;
    provider: string;
    plaintext: string;
    verifiedAt: Date | null;
    attemptedAt: Date | null;
    now: Date;
  }) => Promise<void>;
  markFailure?: (input: {
    trackerId: string;
    provider: string;
    failedAt: Date;
    errorCode: string;
  }) => Promise<void>;
  markSuccess?: (input: {
    trackerId: string;
    provider: string;
    succeededAt: Date;
  }) => Promise<void>;
  now?: () => Date;
};

function safeErrorCode(value: string | null): AiAnalysisErrorCode | null {
  const parsed = aiAnalysisErrorCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function publicStatus(
  configuration: RuntimeConfigurationResult,
  stored: StoredCredentialStatus,
): DeepSeekConnectionStatus {
  const storedError = safeErrorCode(stored.sync.lastErrorCode);
  const lastErrorCode =
    configuration.status === "configured" ? storedError : configuration.status;
  const state =
    configuration.status !== "configured"
      ? "unavailable"
      : !stored.configured
        ? "not_connected"
        : storedError === "authentication"
          ? "needs_update"
          : storedError
            ? "unavailable"
            : "connected";
  return deepSeekConnectionStatusSchema.parse({
    schemaVersion,
    provider: "deepseek",
    hasCredential: stored.configured,
    state,
    verifiedAt: stored.verifiedAt,
    updatedAt: stored.updatedAt,
    lastErrorCode,
  });
}

export function createDeepSeekCredentialRuntime({
  readRuntimeConfiguration = readDeepSeekRuntimeConfiguration,
  requireTracker = requireIntegrationTracker,
  getStoredStatus = getIntegrationStatus,
  readCredential = readIntegrationCredential,
  verifyCredential = verifyDeepSeekCredential,
  saveCredential = saveIntegrationCredentialAndResetState,
  markFailure = markIntegrationConnectionFailure,
  markSuccess = markIntegrationConnectionSuccess,
  now = () => new Date(),
}: CredentialRuntimeDependencies = {}) {
  async function status(trackerKey: string) {
    const [configuration, stored] = await Promise.all([
      readRuntimeConfiguration(),
      getStoredStatus(trackerKey, "deepseek"),
    ]);
    return publicStatus(configuration, stored);
  }

  async function save(input: { trackerKey: string; apiKey: string }) {
    const configuration = readRuntimeConfiguration();
    if (configuration.status !== "configured") {
      throw new PlanAdvisorError(configuration.status);
    }
    const tracker = await requireTracker(input.trackerKey);
    const attemptedAt = now();
    await verifyCredential(
      createDeepSeekConfiguration(configuration.value, input.apiKey),
    );
    await saveCredential({
      trackerId: tracker.id,
      provider: "deepseek",
      plaintext: input.apiKey,
      verifiedAt: attemptedAt,
      attemptedAt,
      now: attemptedAt,
    });
    return status(input.trackerKey);
  }

  async function resolveConfiguration(trackerKey: string) {
    const runtime = readRuntimeConfiguration();
    if (runtime.status !== "configured") return runtime;
    const tracker = await requireTracker(trackerKey);
    try {
      const apiKey = await readCredential({
        trackerId: tracker.id,
        provider: "deepseek",
      });
      return {
        status: "configured" as const,
        value: createDeepSeekConfiguration(runtime.value, apiKey),
      };
    } catch (error) {
      if (error instanceof IntegrationCredentialNotFoundError) {
        return { status: "not_configured" as const };
      }
      throw error;
    }
  }

  async function recordFailure(input: {
    trackerKey: string;
    errorCode: AiAnalysisErrorCode;
    failedAt: Date;
  }) {
    const tracker = await requireTracker(input.trackerKey);
    await markFailure({
      trackerId: tracker.id,
      provider: "deepseek",
      failedAt: input.failedAt,
      errorCode: input.errorCode,
    });
  }

  async function recordSuccess(input: {
    trackerKey: string;
    succeededAt: Date;
  }) {
    const tracker = await requireTracker(input.trackerKey);
    await markSuccess({
      trackerId: tracker.id,
      provider: "deepseek",
      succeededAt: input.succeededAt,
    });
  }

  return { status, save, resolveConfiguration, recordFailure, recordSuccess };
}

export const deepSeekCredentialRuntime = createDeepSeekCredentialRuntime();
