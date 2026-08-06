import "server-only";

import { randomUUID } from "node:crypto";

import { localDateInTimeZone } from "@/domain/planning-time";
import {
  integrationStatusSchema,
  type IntegrationStatus,
} from "@/domain/integrations";
import { getDatabase } from "@/server/db/client";
import { createNeonProviderCatchUpStore } from "@/server/integrations/core/neon-catch-up-store";
import { createNeonProviderDateSyncStore } from "@/server/integrations/core/neon-date-sync-store";
import { createNeonProviderHistoryStore } from "@/server/integrations/core/neon-history-sync-store";
import { createNeonAutomaticProviderRecoveryClaimStore } from "@/server/integrations/core/neon-automatic-recovery-store";
import { runAutomaticProviderRecovery } from "@/server/integrations/core/automatic-provider-recovery";
import { syncProviderCatchUpBatch } from "@/server/integrations/core/sync-provider-catch-up";
import { syncProviderDate } from "@/server/integrations/core/sync-provider-date";
import {
  canonicalCooldownDeadline,
  providerCooldownDefaultMs,
  type ProviderCooldown,
} from "@/server/integrations/core/provider-cooldown";
import {
  syncProviderHistoryBatch,
  type ProviderHistoryDays,
} from "@/server/integrations/core/sync-provider-history";
import { getIntegrationEncryptionConfig } from "@/server/integrations/credentials/config";
import {
  claimIntegrationCredentialOperation,
  claimIntegrationProviderCooldown,
  IntegrationCredentialNotFoundError,
  getIntegrationStatus,
  markIntegrationConnectionFailure,
  markIntegrationConnectionFailureUnderOperationLease,
  releaseIntegrationCredentialOperation,
  extendIntegrationProviderCooldown,
  requireIntegrationTracker,
  saveIntegrationCredential,
  saveIntegrationCredentialUnderOperationLease,
} from "@/server/integrations/credentials/repository";
import {
  IntegrationProviderCooldownError,
  IntegrationOperationInProgressError,
  IntegrationOperationLeaseLostError,
} from "@/server/integrations/credentials/operation-errors";

import { createXunjiReadOnlyAdapter, XunjiProviderError } from "./adapter";
import { normalizeXunjiTrains } from "./normalize";

type Database = ReturnType<typeof getDatabase>;
type Tracker = Awaited<ReturnType<typeof requireIntegrationTracker>>;

export type XunjiRuntimeAdapter = ReturnType<typeof createXunjiReadOnlyAdapter>;

export type XunjiCredentialStore = {
  requireTracker(trackerKey: string): Promise<Tracker>;
  getStatus(trackerKey: string): Promise<IntegrationStatus>;
  claimOperation(input: {
    trackerId: string;
    owner: string;
    claimedAt: Date;
    expiresAt: Date;
  }): Promise<{ status: "claimed"; plaintext: string } | { status: "busy" }>;
  releaseOperation(input: {
    trackerId: string;
    owner: string;
  }): Promise<boolean>;
  claimProviderCooldown(input: {
    trackerId: string;
    provider: string;
    claimedAt: Date;
    cooldownUntil: Date;
  }): Promise<
    | { status: "claimed"; cooldown: ProviderCooldown }
    | { status: "cooldown"; cooldown: ProviderCooldown }
  >;
  extendProviderCooldown(input: {
    trackerId: string;
    provider: string;
    now: Date;
    cooldownUntil: Date;
  }): Promise<ProviderCooldown>;
  markFailure(
    trackerId: string,
    owner: string,
    failedAt: Date,
    errorCode: string,
  ): Promise<boolean>;
};

type XunjiOperation = {
  owner: string;
  apiKey: string;
  beforeProviderRead: () => Promise<void>;
  cooldown: () => ProviderCooldown | null;
};

function publicCooldown(cooldown: ProviderCooldown) {
  return {
    kind: cooldown.kind,
    retryAvailableAt: cooldown.retryAvailableAt.toISOString(),
    retryAfterMs: cooldown.retryAfterMs,
    serverNow: cooldown.serverNow.toISOString(),
  } as const;
}

async function decorateBatchCooldown<
  Result extends {
    days: Array<{
      status: "succeeded" | "failed";
      errorCode?: string;
      retryAfterMs?: number;
    }>;
  },
>(input: {
  result: Result;
  operation: XunjiOperation;
  trackerId: string;
  now: () => Date;
  extendProviderCooldown: XunjiCredentialStore["extendProviderCooldown"];
}) {
  const rateLimited = input.result.days.find(
    (day) => day.status === "failed" && day.errorCode === "rate_limited",
  );
  if (!rateLimited) {
    const cooldown = input.operation.cooldown();
    return {
      ...input.result,
      cooldown: cooldown ? publicCooldown(cooldown) : null,
    };
  }
  const now = input.now();
  const cooldown = await input.extendProviderCooldown({
    trackerId: input.trackerId,
    provider: "xunji",
    now,
    cooldownUntil: canonicalCooldownDeadline({
      now,
      providerRetryAfterMs: rateLimited.retryAfterMs,
    }),
  });
  return {
    ...input.result,
    days: input.result.days.map((day) =>
      day === rateLimited
        ? { ...day, retryAfterMs: cooldown.retryAfterMs }
        : day,
    ),
    cooldown: publicCooldown(cooldown),
  };
}

function publicStatus(value: unknown) {
  return integrationStatusSchema.parse(value);
}

export function createXunjiRuntime({
  store,
  adapter,
  createDateSyncStore,
  createCatchUpStore,
  createHistoryStore,
  automaticRecoveryStore,
  now = () => new Date(),
}: {
  store: XunjiCredentialStore;
  adapter: XunjiRuntimeAdapter;
  createDateSyncStore: (
    trackerKey: string,
    stateProvider?: string,
  ) => Parameters<typeof syncProviderDate>[0]["store"];
  createCatchUpStore: () => Parameters<
    typeof syncProviderCatchUpBatch
  >[0]["store"];
  createHistoryStore: () => Parameters<
    typeof syncProviderHistoryBatch
  >[0]["store"];
  automaticRecoveryStore: Parameters<
    typeof runAutomaticProviderRecovery
  >[0]["store"];
  now?: () => Date;
}) {
  const providerOperationLeaseMs = 2 * 60_000;
  const automaticRecoveryMinimumIntervalMs = 30 * 60_000;
  const automaticRecoveryLeaseMs = 2 * 60_000;

  async function withXunjiOperation<Result>(
    tracker: Tracker,
    operation: (lease: XunjiOperation) => Promise<Result>,
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
    let providerCooldown: ProviderCooldown | null = null;
    const beforeProviderRead = async () => {
      if (providerCooldown) return;
      const cooldownClaim = await store.claimProviderCooldown({
        trackerId: tracker.id,
        provider: "xunji",
        claimedAt,
        cooldownUntil: new Date(
          claimedAt.valueOf() + providerCooldownDefaultMs,
        ),
      });
      if (cooldownClaim.status === "cooldown") {
        throw new IntegrationProviderCooldownError(cooldownClaim.cooldown);
      }
      providerCooldown = cooldownClaim.cooldown;
    };
    try {
      return await operation({
        owner,
        apiKey: claimed.plaintext,
        beforeProviderRead,
        cooldown: () => providerCooldown,
      });
    } catch (error) {
      if (
        error instanceof XunjiProviderError &&
        error.code === "rate_limited"
      ) {
        const cooldown = await store.extendProviderCooldown({
          trackerId: tracker.id,
          provider: "xunji",
          now: claimedAt,
          cooldownUntil: canonicalCooldownDeadline({
            now: claimedAt,
            providerRetryAfterMs: error.retryAfterMs,
          }),
        });
        throw new XunjiProviderError("rate_limited", {
          cause: error,
          retryAfterMs: cooldown.retryAfterMs,
          retryAvailableAt: cooldown.retryAvailableAt,
        });
      }
      throw error;
    } finally {
      await store.releaseOperation({ trackerId: tracker.id, owner });
    }
  }

  function readDate(input: {
    tracker: Tracker;
    date: string;
    requestedAt: Date;
    operation: XunjiOperation;
    stateProvider?: string;
  }) {
    return syncProviderDate({
      trackerId: input.tracker.id,
      provider: "xunji",
      date: input.date,
      now: input.requestedAt,
      store: createDateSyncStore(input.tracker.key, input.stateProvider),
      readSource: async () =>
        normalizeXunjiTrains({
          trains: await adapter.fetchTrainsForDate({
            apiKey: input.operation.apiKey,
            date: input.date,
          }),
          date: input.date,
          fetchedAt: input.requestedAt,
          planningTimeZone: input.tracker.planningTimeZone,
        }),
      beforeReadSource: input.operation.beforeProviderRead,
    });
  }

  async function syncCatchUpForTracker(
    tracker: Tracker,
    operation: XunjiOperation,
    requestedAt: Date,
    batchSize = 5,
  ) {
    return syncProviderCatchUpBatch({
      trackerId: tracker.id,
      provider: "xunji",
      startedOn: tracker.startedOn,
      today: localDateInTimeZone(requestedAt, tracker.planningTimeZone),
      now: requestedAt,
      batchSize,
      store: createCatchUpStore(),
      syncDate: (date) =>
        readDate({
          tracker,
          date,
          requestedAt,
          operation,
        }),
    });
  }

  async function syncBoundedHistoryForTracker(
    tracker: Tracker,
    operation: XunjiOperation,
    requestedAt: Date,
    input: { days: ProviderHistoryDays; batchSize: number },
  ) {
    const scope = "xunji_training_history" as const;
    return syncProviderHistoryBatch({
      trackerId: tracker.id,
      provider: "xunji",
      scope,
      days: input.days,
      today: localDateInTimeZone(requestedAt, tracker.planningTimeZone),
      now: requestedAt,
      batchSize: input.batchSize,
      store: createHistoryStore(),
      syncDate: (date) =>
        readDate({
          tracker,
          date,
          requestedAt,
          operation,
          stateProvider: scope,
        }),
    });
  }

  return {
    async status(trackerKey: string) {
      return publicStatus(await store.getStatus(trackerKey));
    },

    async syncDate(input: { trackerKey: string; date: string; now?: Date }) {
      const tracker = await store.requireTracker(input.trackerKey);
      const requestedAt = input.now ?? now();
      return withXunjiOperation(tracker, (operation) =>
        readDate({ tracker, date: input.date, requestedAt, operation }),
      );
    },

    async syncCatchUp(input: {
      trackerKey: string;
      now?: Date;
      batchSize?: number;
    }) {
      const tracker = await store.requireTracker(input.trackerKey);
      const requestedAt = input.now ?? now();
      return withXunjiOperation(tracker, (operation) =>
        syncCatchUpForTracker(
          tracker,
          operation,
          requestedAt,
          input.batchSize,
        ).then((result) =>
          decorateBatchCooldown({
            result,
            operation,
            trackerId: tracker.id,
            now,
            extendProviderCooldown: store.extendProviderCooldown,
          }),
        ),
      );
    },

    async syncBoundedHistory(input: {
      trackerKey: string;
      days: ProviderHistoryDays;
      now?: Date;
      batchSize?: number;
    }) {
      const tracker = await store.requireTracker(input.trackerKey);
      return withXunjiOperation(tracker, (operation) =>
        syncBoundedHistoryForTracker(tracker, operation, input.now ?? now(), {
          days: input.days,
          batchSize: input.batchSize ?? 5,
        }).then((result) =>
          decorateBatchCooldown({
            result,
            operation,
            trackerId: tracker.id,
            now,
            extendProviderCooldown: store.extendProviderCooldown,
          }),
        ),
      );
    },

    async recoverHistory(input: {
      trackerKey: string;
      now?: Date;
      batchSize?: number;
    }) {
      const tracker = await store.requireTracker(input.trackerKey);
      const status = await store.getStatus(tracker.key);
      if (!publicStatus(status).configured) {
        return { status: "skipped" as const, reason: "not_connected" as const };
      }
      try {
        return await withXunjiOperation(tracker, (operation) =>
          runAutomaticProviderRecovery({
            trackerId: tracker.id,
            provider: "xunji",
            now: input.now ?? now(),
            minimumIntervalMs: automaticRecoveryMinimumIntervalMs,
            leaseMs: automaticRecoveryLeaseMs,
            store: automaticRecoveryStore,
            recover: () =>
              syncCatchUpForTracker(
                tracker,
                operation,
                input.now ?? now(),
                input.batchSize ?? 5,
              ),
          }),
        );
      } catch (error) {
        if (error instanceof IntegrationOperationInProgressError) {
          return { status: "skipped" as const, reason: "in_progress" as const };
        }
        throw error;
      }
    },
  };
}

function createDefaultXunjiCredentialStore(
  database: Database = getDatabase(),
): XunjiCredentialStore {
  return {
    requireTracker: (trackerKey) =>
      requireIntegrationTracker(trackerKey, database),
    getStatus: async (trackerKey) =>
      publicStatus(await getIntegrationStatus(trackerKey, "xunji", database)),
    claimOperation: ({ trackerId, owner, claimedAt, expiresAt }) =>
      claimIntegrationCredentialOperation({
        trackerId,
        provider: "xunji",
        owner,
        claimedAt,
        expiresAt,
        database,
      }),
    releaseOperation: ({ trackerId, owner }) =>
      releaseIntegrationCredentialOperation({
        trackerId,
        provider: "xunji",
        owner,
        database,
      }),
    claimProviderCooldown: ({
      trackerId,
      provider,
      claimedAt,
      cooldownUntil,
    }) =>
      claimIntegrationProviderCooldown({
        trackerId,
        provider,
        claimedAt,
        cooldownUntil,
        database,
      }),
    extendProviderCooldown: ({ trackerId, provider, now, cooldownUntil }) =>
      extendIntegrationProviderCooldown({
        trackerId,
        provider,
        now,
        cooldownUntil,
        database,
      }),
    markFailure: (trackerId, owner, failedAt, errorCode) =>
      markIntegrationConnectionFailureUnderOperationLease({
        trackerId,
        provider: "xunji",
        owner,
        failedAt,
        errorCode,
        database,
      }),
  };
}

function createDefaultXunjiRuntime(database?: Database) {
  const resolvedDatabase = database ?? getDatabase();
  return createXunjiRuntime({
    store: createDefaultXunjiCredentialStore(resolvedDatabase),
    adapter: createXunjiReadOnlyAdapter(),
    createDateSyncStore: (trackerKey, stateProvider) =>
      createNeonProviderDateSyncStore(trackerKey, resolvedDatabase, {
        stateProvider,
      }),
    createCatchUpStore: () => createNeonProviderCatchUpStore(resolvedDatabase),
    createHistoryStore: () => createNeonProviderHistoryStore(resolvedDatabase),
    automaticRecoveryStore:
      createNeonAutomaticProviderRecoveryClaimStore(resolvedDatabase),
  });
}

export async function validateAndSaveXunjiCredential(input: {
  trackerKey: string;
  apiKey: string;
  now?: Date;
  database?: Database;
}) {
  const now = input.now ?? new Date();
  const database = input.database ?? getDatabase();
  getIntegrationEncryptionConfig();
  const tracker = await requireIntegrationTracker(input.trackerKey, database);
  const date = localDateInTimeZone(now, tracker.planningTimeZone);
  const owner = randomUUID();
  let leased = false;
  try {
    let claimed: Awaited<
      ReturnType<typeof claimIntegrationCredentialOperation>
    > | null = null;
    try {
      claimed = await claimIntegrationCredentialOperation({
        trackerId: tracker.id,
        provider: "xunji",
        owner,
        claimedAt: now,
        expiresAt: new Date(now.valueOf() + 2 * 60_000),
        database,
      });
    } catch (error) {
      if (!(error instanceof IntegrationCredentialNotFoundError)) throw error;
    }
    if (claimed?.status === "busy") {
      throw new IntegrationOperationInProgressError();
    }
    leased = claimed?.status === "claimed";
    const cooldownClaim = await claimIntegrationProviderCooldown({
      trackerId: tracker.id,
      provider: "xunji",
      claimedAt: now,
      cooldownUntil: new Date(now.valueOf() + providerCooldownDefaultMs),
      database,
    });
    if (cooldownClaim.status === "cooldown") {
      throw new IntegrationProviderCooldownError(cooldownClaim.cooldown);
    }
    await createXunjiReadOnlyAdapter().fetchTrainsForDate({
      apiKey: input.apiKey,
      date,
    });
    if (leased) {
      const saved = await saveIntegrationCredentialUnderOperationLease({
        trackerId: tracker.id,
        provider: "xunji",
        owner,
        plaintext: input.apiKey,
        verifiedAt: now,
        savedAt: now,
        expiresAt: new Date(now.valueOf() + 2 * 60_000),
        database,
      });
      if (!saved) throw new IntegrationOperationLeaseLostError();
    } else {
      await saveIntegrationCredential({
        trackerId: tracker.id,
        provider: "xunji",
        plaintext: input.apiKey,
        verifiedAt: now,
        database,
      });
    }
  } catch (error) {
    if (error instanceof IntegrationProviderCooldownError) {
      throw error;
    }
    if (error instanceof XunjiProviderError && error.code === "rate_limited") {
      const cooldown = await extendIntegrationProviderCooldown({
        trackerId: tracker.id,
        provider: "xunji",
        now,
        cooldownUntil: canonicalCooldownDeadline({
          now,
          providerRetryAfterMs: error.retryAfterMs,
        }),
        database,
      });
      error = new XunjiProviderError("rate_limited", {
        cause: error,
        retryAfterMs: cooldown.retryAfterMs,
        retryAvailableAt: cooldown.retryAvailableAt,
      });
    }
    if (leased) {
      await markIntegrationConnectionFailureUnderOperationLease({
        trackerId: tracker.id,
        provider: "xunji",
        owner,
        failedAt: now,
        errorCode:
          error instanceof XunjiProviderError
            ? error.code
            : "provider_unavailable",
        database,
      });
    } else if (error instanceof XunjiProviderError) {
      await markIntegrationConnectionFailure({
        trackerId: tracker.id,
        provider: "xunji",
        failedAt: now,
        errorCode: error.code,
        database,
      });
    }
    throw error;
  } finally {
    if (leased) {
      await releaseIntegrationCredentialOperation({
        trackerId: tracker.id,
        provider: "xunji",
        owner,
        database,
      });
    }
  }
}

export async function syncXunjiDate(input: {
  trackerKey: string;
  date: string;
  now?: Date;
  database?: Database;
}) {
  return createDefaultXunjiRuntime(input.database).syncDate(input);
}

export async function syncXunjiCatchUpBatch(input: {
  trackerKey: string;
  now?: Date;
  database?: Database;
  batchSize?: number;
}) {
  return createDefaultXunjiRuntime(input.database).syncCatchUp(input);
}

export async function syncXunjiBoundedHistory(input: {
  trackerKey: string;
  days: ProviderHistoryDays;
  now?: Date;
  database?: Database;
  batchSize?: number;
}) {
  return createDefaultXunjiRuntime(input.database).syncBoundedHistory(input);
}

export async function recoverXunjiHistory(input: {
  trackerKey: string;
  now?: Date;
  database?: Database;
  batchSize?: number;
}) {
  return createDefaultXunjiRuntime(input.database).recoverHistory(input);
}
