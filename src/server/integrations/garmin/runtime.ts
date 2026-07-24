import "server-only";

import {
  garminActivityPreviewResponseSchema,
  garminConnectionStatusSchema,
  garminProviderErrorCodeSchema,
  type GarminConnectionStatus,
} from "@/domain/garmin";
import {
  integrationStatusSchema,
  type IntegrationStatus,
} from "@/domain/integrations";
import { localDateInTimeZone } from "@/domain/planning-time";
import { localDateSchema } from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import { getIntegrationEncryptionConfig } from "@/server/integrations/credentials/config";
import {
  getIntegrationStatus,
  markIntegrationConnectionFailure,
  readIntegrationCredential,
  requireIntegrationTracker,
  saveIntegrationCredentialAndResetState,
} from "@/server/integrations/credentials/repository";

import {
  garminCredentialSchema,
  type GarminClient,
  type GarminCredential,
} from "./contracts";
import { GarminProviderError } from "./errors";
import { createGarminPythonRuntimeClient } from "./python-runtime-client";

type Database = ReturnType<typeof getDatabase>;
type Tracker = Awaited<ReturnType<typeof requireIntegrationTracker>>;
type GenericStatus = IntegrationStatus;

export class GarminPreviewDateOutOfRangeError extends Error {
  constructor() {
    super("garmin_preview_date_out_of_range");
    this.name = "GarminPreviewDateOutOfRangeError";
  }
}

export type GarminCredentialStore = {
  requireTracker(trackerKey: string): Promise<Tracker>;
  getStatus(trackerKey: string): Promise<GenericStatus>;
  saveAndReset(input: {
    trackerId: string;
    plaintext: string;
    verifiedAt: Date | null;
    attemptedAt: Date | null;
    now: Date;
  }): Promise<void>;
  read(trackerId: string): Promise<string>;
  markFailure(
    trackerId: string,
    failedAt: Date,
    errorCode: string,
  ): Promise<void>;
};

function createNeonGarminCredentialStore(
  database: Database = getDatabase(),
): GarminCredentialStore {
  return {
    requireTracker: (trackerKey) =>
      requireIntegrationTracker(trackerKey, database),
    getStatus: async (trackerKey) =>
      integrationStatusSchema.parse(
        await getIntegrationStatus(trackerKey, "garmin", database),
      ),
    saveAndReset: ({ trackerId, plaintext, verifiedAt, attemptedAt, now }) =>
      saveIntegrationCredentialAndResetState({
        trackerId,
        provider: "garmin",
        plaintext,
        verifiedAt,
        attemptedAt,
        now,
        database,
      }),
    read: (trackerId) =>
      readIntegrationCredential({
        trackerId,
        provider: "garmin",
        database,
      }),
    markFailure: (trackerId, failedAt, errorCode) =>
      markIntegrationConnectionFailure({
        trackerId,
        provider: "garmin",
        failedAt,
        errorCode,
        database,
      }),
  };
}

function connectionStatus(status: GenericStatus): GarminConnectionStatus {
  const parsedError = garminProviderErrorCodeSchema.safeParse(
    status.sync.lastErrorCode,
  );
  const lastErrorCode = parsedError.success ? parsedError.data : null;
  const state = !status.configured
    ? "not_connected"
    : lastErrorCode === "authentication"
      ? "needs_refresh"
      : lastErrorCode === "invalid_token_bundle" ||
          lastErrorCode === "unsupported_client_version"
        ? "invalid"
        : !status.verifiedAt
          ? "needs_validation"
          : "connected";
  return garminConnectionStatusSchema.parse({
    provider: "garmin",
    state,
    verifiedAt: status.verifiedAt,
    updatedAt: status.updatedAt,
    lastErrorCode,
  });
}

export function createGarminRuntime({
  store,
  client,
  now = () => new Date(),
  assertEncryptionConfigured = () => void getIntegrationEncryptionConfig(),
}: {
  store: GarminCredentialStore;
  client: GarminClient<GarminCredential>;
  now?: () => Date;
  assertEncryptionConfigured?: () => void;
}) {
  return {
    async status(trackerKey: string) {
      return connectionStatus(await store.getStatus(trackerKey));
    },

    async importCredential(input: { trackerKey: string; credential: unknown }) {
      assertEncryptionConfigured();
      const credential = garminCredentialSchema.parse(input.credential);
      const tracker = await store.requireTracker(input.trackerKey);
      const importedAt = now();
      await store.saveAndReset({
        trackerId: tracker.id,
        plaintext: JSON.stringify(credential),
        verifiedAt: null,
        attemptedAt: null,
        now: importedAt,
      });
      return connectionStatus(await store.getStatus(input.trackerKey));
    },

    async previewActivities(input: { trackerKey: string; date: string }) {
      const date = localDateSchema.parse(input.date);
      const tracker = await store.requireTracker(input.trackerKey);
      const requestedAt = now();
      const today = localDateInTimeZone(requestedAt, tracker.planningTimeZone);
      if (date > today) {
        throw new GarminPreviewDateOutOfRangeError();
      }

      let credential: GarminCredential;
      try {
        credential = garminCredentialSchema.parse(
          JSON.parse(await store.read(tracker.id)) as unknown,
        );
      } catch (error) {
        await store.markFailure(
          tracker.id,
          requestedAt,
          "invalid_token_bundle",
        );
        throw new GarminProviderError("invalid_token_bundle", {
          cause: error,
        });
      }

      try {
        const result = await client.fetchActivitiesForDate({
          credential,
          date,
        });
        if (
          result.activities.some(
            (activity) =>
              localDateInTimeZone(
                activity.startedAt,
                tracker.planningTimeZone,
              ) !== date,
          )
        ) {
          throw new GarminProviderError("invalid_response");
        }
        await store.saveAndReset({
          trackerId: tracker.id,
          plaintext: JSON.stringify(result.refreshedCredential),
          verifiedAt: requestedAt,
          attemptedAt: requestedAt,
          now: requestedAt,
        });
        return garminActivityPreviewResponseSchema.parse({
          provider: "garmin",
          date,
          activities: result.activities.map((activity) => ({
            activityType: activity.activityType,
            startedAt: activity.startedAt,
            durationSeconds: activity.durationSeconds,
            distanceMeters: activity.distanceMeters,
            averagePaceSecondsPerKilometer:
              activity.averagePaceSecondsPerKilometer,
            averageHeartRateBpm: activity.averageHeartRateBpm,
          })),
          connection: connectionStatus(await store.getStatus(input.trackerKey)),
        });
      } catch (error) {
        const providerError =
          error instanceof GarminProviderError
            ? error
            : new GarminProviderError("provider_unavailable", {
                cause: error,
              });
        await store.markFailure(tracker.id, requestedAt, providerError.code);
        throw providerError;
      }
    },
  };
}

export function createDefaultGarminRuntime(database?: Database) {
  return createGarminRuntime({
    store: createNeonGarminCredentialStore(database),
    client: createGarminPythonRuntimeClient(),
  });
}
