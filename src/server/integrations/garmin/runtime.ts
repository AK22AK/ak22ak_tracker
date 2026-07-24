import "server-only";

import {
  garminActivitySyncResponseSchema,
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
import { createNeonProviderDateSyncStore } from "@/server/integrations/core/neon-date-sync-store";
import {
  syncProviderDate,
  type ProviderDateSyncStore,
} from "@/server/integrations/core/sync-provider-date";
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
import { normalizeGarminActivities } from "./normalize";
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
  createDateSyncStore,
  now = () => new Date(),
  assertEncryptionConfigured = () => void getIntegrationEncryptionConfig(),
}: {
  store: GarminCredentialStore;
  client: GarminClient<GarminCredential>;
  createDateSyncStore: (trackerKey: string) => ProviderDateSyncStore;
  now?: () => Date;
  assertEncryptionConfigured?: () => void;
}) {
  async function readActivities(input: {
    tracker: Tracker;
    date: string;
    requestedAt: Date;
    markCredentialFailure: boolean;
  }) {
    let credential: GarminCredential;
    try {
      credential = garminCredentialSchema.parse(
        JSON.parse(await store.read(input.tracker.id)) as unknown,
      );
    } catch (error) {
      if (input.markCredentialFailure) {
        await store.markFailure(
          input.tracker.id,
          input.requestedAt,
          "invalid_token_bundle",
        );
      }
      throw new GarminProviderError("invalid_token_bundle", { cause: error });
    }

    try {
      const result = await client.fetchActivitiesForDate({
        credential,
        date: input.date,
      });
      if (
        result.activities.some(
          (activity) =>
            localDateInTimeZone(
              activity.startedAt,
              input.tracker.planningTimeZone,
            ) !== input.date,
        )
      ) {
        throw new GarminProviderError("invalid_response");
      }
      await store.saveAndReset({
        trackerId: input.tracker.id,
        plaintext: JSON.stringify(result.refreshedCredential),
        verifiedAt: input.requestedAt,
        attemptedAt: input.requestedAt,
        now: input.requestedAt,
      });
      return result.activities;
    } catch (error) {
      const providerError =
        error instanceof GarminProviderError
          ? error
          : new GarminProviderError("provider_unavailable", { cause: error });
      if (input.markCredentialFailure) {
        await store.markFailure(
          input.tracker.id,
          input.requestedAt,
          providerError.code,
        );
      }
      throw providerError;
    }
  }

  async function requirePreviewDate(trackerKey: string, dateInput: string) {
    const date = localDateSchema.parse(dateInput);
    const tracker = await store.requireTracker(trackerKey);
    const requestedAt = now();
    const today = localDateInTimeZone(requestedAt, tracker.planningTimeZone);
    if (date > today) throw new GarminPreviewDateOutOfRangeError();
    return { date, tracker, requestedAt };
  }

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
      const { date, tracker, requestedAt } = await requirePreviewDate(
        input.trackerKey,
        input.date,
      );
      const activities = await readActivities({
        tracker,
        date,
        requestedAt,
        markCredentialFailure: true,
      });
      return garminActivityPreviewResponseSchema.parse({
        provider: "garmin",
        date,
        activities: activities.map((activity) => ({
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
    },

    async syncActivities(input: { trackerKey: string; date: string }) {
      const { date, tracker, requestedAt } = await requirePreviewDate(
        input.trackerKey,
        input.date,
      );
      const sync = await syncProviderDate({
        trackerId: tracker.id,
        provider: "garmin",
        date,
        now: requestedAt,
        store: createDateSyncStore(tracker.key),
        readSource: async () =>
          normalizeGarminActivities({
            activities: await readActivities({
              tracker,
              date,
              requestedAt,
              markCredentialFailure: false,
            }),
            localDate: date,
            planningTimeZone: tracker.planningTimeZone,
            fetchedAt: requestedAt,
          }),
      });
      return garminActivitySyncResponseSchema.parse({
        provider: "garmin",
        date,
        sync,
        connection: connectionStatus(await store.getStatus(input.trackerKey)),
      });
    },
  };
}

export function createDefaultGarminRuntime(database?: Database) {
  return createGarminRuntime({
    store: createNeonGarminCredentialStore(database),
    client: createGarminPythonRuntimeClient(),
    createDateSyncStore: (trackerKey) =>
      createNeonProviderDateSyncStore(trackerKey, database ?? getDatabase()),
  });
}
