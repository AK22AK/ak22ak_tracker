import "client-only";

import Dexie, { type EntityTable } from "dexie";

import type { PendingCommand } from "./command-contracts";

export const PRIVATE_OFFLINE_DATABASE_VERSION = 3 as const;
export const PRIVATE_OFFLINE_SNAPSHOT_SCHEMA_VERSION = 2 as const;

export type QuerySnapshotKind = "today" | "calendar-month" | "day";

export interface QuerySnapshotRow {
  id: string;
  githubUserId: string;
  trackerKey: string;
  kind: QuerySnapshotKind;
  scope: string;
  schemaVersion: typeof PRIVATE_OFFLINE_SNAPSHOT_SCHEMA_VERSION;
  savedAt: string;
  expiresAt: string;
  sourceVersion: string;
  data: unknown;
}

export interface SafetyPolicyRow {
  id: string;
  githubUserId: string;
  trackerKey: string;
  policyId: string;
  version: number;
  hash: string;
  savedAt: string;
  expiresAt: string;
  data: unknown;
}

export interface OfflineMetadataRow {
  key: string;
  value: string;
  updatedAt: string;
}

export class TrackerOfflineDatabase extends Dexie {
  querySnapshots!: EntityTable<QuerySnapshotRow, "id">;
  pendingCommands!: EntityTable<PendingCommand, "id">;
  safetyPolicies!: EntityTable<SafetyPolicyRow, "id">;
  metadata!: EntityTable<OfflineMetadataRow, "key">;

  constructor(name = "ak22ak-tracker") {
    super(name);
    this.version(1).stores({
      pendingEvents: "id, queuedAt",
      cachedPlans: "trackerKey, cachedAt",
    });
    this.version(PRIVATE_OFFLINE_SNAPSHOT_SCHEMA_VERSION).stores({
      pendingEvents: null,
      cachedPlans: null,
      querySnapshots:
        "&id, [githubUserId+trackerKey+kind+scope], githubUserId, trackerKey, kind, savedAt, expiresAt",
      pendingCommands: "&id, githubUserId, trackerKey, createdAt",
      metadata: "&key, updatedAt",
    });
    this.version(PRIVATE_OFFLINE_DATABASE_VERSION)
      .stores({
        querySnapshots:
          "&id, [githubUserId+trackerKey+kind+scope], githubUserId, trackerKey, kind, savedAt, expiresAt",
        pendingCommands:
          "&id, [githubUserId+trackerKey], githubUserId, trackerKey, status, createdAt, nextAttemptAt",
        safetyPolicies:
          "&id, [githubUserId+trackerKey+policyId+version], githubUserId, trackerKey, policyId, version, expiresAt",
        metadata: "&key, updatedAt",
      })
      .upgrade(async (transaction) => {
        // P2a reserved this table but never wrote commands. Clear any
        // unsupported scaffold rows before enabling the versioned outbox.
        await transaction.table("pendingCommands").clear();
      });
  }
}

export function createOfflineDatabase(name?: string) {
  return new TrackerOfflineDatabase(name);
}

export const offlineDatabase = createOfflineDatabase();
