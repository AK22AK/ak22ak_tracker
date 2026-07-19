import "server-only";

import { localDateInTimeZone } from "@/domain/planning-time";
import { getDatabase } from "@/server/db/client";
import { createNeonProviderDateSyncStore } from "@/server/integrations/core/neon-date-sync-store";
import { syncProviderDate } from "@/server/integrations/core/sync-provider-date";
import { getIntegrationEncryptionConfig } from "@/server/integrations/credentials/config";
import {
  markIntegrationConnectionFailure,
  readIntegrationCredential,
  requireIntegrationTracker,
  saveIntegrationCredential,
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
