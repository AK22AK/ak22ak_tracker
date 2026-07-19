import "client-only";

import {
  OFFLINE_COMMAND_SCHEMA_VERSION,
  pendingCommandInputSchema,
  pendingCommandSchema,
  type PendingCommand,
  type PendingCommandInput,
} from "./command-contracts";
import {
  isCommandCountReflectedInDashboard,
  projectCalendarCanonicalCommand,
  projectDayPendingCommands,
  projectTodayPendingCommands,
} from "./command-projection";
import type { CanonicalCommandResult } from "./replay";
import {
  offlineCalendarSnapshotSchema,
  offlineDaySnapshotSchema,
  offlineTodaySnapshotSchema,
} from "./snapshot-contracts";
import type { TrackerOfflineDatabase } from "./store";

function commandIntent(command: PendingCommand) {
  return {
    id: command.id,
    schemaVersion: command.schemaVersion,
    githubUserId: command.githubUserId,
    trackerKey: command.trackerKey,
    kind: command.kind,
    createdAt: command.createdAt,
    occurredAt: command.occurredAt,
    localDate: command.localDate,
    occurredTimeZone: command.occurredTimeZone,
    occurredUtcOffsetMinutes: command.occurredUtcOffsetMinutes,
    sourceVersion: command.sourceVersion,
    payload: command.payload,
  };
}

function sameCommandIntent(left: PendingCommand, right: PendingCommand) {
  return (
    JSON.stringify(commandIntent(left)) === JSON.stringify(commandIntent(right))
  );
}

export async function enqueuePendingCommand(
  database: TrackerOfflineDatabase,
  value: PendingCommandInput,
) {
  const input = pendingCommandInputSchema.parse(value);
  const command = pendingCommandSchema.parse({
    ...input,
    schemaVersion: OFFLINE_COMMAND_SCHEMA_VERSION,
    attemptCount: 0,
    nextAttemptAt: input.createdAt,
    lastAttemptAt: null,
    lastErrorCode: null,
    status: "local_only",
    sourceVersion: input.sourceVersion ?? null,
  });

  return database.transaction(
    "rw",
    database.metadata,
    database.pendingCommands,
    async () => {
      const identity = await database.metadata.get("active-identity");
      if (identity?.value !== command.githubUserId) {
        throw new Error("offline_identity_mismatch");
      }
      const existing = await database.pendingCommands.get(command.id);
      if (existing) {
        if (!sameCommandIntent(existing, command)) {
          throw new Error("offline_command_conflict");
        }
        return existing;
      }
      await database.pendingCommands.add(command);
      return command;
    },
  );
}

export async function listPendingCommands(
  database: TrackerOfflineDatabase,
  githubUserId: string,
  trackerKey: string,
) {
  const rows = await database.pendingCommands
    .where("[githubUserId+trackerKey]")
    .equals([githubUserId, trackerKey])
    .toArray();
  return rows
    .flatMap((row) => {
      const parsed = pendingCommandSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    })
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
}

export function canonicalProjectionCommand(
  command: PendingCommand,
  result: CanonicalCommandResult,
) {
  if (command.kind === "symptom_check_in") {
    if (result.kind !== "symptom_check_in") {
      throw new Error("canonical_command_mismatch");
    }
    return pendingCommandSchema.parse({
      ...command,
      payload: {
        ...command.payload,
        localSafetyLevel: result.safetyLevel,
        clientSafetyPolicy: result.safetyPolicy,
      },
    });
  }
  if (result.kind !== "task_update") {
    throw new Error("canonical_command_mismatch");
  }
  return command;
}

export async function finalizePendingCommandSuccess(
  database: TrackerOfflineDatabase,
  input: {
    githubUserId: string;
    trackerKey: string;
    command: PendingCommand;
    result: CanonicalCommandResult;
    savedAt?: string;
  },
) {
  const projectedCommand = canonicalProjectionCommand(
    input.command,
    input.result,
  );
  const savedAt = input.savedAt ?? new Date().toISOString();
  await database.transaction(
    "rw",
    database.metadata,
    database.querySnapshots,
    database.pendingCommands,
    async () => {
      const identity = await database.metadata.get("active-identity");
      if (identity?.value !== input.githubUserId) {
        throw new Error("offline_identity_mismatch");
      }
      const current = await database.pendingCommands.get(input.command.id);
      if (!current) return;
      const rows = await database.querySnapshots
        .where("[githubUserId+trackerKey+kind+scope]")
        .between(
          [input.githubUserId, input.trackerKey, "", ""],
          [input.githubUserId, input.trackerKey, "\uffff", "\uffff"],
        )
        .toArray();
      const detailedDashboard = rows.flatMap((row) => {
        if (row.scope !== input.command.localDate) return [];
        if (row.kind === "today") {
          const parsed = offlineTodaySnapshotSchema.safeParse(row.data);
          return parsed.success ? [parsed.data.day] : [];
        }
        if (row.kind === "day") {
          const parsed = offlineDaySnapshotSchema.safeParse(row.data);
          return parsed.success ? [parsed.data.day] : [];
        }
        return [];
      })[0];
      const countAlreadyReflected = detailedDashboard
        ? isCommandCountReflectedInDashboard(detailedDashboard, input.command)
        : null;
      for (const row of rows) {
        let data: unknown = null;
        if (row.kind === "today" && row.scope === input.command.localDate) {
          const parsed = offlineTodaySnapshotSchema.safeParse(row.data);
          if (parsed.success) {
            data = projectTodayPendingCommands(parsed.data, [
              projectedCommand,
            ]).data;
          }
        } else if (
          row.kind === "day" &&
          row.scope === input.command.localDate
        ) {
          const parsed = offlineDaySnapshotSchema.safeParse(row.data);
          if (parsed.success) {
            data = projectDayPendingCommands(parsed.data, [
              projectedCommand,
            ]).data;
          }
        } else if (
          row.kind === "calendar-month" &&
          row.scope === input.command.localDate.slice(0, 7)
        ) {
          const parsed = offlineCalendarSnapshotSchema.safeParse(row.data);
          if (parsed.success && countAlreadyReflected === false) {
            data = projectCalendarCanonicalCommand(
              parsed.data,
              projectedCommand,
            );
          }
        }
        if (data !== null) {
          await database.querySnapshots.put({
            ...row,
            savedAt,
            sourceVersion: `${row.sourceVersion};command:${input.command.id}`,
            data,
          });
        }
      }
      await database.pendingCommands.delete(input.command.id);
    },
  );
}
