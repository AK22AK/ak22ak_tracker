import "server-only";

import { localDateInTimeZone } from "@/domain/planning-time";
import { getDatabase } from "@/server/db/client";
import { createNeonProviderCatchUpStore } from "@/server/integrations/core/neon-catch-up-store";
import { createNeonProviderDateSyncStore } from "@/server/integrations/core/neon-date-sync-store";
import { createNeonProviderHistoryStore } from "@/server/integrations/core/neon-history-sync-store";
import { createNeonAutomaticProviderRecoveryClaimStore } from "@/server/integrations/core/neon-automatic-recovery-store";
import { runAutomaticProviderRecovery } from "@/server/integrations/core/automatic-provider-recovery";
import { syncProviderCatchUpBatch } from "@/server/integrations/core/sync-provider-catch-up";
import { syncProviderDate } from "@/server/integrations/core/sync-provider-date";
import {
  syncProviderHistoryBatch,
  type ProviderHistoryDays,
} from "@/server/integrations/core/sync-provider-history";
import { getIntegrationEncryptionConfig } from "@/server/integrations/credentials/config";
import {
  markIntegrationConnectionFailure,
  readIntegrationCredential,
  requireIntegrationTracker,
  saveIntegrationCredential,
  getIntegrationStatus,
} from "@/server/integrations/credentials/repository";

import { createXunjiReadOnlyAdapter, XunjiProviderError } from "./adapter";
import { normalizeXunjiTrains } from "./normalize";

type Database = ReturnType<typeof getDatabase>;

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
  try {
    await createXunjiReadOnlyAdapter().fetchTrainsForDate({
      apiKey: input.apiKey,
      date,
    });
  } catch (error) {
    await markIntegrationConnectionFailure({
      trackerId: tracker.id,
      provider: "xunji",
      failedAt: now,
      errorCode:
        error instanceof XunjiProviderError
          ? error.code
          : "provider_unavailable",
      database,
    });
    throw error;
  }
  await saveIntegrationCredential({
    trackerId: tracker.id,
    provider: "xunji",
    plaintext: input.apiKey,
    verifiedAt: now,
    database,
  });
}

export async function syncXunjiDate(input: {
  trackerKey: string;
  date: string;
  now?: Date;
  database?: Database;
}) {
  const now = input.now ?? new Date();
  const database = input.database ?? getDatabase();
  const tracker = await requireIntegrationTracker(input.trackerKey, database);
  const apiKey = await readIntegrationCredential({
    trackerId: tracker.id,
    provider: "xunji",
    database,
  });
  const adapter = createXunjiReadOnlyAdapter();

  return syncProviderDate({
    trackerId: tracker.id,
    provider: "xunji",
    date: input.date,
    now,
    store: createNeonProviderDateSyncStore(tracker.key, database),
    readSource: async () =>
      normalizeXunjiTrains({
        trains: await adapter.fetchTrainsForDate({
          apiKey,
          date: input.date,
        }),
        date: input.date,
        fetchedAt: now,
        planningTimeZone: tracker.planningTimeZone,
      }),
  });
}

export async function syncXunjiCatchUpBatch(input: {
  trackerKey: string;
  now?: Date;
  database?: Database;
  batchSize?: number;
}) {
  const now = input.now ?? new Date();
  const database = input.database ?? getDatabase();
  const tracker = await requireIntegrationTracker(input.trackerKey, database);
  const apiKey = await readIntegrationCredential({
    trackerId: tracker.id,
    provider: "xunji",
    database,
  });
  const adapter = createXunjiReadOnlyAdapter();
  const dateStore = createNeonProviderDateSyncStore(tracker.key, database);
  const today = localDateInTimeZone(now, tracker.planningTimeZone);

  return syncProviderCatchUpBatch({
    trackerId: tracker.id,
    provider: "xunji",
    startedOn: tracker.startedOn,
    today,
    now,
    batchSize: input.batchSize,
    store: createNeonProviderCatchUpStore(database),
    syncDate: (date) =>
      syncProviderDate({
        trackerId: tracker.id,
        provider: "xunji",
        date,
        now,
        store: dateStore,
        readSource: async () =>
          normalizeXunjiTrains({
            trains: await adapter.fetchTrainsForDate({ apiKey, date }),
            date,
            fetchedAt: now,
            planningTimeZone: tracker.planningTimeZone,
          }),
      }),
  });
}

export async function syncXunjiBoundedHistory(input: {
  trackerKey: string;
  days: ProviderHistoryDays;
  now?: Date;
  database?: Database;
  batchSize?: number;
}) {
  const now = input.now ?? new Date();
  const database = input.database ?? getDatabase();
  const tracker = await requireIntegrationTracker(input.trackerKey, database);
  const apiKey = await readIntegrationCredential({
    trackerId: tracker.id,
    provider: "xunji",
    database,
  });
  const adapter = createXunjiReadOnlyAdapter();
  const scope = "xunji_training_history" as const;
  const dateStore = createNeonProviderDateSyncStore(tracker.key, database, {
    stateProvider: scope,
  });
  return syncProviderHistoryBatch({
    trackerId: tracker.id,
    provider: "xunji",
    scope,
    days: input.days,
    today: localDateInTimeZone(now, tracker.planningTimeZone),
    now,
    batchSize: input.batchSize ?? 5,
    store: createNeonProviderHistoryStore(database),
    syncDate: (date) =>
      syncProviderDate({
        trackerId: tracker.id,
        provider: "xunji",
        date,
        now,
        store: dateStore,
        readSource: async () =>
          normalizeXunjiTrains({
            trains: await adapter.fetchTrainsForDate({ apiKey, date }),
            date,
            fetchedAt: now,
            planningTimeZone: tracker.planningTimeZone,
          }),
      }),
  });
}

export async function recoverXunjiHistory(input: {
  trackerKey: string;
  now?: Date;
  database?: Database;
  batchSize?: number;
}) {
  const now = input.now ?? new Date();
  const database = input.database ?? getDatabase();
  const tracker = await requireIntegrationTracker(input.trackerKey, database);
  const status = await getIntegrationStatus(tracker.key, "xunji", database);
  if (!status.configured) {
    return { status: "skipped" as const, reason: "not_connected" as const };
  }
  const recovery = await runAutomaticProviderRecovery({
    trackerId: tracker.id,
    provider: "xunji",
    now,
    minimumIntervalMs: 30 * 60_000,
    leaseMs: 2 * 60_000,
    store: createNeonAutomaticProviderRecoveryClaimStore(database),
    recover: () =>
      syncXunjiCatchUpBatch({
        trackerKey: tracker.key,
        now,
        database,
        batchSize: input.batchSize ?? 5,
      }),
  });
  return recovery.status === "completed"
    ? { status: "completed" as const, sync: recovery.result }
    : recovery;
}
