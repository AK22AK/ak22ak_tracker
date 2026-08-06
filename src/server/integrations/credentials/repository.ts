import "server-only";

import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";

import { localDateSchema } from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import {
  integrationCredentials,
  integrationDateSyncState,
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
import {
  cooldownFromDeadline,
  type ProviderCooldownTimestamp,
  type ProviderCooldown,
  type ProviderCooldownClaim,
} from "../core/provider-cooldown";

type Database = ReturnType<typeof getDatabase>;

function catchUpCursorDate(value: unknown) {
  if (
    typeof value !== "object" ||
    value === null ||
    !("kind" in value) ||
    value.kind !== "date_catch_up_v1" ||
    !("nextDate" in value) ||
    typeof value.nextDate !== "string" ||
    !localDateSchema.safeParse(value.nextDate).success
  ) {
    return null;
  }
  return value.nextDate;
}

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

export type IntegrationCredentialOperationClaim =
  { status: "claimed"; plaintext: string } | { status: "busy" };

export async function requireIntegrationTracker(
  trackerKey: string,
  database: Database = getDatabase(),
) {
  const [tracker] = await database
    .select({
      id: trackers.id,
      key: trackers.key,
      startedOn: trackers.startedOn,
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
  const serverNow = new Date();
  const tracker = await requireIntegrationTracker(trackerKey, database);
  const [credential, latestSuccessfulDate, sync] = await Promise.all([
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
      .select({ localDate: integrationDateSyncState.localDate })
      .from(integrationDateSyncState)
      .where(
        and(
          eq(integrationDateSyncState.trackerId, tracker.id),
          eq(integrationDateSyncState.provider, provider),
          eq(integrationDateSyncState.status, "succeeded"),
        ),
      )
      .orderBy(desc(integrationDateSyncState.localDate))
      .limit(1),
    database
      .select({
        status: integrationSyncState.status,
        lastAttemptAt: integrationSyncState.lastAttemptAt,
        lastSucceededAt: integrationSyncState.lastSucceededAt,
        cursor: integrationSyncState.cursor,
        lastErrorCode: integrationSyncState.lastErrorCode,
        cooldownUntil: integrationSyncState.cooldownUntil,
        cooldownKind: integrationSyncState.cooldownKind,
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
  const cooldown = syncRow ? providerCooldownFromRow(syncRow, serverNow) : null;
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
      lastSucceededDate: latestSuccessfulDate[0]?.localDate ?? null,
      nextCursor: catchUpCursorDate(syncRow?.cursor),
      lastErrorCode: syncRow?.lastErrorCode ?? null,
      cooldown: cooldown
        ? {
            kind: cooldown.kind,
            retryAvailableAt: cooldown.retryAvailableAt.toISOString(),
            retryAfterMs: cooldown.retryAfterMs,
            serverNow: cooldown.serverNow.toISOString(),
          }
        : null,
    },
  };
}

export async function saveIntegrationCredential(input: {
  trackerId: string;
  provider: string;
  plaintext: string;
  verifiedAt: Date | null;
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
      set: {
        verifiedAt: input.verifiedAt,
        updatedAt: now,
        operationLeaseOwner: null,
        operationLeaseExpiresAt: null,
        ...encrypted,
      },
    });
}

export async function saveIntegrationCredentialAndResetState(input: {
  trackerId: string;
  provider: string;
  plaintext: string;
  verifiedAt: Date | null;
  attemptedAt: Date | null;
  now: Date;
  database?: Database;
}) {
  const database = input.database ?? getDatabase();
  const encrypted = encryptIntegrationCredential({
    plaintext: input.plaintext,
    provider: input.provider,
    ...getIntegrationEncryptionConfig(),
  });
  const reset = {
    status: "idle" as const,
    lastAttemptAt: input.attemptedAt,
    cursor: null,
    lastErrorCode: null,
    updatedAt: input.now,
  };
  await database.batch([
    database
      .insert(integrationCredentials)
      .values({
        trackerId: input.trackerId,
        provider: input.provider,
        verifiedAt: input.verifiedAt,
        updatedAt: input.now,
        ...encrypted,
      })
      .onConflictDoUpdate({
        target: [
          integrationCredentials.trackerId,
          integrationCredentials.provider,
        ],
        set: {
          verifiedAt: input.verifiedAt,
          updatedAt: input.now,
          operationLeaseOwner: null,
          operationLeaseExpiresAt: null,
          ...encrypted,
        },
      }),
    database
      .insert(integrationSyncState)
      .values({
        trackerId: input.trackerId,
        provider: input.provider,
        ...reset,
      })
      .onConflictDoUpdate({
        target: [integrationSyncState.trackerId, integrationSyncState.provider],
        set: reset,
      }),
  ]);
}

export async function claimIntegrationCredentialOperation(input: {
  trackerId: string;
  provider: string;
  owner: string;
  claimedAt: Date;
  expiresAt: Date;
  database?: Database;
}): Promise<IntegrationCredentialOperationClaim> {
  if (input.expiresAt <= input.claimedAt) {
    throw new Error("integration_operation_lease_expiry_invalid");
  }
  const database = input.database ?? getDatabase();
  const [claimed] = await database
    .update(integrationCredentials)
    .set({
      operationLeaseOwner: input.owner,
      operationLeaseExpiresAt: input.expiresAt,
    })
    .where(
      and(
        eq(integrationCredentials.trackerId, input.trackerId),
        eq(integrationCredentials.provider, input.provider),
        or(
          isNull(integrationCredentials.operationLeaseOwner),
          isNull(integrationCredentials.operationLeaseExpiresAt),
          lte(integrationCredentials.operationLeaseExpiresAt, input.claimedAt),
        ),
      ),
    )
    .returning({
      algorithm: integrationCredentials.algorithm,
      keyVersion: integrationCredentials.keyVersion,
      nonce: integrationCredentials.nonce,
      ciphertext: integrationCredentials.ciphertext,
      authTag: integrationCredentials.authTag,
    });
  if (claimed) {
    if (claimed.algorithm !== "aes-256-gcm") {
      throw new Error("integration_credential_algorithm_unsupported");
    }
    return {
      status: "claimed",
      plaintext: decryptIntegrationCredential({
        encrypted: claimed as EncryptedIntegrationCredential,
        provider: input.provider,
        keyBase64: getIntegrationEncryptionConfig().keyBase64,
      }),
    };
  }
  const [credential] = await database
    .select({ id: integrationCredentials.id })
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.trackerId, input.trackerId),
        eq(integrationCredentials.provider, input.provider),
      ),
    )
    .limit(1);
  if (!credential) throw new IntegrationCredentialNotFoundError();
  return { status: "busy" };
}

export async function saveIntegrationCredentialUnderOperationLease(input: {
  trackerId: string;
  provider: string;
  owner: string;
  plaintext: string;
  verifiedAt: Date;
  savedAt: Date;
  expiresAt: Date;
  database?: Database;
}) {
  if (input.expiresAt <= input.savedAt) {
    throw new Error("integration_operation_lease_expiry_invalid");
  }
  const database = input.database ?? getDatabase();
  const encrypted = encryptIntegrationCredential({
    plaintext: input.plaintext,
    provider: input.provider,
    ...getIntegrationEncryptionConfig(),
  });
  const rows = await database
    .update(integrationCredentials)
    .set({
      verifiedAt: input.verifiedAt,
      updatedAt: input.savedAt,
      operationLeaseExpiresAt: input.expiresAt,
      ...encrypted,
    })
    .where(
      and(
        eq(integrationCredentials.trackerId, input.trackerId),
        eq(integrationCredentials.provider, input.provider),
        eq(integrationCredentials.operationLeaseOwner, input.owner),
        gt(integrationCredentials.operationLeaseExpiresAt, input.savedAt),
      ),
    )
    .returning({ id: integrationCredentials.id });
  return rows.length === 1;
}

export async function releaseIntegrationCredentialOperation(input: {
  trackerId: string;
  provider: string;
  owner: string;
  database?: Database;
}) {
  const database = input.database ?? getDatabase();
  const rows = await database
    .update(integrationCredentials)
    .set({ operationLeaseOwner: null, operationLeaseExpiresAt: null })
    .where(
      and(
        eq(integrationCredentials.trackerId, input.trackerId),
        eq(integrationCredentials.provider, input.provider),
        eq(integrationCredentials.operationLeaseOwner, input.owner),
      ),
    )
    .returning({ id: integrationCredentials.id });
  return rows.length === 1;
}

function providerCooldownFromRow(
  row: {
    cooldownUntil: ProviderCooldownTimestamp | null;
    cooldownKind: string | null;
  },
  serverNow: Date,
): ProviderCooldown | null {
  if (row.cooldownUntil === null) {
    return null;
  }
  if (row.cooldownKind !== "normal" && row.cooldownKind !== "rate_limited") {
    throw new Error("provider_cooldown_kind_invalid");
  }
  const cooldown = cooldownFromDeadline({
    kind: row.cooldownKind,
    retryAvailableAt: row.cooldownUntil,
    serverNow,
  });
  if (cooldown.retryAvailableAt <= cooldown.serverNow) return null;
  return cooldown;
}

export async function claimIntegrationProviderCooldown(input: {
  trackerId: string;
  provider: string;
  claimedAt: Date;
  cooldownUntil: Date;
  database?: Database;
}): Promise<ProviderCooldownClaim> {
  const database = input.database ?? getDatabase();
  const result = await database.execute<{
    cooldownUntil: Date;
    cooldownKind: string;
  }>(sql`
    insert into integration_sync_state (
      id, tracker_id, provider, status, cooldown_until, cooldown_kind, updated_at
    ) values (
      gen_random_uuid(), ${input.trackerId}::uuid, ${input.provider}, 'idle',
      ${input.cooldownUntil}, 'normal', ${input.claimedAt}
    )
    on conflict (tracker_id, provider) do update set
      cooldown_until = excluded.cooldown_until,
      cooldown_kind = excluded.cooldown_kind,
      updated_at = excluded.updated_at
    where integration_sync_state.cooldown_until is null
       or integration_sync_state.cooldown_until <= ${input.claimedAt}
    returning cooldown_until as "cooldownUntil", cooldown_kind as "cooldownKind"
  `);
  const claimed = result.rows[0];
  if (claimed) {
    const cooldown = providerCooldownFromRow(
      {
        cooldownUntil: claimed.cooldownUntil,
        cooldownKind: claimed.cooldownKind,
      },
      input.claimedAt,
    );
    if (!cooldown) throw new Error("provider_cooldown_claim_invalid");
    return {
      status: "claimed",
      cooldown,
    };
  }
  const [current] = await database
    .select({
      cooldownUntil: integrationSyncState.cooldownUntil,
      cooldownKind: integrationSyncState.cooldownKind,
    })
    .from(integrationSyncState)
    .where(
      and(
        eq(integrationSyncState.trackerId, input.trackerId),
        eq(integrationSyncState.provider, input.provider),
      ),
    )
    .limit(1);
  const cooldown = current
    ? providerCooldownFromRow(current, input.claimedAt)
    : null;
  if (!cooldown) {
    throw new Error("provider_cooldown_claim_lost");
  }
  return { status: "cooldown", cooldown };
}

export async function extendIntegrationProviderCooldown(input: {
  trackerId: string;
  provider: string;
  now: Date;
  cooldownUntil: Date;
  database?: Database;
}): Promise<ProviderCooldown> {
  const database = input.database ?? getDatabase();
  const result = await database.execute<{
    cooldownUntil: Date;
    cooldownKind: string;
  }>(sql`
    update integration_sync_state
    set cooldown_until = case
          when cooldown_until is null or cooldown_until < ${input.cooldownUntil}
            then ${input.cooldownUntil}
          else cooldown_until
        end,
        cooldown_kind = case
          when cooldown_until is null or cooldown_until < ${input.cooldownUntil}
            then 'rate_limited'
          else cooldown_kind
        end,
        updated_at = ${input.now}
    where tracker_id = ${input.trackerId}::uuid
      and provider = ${input.provider}
    returning cooldown_until as "cooldownUntil", cooldown_kind as "cooldownKind"
  `);
  const row = result.rows[0];
  if (!row) throw new Error("provider_cooldown_extend_missing");
  const cooldown = providerCooldownFromRow(row, input.now);
  if (!cooldown) throw new Error("provider_cooldown_extend_invalid");
  return cooldown;
}

export async function markIntegrationConnectionFailureUnderOperationLease(input: {
  trackerId: string;
  provider: string;
  owner: string;
  failedAt: Date;
  errorCode: string;
  database?: Database;
}) {
  const database = input.database ?? getDatabase();
  const result = await database.execute(sql`
    insert into integration_sync_state (
      id, tracker_id, provider, status, last_attempt_at, last_error_code, updated_at
    )
    select
      gen_random_uuid(), ${input.trackerId}::uuid, ${input.provider}, 'failed',
      ${input.failedAt}, ${input.errorCode}, ${input.failedAt}
    from integration_credentials
    where tracker_id = ${input.trackerId}::uuid
      and provider = ${input.provider}
      and operation_lease_owner = ${input.owner}
      and operation_lease_expires_at > ${input.failedAt}
    on conflict (tracker_id, provider) do update set
      status = 'failed',
      last_attempt_at = excluded.last_attempt_at,
      last_error_code = excluded.last_error_code,
      updated_at = excluded.updated_at
    returning id
  `);
  return result.rows.length === 1;
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

export async function markIntegrationConnectionSuccess(input: {
  trackerId: string;
  provider: string;
  succeededAt: Date;
  database?: Database;
}) {
  const database = input.database ?? getDatabase();
  const succeeded = {
    status: "succeeded" as const,
    lastAttemptAt: input.succeededAt,
    lastSucceededAt: input.succeededAt,
    lastErrorCode: null,
    updatedAt: input.succeededAt,
  };
  await database
    .insert(integrationSyncState)
    .values({
      trackerId: input.trackerId,
      provider: input.provider,
      cursor: null,
      ...succeeded,
    })
    .onConflictDoUpdate({
      target: [integrationSyncState.trackerId, integrationSyncState.provider],
      set: succeeded,
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
