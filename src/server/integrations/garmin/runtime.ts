import "server-only";

import { randomUUID } from "node:crypto";

import {
  garminActivitySyncResponseSchema,
  garminActivityRecoveryResponseSchema,
  garminActivityPreviewResponseSchema,
  garminConnectionStatusSchema,
  garminProviderErrorCodeSchema,
  garminWellnessSyncResponseSchema,
  garminWellnessProgressSchema,
  garminWellnessRecoveryResponseSchema,
  type GarminConnectionStatus,
} from "@/domain/garmin";
import {
  integrationStatusSchema,
  type IntegrationStatus,
} from "@/domain/integrations";
import { localDateInTimeZone } from "@/domain/planning-time";
import { localDateSchema } from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import { createNeonProviderCatchUpStore } from "@/server/integrations/core/neon-catch-up-store";
import { createNeonAutomaticProviderRecoveryClaimStore } from "@/server/integrations/core/neon-automatic-recovery-store";
import {
  runAutomaticProviderRecovery,
  type AutomaticProviderRecoveryClaimStore,
} from "@/server/integrations/core/automatic-provider-recovery";
import { createNeonProviderDateSyncStore } from "@/server/integrations/core/neon-date-sync-store";
import { createNeonProviderHistoryStore } from "@/server/integrations/core/neon-history-sync-store";
import {
  syncProviderCatchUpBatch,
  type ProviderCatchUpStore,
} from "@/server/integrations/core/sync-provider-catch-up";
import {
  syncProviderDate,
  type ProviderDateSyncStore,
} from "@/server/integrations/core/sync-provider-date";
import {
  syncProviderHistoryBatch,
  type ProviderHistoryDays,
  type ProviderHistoryStore,
} from "@/server/integrations/core/sync-provider-history";
import { getIntegrationEncryptionConfig } from "@/server/integrations/credentials/config";
import {
  claimIntegrationCredentialOperation,
  getIntegrationStatus,
  markIntegrationConnectionFailureUnderOperationLease,
  releaseIntegrationCredentialOperation,
  requireIntegrationTracker,
  saveIntegrationCredentialAndResetState,
  saveIntegrationCredentialUnderOperationLease,
} from "@/server/integrations/credentials/repository";
import {
  IntegrationOperationInProgressError,
  IntegrationOperationInterruptedError,
  IntegrationOperationLeaseLostError,
} from "@/server/integrations/credentials/operation-errors";

import {
  garminCredentialSchema,
  type GarminClient,
  type GarminCredential,
} from "./contracts";
import { GarminProviderError } from "./errors";
import {
  normalizeGarminActivities,
  normalizeGarminWellness,
} from "./normalize";
import { createGarminPythonRuntimeClient } from "./python-runtime-client";

type Database = ReturnType<typeof getDatabase>;
type Tracker = Awaited<ReturnType<typeof requireIntegrationTracker>>;
type GenericStatus = IntegrationStatus;
type GarminAutomaticRecoveryProfile = "foreground" | "daily_cron";

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
  claimOperation(input: {
    trackerId: string;
    owner: string;
    claimedAt: Date;
    expiresAt: Date;
  }): Promise<{ status: "claimed"; plaintext: string } | { status: "busy" }>;
  saveRefreshed(input: {
    trackerId: string;
    owner: string;
    plaintext: string;
    verifiedAt: Date;
    savedAt: Date;
    expiresAt: Date;
  }): Promise<boolean>;
  releaseOperation(input: {
    trackerId: string;
    owner: string;
  }): Promise<boolean>;
  markFailure(
    trackerId: string,
    owner: string,
    failedAt: Date,
    errorCode: string,
  ): Promise<boolean>;
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
    claimOperation: ({ trackerId, owner, claimedAt, expiresAt }) =>
      claimIntegrationCredentialOperation({
        trackerId,
        provider: "garmin",
        owner,
        claimedAt,
        expiresAt,
        database,
      }),
    saveRefreshed: ({
      trackerId,
      owner,
      plaintext,
      verifiedAt,
      savedAt,
      expiresAt,
    }) =>
      saveIntegrationCredentialUnderOperationLease({
        trackerId,
        provider: "garmin",
        owner,
        plaintext,
        verifiedAt,
        savedAt,
        expiresAt,
        database,
      }),
    releaseOperation: ({ trackerId, owner }) =>
      releaseIntegrationCredentialOperation({
        trackerId,
        provider: "garmin",
        owner,
        database,
      }),
    markFailure: (trackerId, owner, failedAt, errorCode) =>
      markIntegrationConnectionFailureUnderOperationLease({
        trackerId,
        provider: "garmin",
        owner,
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
    sync: {
      status: status.sync.status,
      lastAttemptAt: status.sync.lastAttemptAt,
      lastSucceededDate: status.sync.lastSucceededDate,
      nextCursor: status.sync.nextCursor ?? null,
      lastErrorCode,
    },
  });
}

export function createGarminRuntime({
  store,
  client,
  createDateSyncStore,
  createCatchUpStore,
  createHistoryStore,
  automaticRecoveryStore,
  now = () => new Date(),
  assertEncryptionConfigured = () => void getIntegrationEncryptionConfig(),
}: {
  store: GarminCredentialStore;
  client: GarminClient<GarminCredential>;
  createDateSyncStore: (
    trackerKey: string,
    stateProvider?: string,
  ) => ProviderDateSyncStore;
  createCatchUpStore: () => ProviderCatchUpStore;
  createHistoryStore?: () => ProviderHistoryStore;
  automaticRecoveryStore: AutomaticProviderRecoveryClaimStore;
  now?: () => Date;
  assertEncryptionConfigured?: () => void;
}) {
  const historyStore =
    createHistoryStore ?? (() => createNeonProviderHistoryStore());
  const automaticRecoveryMinimumIntervalMs = 30 * 60_000;
  const automaticRecoveryLeaseMs = 2 * 60_000;
  const providerOperationLeaseMs = 2 * 60_000;

  type GarminOperation = {
    owner: string;
    credential: GarminCredential;
    persistRefreshed(
      refreshedCredential: GarminCredential,
      verifiedAt: Date,
    ): Promise<void>;
    markFailure(failedAt: Date, errorCode: string): Promise<void>;
  };

  async function withGarminOperation<Result>(
    tracker: Tracker,
    operation: (lease: GarminOperation) => Promise<Result>,
  ) {
    const owner = randomUUID();
    const claimedAt = now();
    const claimed = await store.claimOperation({
      trackerId: tracker.id,
      owner,
      claimedAt,
      expiresAt: new Date(claimedAt.valueOf() + providerOperationLeaseMs),
    });
    if (claimed.status === "busy") {
      throw new IntegrationOperationInProgressError();
    }
    try {
      let credential: GarminCredential;
      try {
        credential = garminCredentialSchema.parse(
          JSON.parse(claimed.plaintext) as unknown,
        );
      } catch (error) {
        const marked = await store.markFailure(
          tracker.id,
          owner,
          claimedAt,
          "invalid_token_bundle",
        );
        if (!marked) throw new IntegrationOperationLeaseLostError();
        throw new GarminProviderError("invalid_token_bundle", { cause: error });
      }
      const lease: GarminOperation = {
        owner,
        credential,
        async persistRefreshed(refreshedCredential, verifiedAt) {
          const savedAt = now();
          const saved = await store.saveRefreshed({
            trackerId: tracker.id,
            owner,
            plaintext: JSON.stringify(refreshedCredential),
            verifiedAt,
            savedAt,
            expiresAt: new Date(savedAt.valueOf() + providerOperationLeaseMs),
          });
          if (!saved) throw new IntegrationOperationLeaseLostError();
          lease.credential = refreshedCredential;
        },
        async markFailure(failedAt, errorCode) {
          const marked = await store.markFailure(
            tracker.id,
            owner,
            failedAt,
            errorCode,
          );
          if (!marked) throw new IntegrationOperationLeaseLostError();
        },
      };
      return await operation(lease);
    } finally {
      await store.releaseOperation({ trackerId: tracker.id, owner });
    }
  }

  async function readActivities(input: {
    tracker: Tracker;
    date: string;
    requestedAt: Date;
    markCredentialFailure: boolean;
    operation: GarminOperation;
  }) {
    try {
      const result = await client.fetchActivitiesForDate({
        credential: input.operation.credential,
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
      await input.operation.persistRefreshed(
        result.refreshedCredential,
        input.requestedAt,
      );
      return result.activities;
    } catch (error) {
      if (error instanceof IntegrationOperationInterruptedError) throw error;
      const providerError =
        error instanceof GarminProviderError
          ? error
          : new GarminProviderError("provider_unavailable", { cause: error });
      if (input.markCredentialFailure) {
        await input.operation.markFailure(
          input.requestedAt,
          providerError.code,
        );
      }
      throw providerError;
    }
  }

  async function readWellness(input: {
    tracker: Tracker;
    date: string;
    requestedAt: Date;
    operation: GarminOperation;
  }) {
    try {
      const result = await client.fetchWellnessForDate({
        credential: input.operation.credential,
        date: input.date,
      });
      if (result.wellness.localDate !== input.date) {
        throw new GarminProviderError("invalid_response");
      }
      await input.operation.persistRefreshed(
        result.refreshedCredential,
        input.requestedAt,
      );
      return result.wellness;
    } catch (error) {
      if (error instanceof IntegrationOperationInterruptedError) throw error;
      const providerError =
        error instanceof GarminProviderError
          ? error
          : new GarminProviderError("provider_unavailable", { cause: error });
      if (
        providerError.code === "authentication" ||
        providerError.code === "invalid_token_bundle" ||
        providerError.code === "unsupported_client_version"
      ) {
        await input.operation.markFailure(
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

  async function syncTrackerDate(input: {
    tracker: Tracker;
    date: string;
    requestedAt: Date;
    operation: GarminOperation;
  }) {
    return syncProviderDate({
      trackerId: input.tracker.id,
      provider: "garmin",
      date: input.date,
      now: input.requestedAt,
      store: createDateSyncStore(input.tracker.key),
      readSource: async () =>
        normalizeGarminActivities({
          activities: await readActivities({
            tracker: input.tracker,
            date: input.date,
            requestedAt: input.requestedAt,
            markCredentialFailure: false,
            operation: input.operation,
          }),
          localDate: input.date,
          planningTimeZone: input.tracker.planningTimeZone,
          fetchedAt: input.requestedAt,
        }),
    });
  }

  async function syncWellnessDate(input: {
    tracker: Tracker;
    date: string;
    requestedAt: Date;
    operation: GarminOperation;
  }) {
    return syncProviderDate({
      trackerId: input.tracker.id,
      provider: "garmin",
      date: input.date,
      now: input.requestedAt,
      store: createDateSyncStore(input.tracker.key, "garmin_wellness"),
      readSource: async () =>
        normalizeGarminWellness({
          wellness: await readWellness(input),
          localDate: input.date,
          planningTimeZone: input.tracker.planningTimeZone,
          fetchedAt: input.requestedAt,
        }),
    });
  }

  async function syncActivityHistoryForTracker(
    tracker: Tracker,
    batchSize: 1 | 2 | 3 | 5,
    operation: GarminOperation,
  ) {
    const requestedAt = now();
    const today = localDateInTimeZone(requestedAt, tracker.planningTimeZone);
    return syncProviderCatchUpBatch({
      trackerId: tracker.id,
      provider: "garmin",
      startedOn: tracker.startedOn,
      today,
      now: requestedAt,
      batchSize,
      overlapDays: 2,
      store: createCatchUpStore(),
      syncDate: (date) =>
        syncTrackerDate({ tracker, date, requestedAt: now(), operation }),
    });
  }

  async function syncWellnessHistoryForTracker(
    tracker: Tracker,
    operation: GarminOperation,
    batchSize: 1 | 2 | 3 | 5 = 5,
  ) {
    const requestedAt = now();
    const today = localDateInTimeZone(requestedAt, tracker.planningTimeZone);
    return syncProviderCatchUpBatch({
      trackerId: tracker.id,
      provider: "garmin",
      stateProvider: "garmin_wellness",
      startedOn: tracker.startedOn,
      today,
      now: requestedAt,
      batchSize,
      overlapDays: 2,
      store: createCatchUpStore(),
      syncDate: (date) =>
        syncWellnessDate({ tracker, date, requestedAt: now(), operation }),
    });
  }

  async function syncBoundedHistoryForTracker(
    tracker: Tracker,
    input: {
      scope: "garmin_activity_history" | "garmin_wellness_history";
      days: ProviderHistoryDays;
    },
    operation: GarminOperation,
  ) {
    const requestedAt = now();
    const today = localDateInTimeZone(requestedAt, tracker.planningTimeZone);
    return syncProviderHistoryBatch({
      trackerId: tracker.id,
      provider: "garmin",
      scope: input.scope,
      days: input.days,
      today,
      now: requestedAt,
      batchSize: 3,
      store: historyStore(),
      syncDate: (date) =>
        input.scope === "garmin_activity_history"
          ? syncProviderDate({
              trackerId: tracker.id,
              provider: "garmin",
              date,
              now: requestedAt,
              store: createDateSyncStore(tracker.key, input.scope),
              readSource: async () =>
                normalizeGarminActivities({
                  activities: await readActivities({
                    tracker,
                    date,
                    requestedAt,
                    markCredentialFailure: false,
                    operation,
                  }),
                  localDate: date,
                  planningTimeZone: tracker.planningTimeZone,
                  fetchedAt: requestedAt,
                }),
            })
          : syncProviderDate({
              trackerId: tracker.id,
              provider: "garmin",
              date,
              now: requestedAt,
              store: createDateSyncStore(tracker.key, input.scope),
              readSource: async () =>
                normalizeGarminWellness({
                  wellness: await readWellness({
                    tracker,
                    date,
                    requestedAt,
                    operation,
                  }),
                  localDate: date,
                  planningTimeZone: tracker.planningTimeZone,
                  fetchedAt: requestedAt,
                }),
            }),
    });
  }

  async function wellnessProgressForTracker(tracker: Tracker) {
    const today = localDateInTimeZone(now(), tracker.planningTimeZone);
    const progress = await createCatchUpStore().loadProgress({
      trackerId: tracker.id,
      provider: "garmin_wellness",
      startedOn: tracker.startedOn,
      targetDate: today,
    });
    const lastSucceededDate =
      progress.states
        .filter((state) => state.status === "succeeded")
        .map((state) => state.date)
        .sort()
        .at(-1) ?? null;
    const errorCode = garminProviderErrorCodeSchema.safeParse(
      progress.lastErrorCode,
    );
    return garminWellnessProgressSchema.parse({
      provider: "garmin",
      kind: "daily_wellness",
      sync: {
        status: progress.overallStatus,
        lastAttemptAt: progress.lastAttemptAt?.toISOString() ?? null,
        lastSucceededDate,
        nextCursor: progress.cursorDate,
        lastErrorCode: errorCode.success ? errorCode.data : null,
      },
    });
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
      const activities = await withGarminOperation(tracker, (operation) =>
        readActivities({
          tracker,
          date,
          requestedAt,
          markCredentialFailure: true,
          operation,
        }),
      );
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
      const sync = await withGarminOperation(tracker, (operation) =>
        syncTrackerDate({ tracker, date, requestedAt, operation }),
      );
      return garminActivitySyncResponseSchema.parse({
        provider: "garmin",
        date,
        sync,
        connection: connectionStatus(await store.getStatus(input.trackerKey)),
      });
    },

    async syncWellness(input: { trackerKey: string; date: string }) {
      const { date, tracker, requestedAt } = await requirePreviewDate(
        input.trackerKey,
        input.date,
      );
      const sync = await withGarminOperation(tracker, (operation) =>
        syncWellnessDate({ tracker, date, requestedAt, operation }),
      );
      return garminWellnessSyncResponseSchema.parse({
        provider: "garmin",
        kind: "daily_wellness",
        date,
        sync,
      });
    },

    async syncWellnessHistory(input: { trackerKey: string }) {
      const tracker = await store.requireTracker(input.trackerKey);
      return withGarminOperation(tracker, (operation) =>
        syncWellnessHistoryForTracker(tracker, operation),
      );
    },

    async wellnessProgress(input: { trackerKey: string }) {
      return wellnessProgressForTracker(
        await store.requireTracker(input.trackerKey),
      );
    },

    async recoverWellnessHistory(input: {
      trackerKey: string;
      profile?: GarminAutomaticRecoveryProfile;
    }) {
      const connection = connectionStatus(
        await store.getStatus(input.trackerKey),
      );
      const tracker = await store.requireTracker(input.trackerKey);
      if (connection.state !== "connected") {
        return garminWellnessRecoveryResponseSchema.parse({
          status: "skipped",
          reason: connection.state,
          progress: await wellnessProgressForTracker(tracker),
        });
      }
      let recovery;
      try {
        recovery = await withGarminOperation(tracker, (operation) =>
          runAutomaticProviderRecovery({
            trackerId: tracker.id,
            provider: "garmin_wellness",
            now: now(),
            minimumIntervalMs: automaticRecoveryMinimumIntervalMs,
            leaseMs: automaticRecoveryLeaseMs,
            store: automaticRecoveryStore,
            recover: () =>
              syncWellnessHistoryForTracker(
                tracker,
                operation,
                input.profile === "daily_cron" ? 1 : 5,
              ),
          }),
        );
      } catch (error) {
        if (!(error instanceof IntegrationOperationInterruptedError)) {
          throw error;
        }
        return garminWellnessRecoveryResponseSchema.parse({
          status: "skipped",
          reason: "in_progress",
          progress: await wellnessProgressForTracker(tracker),
        });
      }
      return garminWellnessRecoveryResponseSchema.parse(
        recovery.status === "completed"
          ? {
              status: "completed",
              sync: recovery.result,
              progress: await wellnessProgressForTracker(tracker),
            }
          : {
              status: "skipped",
              reason: recovery.reason,
              progress: await wellnessProgressForTracker(tracker),
            },
      );
    },

    async syncActivityHistory(input: { trackerKey: string }) {
      const tracker = await store.requireTracker(input.trackerKey);
      return withGarminOperation(tracker, (operation) =>
        syncActivityHistoryForTracker(tracker, 5, operation),
      );
    },

    async syncBoundedHistory(input: {
      trackerKey: string;
      scope: "garmin_activity_history" | "garmin_wellness_history";
      days: ProviderHistoryDays;
    }) {
      const tracker = await store.requireTracker(input.trackerKey);
      return withGarminOperation(tracker, (operation) =>
        syncBoundedHistoryForTracker(tracker, input, operation),
      );
    },

    async recoverActivityHistory(input: {
      trackerKey: string;
      profile?: GarminAutomaticRecoveryProfile;
    }) {
      const initialConnection = connectionStatus(
        await store.getStatus(input.trackerKey),
      );
      if (initialConnection.state !== "connected") {
        return garminActivityRecoveryResponseSchema.parse({
          status: "skipped",
          reason: initialConnection.state,
          connection: initialConnection,
        });
      }
      const tracker = await store.requireTracker(input.trackerKey);
      let recovery;
      try {
        recovery = await withGarminOperation(tracker, (operation) =>
          runAutomaticProviderRecovery({
            trackerId: tracker.id,
            provider: "garmin",
            now: now(),
            minimumIntervalMs: automaticRecoveryMinimumIntervalMs,
            leaseMs: automaticRecoveryLeaseMs,
            store: automaticRecoveryStore,
            recover: () =>
              syncActivityHistoryForTracker(
                tracker,
                input.profile === "daily_cron" ? 2 : 5,
                operation,
              ),
          }),
        );
      } catch (error) {
        if (!(error instanceof IntegrationOperationInterruptedError)) {
          throw error;
        }
        return garminActivityRecoveryResponseSchema.parse({
          status: "skipped",
          reason: "in_progress",
          connection: connectionStatus(await store.getStatus(input.trackerKey)),
        });
      }
      const latestConnection = connectionStatus(
        await store.getStatus(input.trackerKey),
      );
      return garminActivityRecoveryResponseSchema.parse(
        recovery.status === "completed"
          ? {
              status: "completed",
              sync: recovery.result,
              connection: latestConnection,
            }
          : {
              status: "skipped",
              reason: recovery.reason,
              connection: latestConnection,
            },
      );
    },
  };
}

export function createDefaultGarminRuntime(database?: Database) {
  return createGarminRuntime({
    store: createNeonGarminCredentialStore(database),
    client: createGarminPythonRuntimeClient(),
    createDateSyncStore: (trackerKey, stateProvider) =>
      createNeonProviderDateSyncStore(trackerKey, database ?? getDatabase(), {
        stateProvider,
      }),
    createCatchUpStore: () =>
      createNeonProviderCatchUpStore(database ?? getDatabase()),
    createHistoryStore: () =>
      createNeonProviderHistoryStore(database ?? getDatabase()),
    automaticRecoveryStore: createNeonAutomaticProviderRecoveryClaimStore(
      database ?? getDatabase(),
    ),
  });
}
