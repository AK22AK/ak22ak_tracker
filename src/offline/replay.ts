import "client-only";

import { z } from "zod";

import { pendingCommandSchema, type PendingCommand } from "./command-contracts";
import { listPendingCommands } from "./pending-commands";
import type { TrackerOfflineDatabase } from "./store";

const LEASE_DURATION_MS = 30_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

export class PendingCommandTransportError extends Error {
  constructor(
    readonly safeCode: string,
    readonly httpStatus: number | null = null,
  ) {
    super(safeCode);
    this.name = "PendingCommandTransportError";
  }
}

const canonicalTaskResultSchema = z
  .object({
    kind: z.literal("task_update"),
    commandId: z.uuid(),
    status: z.enum(["planned", "completed", "skipped"]),
    replayed: z.boolean(),
  })
  .strict();

const canonicalFeedbackResultSchema = z
  .object({
    kind: z.literal("symptom_check_in"),
    commandId: z.uuid(),
    id: z.uuid(),
    safetyLevel: z.enum(["green", "yellow", "red"]),
    replayed: z.boolean(),
    safetyPolicy: z
      .object({
        policyId: z.uuid(),
        version: z.number().int().positive(),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    clientPolicyOutdated: z.boolean(),
  })
  .strict();

export const canonicalCommandResultSchema = z.discriminatedUnion("kind", [
  canonicalTaskResultSchema,
  canonicalFeedbackResultSchema,
]);

export type CanonicalCommandResult = z.infer<
  typeof canonicalCommandResultSchema
>;

interface ReplayOptions {
  githubUserId: string;
  trackerKey: string;
  ownerId: string;
  force?: boolean;
  now?: () => Date;
  send: (command: PendingCommand) => Promise<CanonicalCommandResult>;
  onCanonicalSuccess?: (
    command: PendingCommand,
    result: CanonicalCommandResult,
  ) => Promise<void>;
  onCommandStateChange?: (command: PendingCommand) => Promise<void>;
}

interface ReplayLease {
  ownerId: string;
  expiresAt: string;
}

function leaseKey(githubUserId: string, trackerKey: string) {
  return `command-replay-lease:${githubUserId}:${trackerKey}`;
}

function classifyReplayError(error: unknown, attemptCount: number) {
  if (error instanceof PendingCommandTransportError) {
    if (error.httpStatus === 401 || error.httpStatus === 403) {
      return {
        status: "waiting_auth" as const,
        code: error.safeCode,
        delayMs: 0,
      };
    }
    if (
      error.httpStatus !== null &&
      error.httpStatus >= 400 &&
      error.httpStatus < 500
    ) {
      return {
        status: "needs_attention" as const,
        code: error.safeCode,
        delayMs: 0,
      };
    }
    return {
      status: "retryable" as const,
      code: error.safeCode,
      delayMs: Math.min(5_000 * 2 ** (attemptCount - 1), MAX_RETRY_DELAY_MS),
    };
  }
  const isTimeout =
    error instanceof DOMException && error.name === "AbortError";
  return {
    status: "retryable" as const,
    code: isTimeout ? "timeout" : "network_error",
    delayMs: Math.min(5_000 * 2 ** (attemptCount - 1), MAX_RETRY_DELAY_MS),
  };
}

function parseLease(value: string): ReplayLease | null {
  try {
    const parsed = JSON.parse(value) as Partial<ReplayLease>;
    if (
      typeof parsed.ownerId === "string" &&
      typeof parsed.expiresAt === "string" &&
      Number.isFinite(Date.parse(parsed.expiresAt))
    ) {
      return { ownerId: parsed.ownerId, expiresAt: parsed.expiresAt };
    }
  } catch {
    // A damaged lease is treated as expired and replaced below.
  }
  return null;
}

async function acquireLease(
  database: TrackerOfflineDatabase,
  options: ReplayOptions,
  now: Date,
) {
  const key = leaseKey(options.githubUserId, options.trackerKey);
  return database.transaction("rw", database.metadata, async () => {
    const existing = await database.metadata.get(key);
    const lease = existing ? parseLease(existing.value) : null;
    if (
      lease &&
      lease.ownerId !== options.ownerId &&
      Date.parse(lease.expiresAt) > now.getTime()
    ) {
      return false;
    }
    const expiresAt = new Date(now.getTime() + LEASE_DURATION_MS).toISOString();
    await database.metadata.put({
      key,
      value: JSON.stringify({ ownerId: options.ownerId, expiresAt }),
      updatedAt: now.toISOString(),
    });
    return true;
  });
}

async function releaseLease(
  database: TrackerOfflineDatabase,
  options: ReplayOptions,
) {
  const key = leaseKey(options.githubUserId, options.trackerKey);
  await database.transaction("rw", database.metadata, async () => {
    const existing = await database.metadata.get(key);
    const lease = existing ? parseLease(existing.value) : null;
    if (lease?.ownerId === options.ownerId) {
      await database.metadata.delete(key);
    }
  });
}

export async function replayPendingCommands(
  database: TrackerOfflineDatabase,
  options: ReplayOptions,
) {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  if (!(await acquireLease(database, options, startedAt))) {
    return { acquired: false, sent: 0, succeeded: 0, failed: 0 };
  }

  let sent = 0;
  let succeeded = 0;
  let failed = 0;
  try {
    const commands = await listPendingCommands(
      database,
      options.githubUserId,
      options.trackerKey,
    );
    for (const command of commands) {
      if (
        command.status === "needs_attention" ||
        (command.status === "waiting_auth" && !options.force)
      ) {
        break;
      }
      if (
        !options.force &&
        Date.parse(command.nextAttemptAt) > startedAt.getTime()
      ) {
        break;
      }

      if (!(await acquireLease(database, options, now()))) break;

      const attemptedAt = now().toISOString();
      const syncing = pendingCommandSchema.parse({
        ...command,
        status: "syncing",
        attemptCount: command.attemptCount + 1,
        lastAttemptAt: attemptedAt,
        lastErrorCode: null,
      });
      await database.pendingCommands.put(syncing);
      await options.onCommandStateChange?.(syncing);
      sent += 1;

      try {
        const canonical = canonicalCommandResultSchema.parse(
          await options.send(syncing),
        );
        if (
          canonical.commandId !== syncing.id ||
          canonical.kind !== syncing.kind
        ) {
          throw new Error("canonical_command_mismatch");
        }
        await options.onCanonicalSuccess?.(syncing, canonical);
        await database.pendingCommands.delete(syncing.id);
        succeeded += 1;
      } catch (error) {
        failed += 1;
        const failure = classifyReplayError(error, syncing.attemptCount);
        const failedCommand = pendingCommandSchema.parse({
          ...syncing,
          status: failure.status,
          nextAttemptAt: new Date(
            now().getTime() + failure.delayMs,
          ).toISOString(),
          lastErrorCode: failure.code,
        });
        await database.pendingCommands.put(failedCommand);
        await options.onCommandStateChange?.(failedCommand);
        break;
      }
    }
  } finally {
    await releaseLease(database, options);
  }

  return { acquired: true, sent, succeeded, failed };
}
