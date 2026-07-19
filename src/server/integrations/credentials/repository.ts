import "server-only";

import { and, eq } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import {
  integrationCredentials,
  integrationSyncState,
  trackers,
} from "@/server/db/schema";

import {
  decryptIntegrationCredential,
  encryptIntegrationCredential,
  type EncryptedIntegrationCredential,
} from "./crypto";
import { getIntegrationEncryptionConfig } from "./config";
import { publicCredentialStatus } from "./public-status";

type Database = ReturnType<typeof getDatabase>;

export class IntegrationTrackerNotFoundError extends Error {
  constructor() {
    super("tracker_not_found");
    this.name = "IntegrationTrackerNotFoundError";
  }
}

export class IntegrationCredentialNotFoundError extends Error {
  constructor() {
    super("integration_credential_not_found");
    this.name = "IntegrationCredentialNotFoundError";
  }
}

export async function requireIntegrationTracker(
  trackerKey: string,
  database: Database = getDatabase(),
) {
  const [tracker] = await database
    .select({
      id: trackers.id,
      key: trackers.key,
      planningTimeZone: trackers.planningTimeZone,
    })
    .from(trackers)
    .where(and(eq(trackers.key, trackerKey), eq(trackers.active, true)))
    .limit(1);
  if (!tracker) throw new IntegrationTrackerNotFoundError();
  return tracker;
}

export async function getIntegrationStatus(
  trackerKey: string,
  provider: string,
  database: Database = getDatabase(),
) {
  const tracker = await requireIntegrationTracker(trackerKey, database);
  const [credential, sync] = await Promise.all([
    database
      .select({
        verifiedAt: integrationCredentials.verifiedAt,
        updatedAt: integrationCredentials.updatedAt,
      })
      .from(integrationCredentials)
      .where(
        and(
          eq(integrationCredentials.trackerId, tracker.id),
          eq(integrationCredentials.provider, provider),
        ),
      )
      .limit(1),
    database
      .select({
        status: integrationSyncState.status,
        lastAttemptAt: integrationSyncState.lastAttemptAt,
        lastSucceededAt: integrationSyncState.lastSucceededAt,
        lastErrorCode: integrationSyncState.lastErrorCode,
      })
      .from(integrationSyncState)
      .where(
        and(
          eq(integrationSyncState.trackerId, tracker.id),
          eq(integrationSyncState.provider, provider),
        ),
      )
      .limit(1),
  ]);
  const credentialRow = credential[0] ?? null;
  const syncRow = sync[0] ?? null;
  return {
    ...publicCredentialStatus({
      provider,
      configured: Boolean(credentialRow),
      verifiedAt: credentialRow?.verifiedAt ?? null,
      updatedAt: credentialRow?.updatedAt ?? null,
    }),
    sync: {
      status: syncRow?.status ?? "idle",
      lastAttemptAt: syncRow?.lastAttemptAt?.toISOString() ?? null,
      lastSucceededAt: syncRow?.lastSucceededAt?.toISOString() ?? null,
      lastErrorCode: syncRow?.lastErrorCode ?? null,
    },
  };
}

export async function saveIntegrationCredential(input: {
  trackerId: string;
  provider: string;
  plaintext: string;
  verifiedAt: Date;
  database?: Database;
}) {
  const database = input.database ?? getDatabase();
  const config = getIntegrationEncryptionConfig();
  const encrypted = encryptIntegrationCredential({
    plaintext: input.plaintext,
    provider: input.provider,
    ...config,
  });
  const now = new Date();
  await database
    .insert(integrationCredentials)
    .values({
      trackerId: input.trackerId,
      provider: input.provider,
      verifiedAt: input.verifiedAt,
      updatedAt: now,
      ...encrypted,
    })
    .onConflictDoUpdate({
      target: [
        integrationCredentials.trackerId,
        integrationCredentials.provider,
      ],
      set: { verifiedAt: input.verifiedAt, updatedAt: now, ...encrypted },
    });
}

export async function markIntegrationConnectionFailure(input: {
  trackerId: string;
  provider: string;
  failedAt: Date;
  errorCode: string;
  database?: Database;
}) {
  const database = input.database ?? getDatabase();
  const failed = {
    status: "failed" as const,
    lastAttemptAt: input.failedAt,
    lastErrorCode: input.errorCode,
    updatedAt: input.failedAt,
  };
  await database
    .insert(integrationSyncState)
    .values({
      trackerId: input.trackerId,
      provider: input.provider,
      ...failed,
    })
    .onConflictDoUpdate({
      target: [integrationSyncState.trackerId, integrationSyncState.provider],
      set: failed,
    });
}

export async function readIntegrationCredential(input: {
  trackerId: string;
  provider: string;
  database?: Database;
}) {
  const database = input.database ?? getDatabase();
  const [row] = await database
    .select({
      algorithm: integrationCredentials.algorithm,
      keyVersion: integrationCredentials.keyVersion,
      nonce: integrationCredentials.nonce,
      ciphertext: integrationCredentials.ciphertext,
      authTag: integrationCredentials.authTag,
    })
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.trackerId, input.trackerId),
        eq(integrationCredentials.provider, input.provider),
      ),
    )
    .limit(1);
  if (!row) throw new IntegrationCredentialNotFoundError();
  if (row.algorithm !== "aes-256-gcm") {
    throw new Error("integration_credential_algorithm_unsupported");
  }
  return decryptIntegrationCredential({
    encrypted: row as EncryptedIntegrationCredential,
    provider: input.provider,
    keyBase64: getIntegrationEncryptionConfig().keyBase64,
  });
}
