import "server-only";

import {
  aiAnalysisErrorCodeSchema,
  type AiAnalysisErrorCode,
} from "@/domain/ai-analysis";
import {
  defaultDeepSeekModel,
  deepSeekConnectionStatusSchema,
  deepSeekModelSchema,
  type DeepSeekConnectionStatus,
  type DeepSeekModel,
} from "@/domain/deepseek";
import type { IntegrationPreferenceDocument } from "@/domain/integration-preferences";
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
  readIntegrationPreference,
  saveIntegrationPreference,
} from "@/server/integrations/preferences/repository";

import {
  createDeepSeekConfiguration,
  readDeepSeekRuntimeConfiguration,
} from "./config";
import { testDeepSeekConnection, verifyDeepSeekCredential } from "./deepseek";
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
  testConnection?: typeof testDeepSeekConnection;
  readPreference?: (input: {
    trackerId: string;
    provider: string;
  }) => Promise<IntegrationPreferenceDocument | null>;
  savePreference?: (input: {
    trackerId: string;
    document: IntegrationPreferenceDocument;
    now: Date;
  }) => Promise<void>;
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
  model: DeepSeekModel,
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
    model,
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
  testConnection = testDeepSeekConnection,
  readPreference = readIntegrationPreference,
  savePreference = saveIntegrationPreference,
  saveCredential = saveIntegrationCredentialAndResetState,
  markFailure = markIntegrationConnectionFailure,
  markSuccess = markIntegrationConnectionSuccess,
  now = () => new Date(),
}: CredentialRuntimeDependencies = {}) {
  async function selectedModel(trackerId: string) {
    const preference = await readPreference({
      trackerId,
      provider: "deepseek",
    });
    return preference?.provider === "deepseek"
      ? preference.settings.model
      : defaultDeepSeekModel;
  }

  async function status(trackerKey: string) {
    const [configuration, stored, tracker] = await Promise.all([
      readRuntimeConfiguration(),
      getStoredStatus(trackerKey, "deepseek"),
      requireTracker(trackerKey),
    ]);
    return publicStatus(configuration, stored, await selectedModel(tracker.id));
  }

  async function save(input: { trackerKey: string; apiKey: string }) {
    const configuration = readRuntimeConfiguration();
    if (configuration.status !== "configured") {
      throw new PlanAdvisorError(configuration.status);
    }
    const tracker = await requireTracker(input.trackerKey);
    const attemptedAt = now();
    const model = await selectedModel(tracker.id);
    await verifyCredential(
      createDeepSeekConfiguration(configuration.value, input.apiKey, model),
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

  async function saveModel(input: {
    trackerKey: string;
    model: DeepSeekModel;
  }) {
    const model = deepSeekModelSchema.parse(input.model);
    const tracker = await requireTracker(input.trackerKey);
    await savePreference({
      trackerId: tracker.id,
      document: {
        schemaVersion,
        provider: "deepseek",
        settings: { model },
      },
      now: now(),
    });
    return status(input.trackerKey);
  }

  async function resolveConfiguration(trackerKey: string) {
    const runtime = readRuntimeConfiguration();
    const tracker = await requireTracker(trackerKey);
    const model = await selectedModel(tracker.id);
    if (runtime.status !== "configured") return { ...runtime, model };
    try {
      const apiKey = await readCredential({
        trackerId: tracker.id,
        provider: "deepseek",
      });
      return {
        status: "configured" as const,
        value: createDeepSeekConfiguration(runtime.value, apiKey, model),
      };
    } catch (error) {
      if (error instanceof IntegrationCredentialNotFoundError) {
        return { status: "not_configured" as const, model };
      }
      throw error;
    }
  }

  async function test(trackerKey: string) {
    const configuration = await resolveConfiguration(trackerKey);
    if (configuration.status !== "configured") {
      throw new PlanAdvisorError(configuration.status);
    }
    const testedAt = now();
    try {
      const result = await testConnection(configuration.value);
      await recordSuccess({ trackerKey, succeededAt: testedAt });
      return result;
    } catch (error) {
      const errorCode =
        error instanceof PlanAdvisorError
          ? error.code
          : ("provider_unavailable" as const);
      await recordFailure({ trackerKey, errorCode, failedAt: testedAt }).catch(
        () => undefined,
      );
      if (error instanceof PlanAdvisorError) throw error;
      throw new PlanAdvisorError(errorCode, { cause: error });
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

  return {
    status,
    save,
    saveModel,
    test,
    resolveConfiguration,
    recordFailure,
    recordSuccess,
  };
}

export const deepSeekCredentialRuntime = createDeepSeekCredentialRuntime();
