import "client-only";

import Dexie, { type EntityTable } from "dexie";

export const PRIVATE_OFFLINE_SCHEMA_VERSION = 2 as const;

export type QuerySnapshotKind = "today" | "calendar-month" | "day";

export interface QuerySnapshotRow {
  id: string;
  githubUserId: string;
  trackerKey: string;
  kind: QuerySnapshotKind;
  scope: string;
  schemaVersion: typeof PRIVATE_OFFLINE_SCHEMA_VERSION;
  savedAt: string;
  expiresAt: string;
  sourceVersion: string;
  data: unknown;
}

// P2a reserves this table boundary only. No offline command is enqueued or
// replayed until P2b defines the command lifecycle.
export interface PendingCommandRow {
  id: string;
  githubUserId: string;
  trackerKey: string;
  createdAt: string;
  kind: "reserved";
  payload: unknown;
}

export interface OfflineMetadataRow {
  key: string;
  value: string;
  updatedAt: string;
}

export class TrackerOfflineDatabase extends Dexie {
  querySnapshots!: EntityTable<QuerySnapshotRow, "id">;
  pendingCommands!: EntityTable<PendingCommandRow, "id">;
  metadata!: EntityTable<OfflineMetadataRow, "key">;

  constructor(name = "ak22ak-tracker") {
    super(name);
    this.version(1).stores({
      pendingEvents: "id, queuedAt",
      cachedPlans: "trackerKey, cachedAt",
    });
    this.version(PRIVATE_OFFLINE_SCHEMA_VERSION).stores({
      pendingEvents: null,
      cachedPlans: null,
      querySnapshots:
        "&id, [githubUserId+trackerKey+kind+scope], githubUserId, trackerKey, kind, savedAt, expiresAt",
      pendingCommands: "&id, githubUserId, trackerKey, createdAt",
      metadata: "&key, updatedAt",
    });
  }
}

export function createOfflineDatabase(name?: string) {
  return new TrackerOfflineDatabase(name);
}

export const offlineDatabase = createOfflineDatabase();
