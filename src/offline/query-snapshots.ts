import "client-only";

import type { ZodType } from "zod";

import {
  offlineCalendarSnapshotSchema,
  offlineDaySnapshotSchema,
  offlineTodaySnapshotSchema,
} from "./snapshot-contracts";
import {
  PRIVATE_OFFLINE_SNAPSHOT_SCHEMA_VERSION,
  type QuerySnapshotKind,
  type QuerySnapshotRow,
  type TrackerOfflineDatabase,
} from "./store";

const immutableGithubUserId = /^\d+$/;

const schemas: Record<QuerySnapshotKind, ZodType> = {
  today: offlineTodaySnapshotSchema,
  "calendar-month": offlineCalendarSnapshotSchema,
  day: offlineDaySnapshotSchema,
};

export const querySnapshotLifetimeMs: Record<QuerySnapshotKind, number> = {
  today: 7 * 24 * 60 * 60 * 1_000,
  "calendar-month": 35 * 24 * 60 * 60 * 1_000,
  day: 35 * 24 * 60 * 60 * 1_000,
};

function assertIdentity(githubUserId: string) {
  if (!immutableGithubUserId.test(githubUserId)) {
    throw new Error("invalid_immutable_github_user_id");
  }
}

function snapshotId(input: {
  githubUserId: string;
  trackerKey: string;
  kind: QuerySnapshotKind;
  scope: string;
}) {
  return [input.githubUserId, input.trackerKey, input.kind, input.scope].join(
    ":",
  );
}

export function createQuerySnapshotRow<T>(
  input: Omit<QuerySnapshotRow, "id" | "schemaVersion" | "data"> & {
    data: T;
  },
): QuerySnapshotRow {
  assertIdentity(input.githubUserId);
  return {
    ...input,
    id: snapshotId(input),
    schemaVersion: PRIVATE_OFFLINE_SNAPSHOT_SCHEMA_VERSION,
    data: schemas[input.kind].parse(input.data),
  };
}

export async function prepareOfflineIdentity(
  database: TrackerOfflineDatabase,
  githubUserId: string,
) {
  assertIdentity(githubUserId);
  await database.transaction(
    "rw",
    database.metadata,
    database.querySnapshots,
    database.pendingCommands,
    database.safetyPolicies,
    async () => {
      const current = await database.metadata.get("active-identity");
      if (current && current.value !== githubUserId) {
        await database.querySnapshots.clear();
        await database.pendingCommands.clear();
        await database.safetyPolicies.clear();
        await database.metadata.clear();
      }
      await database.metadata.put({
        key: "active-identity",
        value: githubUserId,
        updatedAt: new Date().toISOString(),
      });
    },
  );
}

export async function clearOfflinePrivateData(
  database: TrackerOfflineDatabase,
) {
  await database.transaction(
    "rw",
    database.metadata,
    database.querySnapshots,
    database.pendingCommands,
    database.safetyPolicies,
    async () => {
      await Promise.all([
        database.metadata.clear(),
        database.querySnapshots.clear(),
        database.pendingCommands.clear(),
        database.safetyPolicies.clear(),
      ]);
    },
  );
}

export async function saveQuerySnapshot<T>(
  database: TrackerOfflineDatabase,
  input: Omit<QuerySnapshotRow, "id" | "schemaVersion" | "data"> & {
    data: T;
  },
) {
  await database.querySnapshots.put(createQuerySnapshotRow(input));
}

export async function readQuerySnapshot(
  database: TrackerOfflineDatabase,
  input: {
    githubUserId: string;
    trackerKey: string;
    kind: QuerySnapshotKind;
    scope: string;
    now?: Date;
  },
) {
  assertIdentity(input.githubUserId);
  const id = snapshotId(input);
  const row = await database.querySnapshots.get(id);
  if (!row) return null;
  if (
    row.githubUserId !== input.githubUserId ||
    row.schemaVersion !== PRIVATE_OFFLINE_SNAPSHOT_SCHEMA_VERSION ||
    Date.parse(row.expiresAt) <= (input.now ?? new Date()).getTime()
  ) {
    await database.querySnapshots.delete(id);
    return null;
  }
  const result = schemas[row.kind].safeParse(row.data);
  if (!result.success) {
    await database.querySnapshots.delete(id);
    return null;
  }
  return { ...row, data: result.data };
}
