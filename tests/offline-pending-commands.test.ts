// @vitest-environment node

import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  enqueuePendingCommand,
  listPendingCommands,
} from "@/offline/pending-commands";
import {
  PendingCommandTransportError,
  replayPendingCommands,
} from "@/offline/replay";
import { prepareOfflineIdentity } from "@/offline/query-snapshots";
import {
  createOfflineDatabase,
  type TrackerOfflineDatabase,
} from "@/offline/store";

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

const databases: TrackerOfflineDatabase[] = [];

function database() {
  const instance = createOfflineDatabase(
    `ak-tracker-commands-${crypto.randomUUID()}`,
  );
  databases.push(instance);
  return instance;
}

const commandId = "019c0000-0000-7000-8000-000000000301";

function taskCommand(status: "planned" | "completed" = "completed") {
  return {
    id: commandId,
    githubUserId: "10001",
    trackerKey: "knee-rehab",
    kind: "task_update" as const,
    createdAt: "2026-07-20T10:00:00.000Z",
    occurredAt: "2026-07-20T10:00:00.000Z",
    localDate: "2026-07-20",
    occurredTimeZone: "Asia/Shanghai",
    occurredUtcOffsetMinutes: 480,
    payload: {
      taskId: "019c0000-0000-7000-8000-000000000302",
      status,
      actual: {
        kind: "general" as const,
        exercises: [],
        durationMinutes: null,
        distanceKm: null,
        summary: "Anonymous offline training",
      },
      note: "Anonymous note",
      baseStatus: "planned" as const,
      planVersion: 1,
    },
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((instance) => instance.delete()));
});

describe("P2b-1 pending command write-ahead", () => {
  it("persists a versioned task command before networking and reuses the same idempotent command", async () => {
    const db = database();
    await prepareOfflineIdentity(db, "10001");

    const first = await enqueuePendingCommand(db, taskCommand());
    const replay = await enqueuePendingCommand(db, taskCommand());

    expect(replay).toEqual(first);
    expect(await listPendingCommands(db, "10001", "knee-rehab")).toEqual([
      expect.objectContaining({
        id: commandId,
        schemaVersion: 1,
        status: "local_only",
        attemptCount: 0,
        nextAttemptAt: "2026-07-20T10:00:00.000Z",
        lastErrorCode: null,
      }),
    ]);
    expect(JSON.stringify(first)).not.toMatch(
      /authorization|cookie|api.?key|raw.?payload/i,
    );

    await expect(
      enqueuePendingCommand(db, taskCommand("planned")),
    ).rejects.toThrow("offline_command_conflict");
  });

  it("reuses the same immutable command intent after retry metadata changes", async () => {
    const db = database();
    await prepareOfflineIdentity(db, "10001");
    await enqueuePendingCommand(db, taskCommand());
    await replayPendingCommands(db, {
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      ownerId: "anonymous-tab",
      now: () => new Date("2026-07-20T10:02:00.000Z"),
      send: async () => {
        throw new PendingCommandTransportError("server_unavailable", 503);
      },
    });

    const reused = await enqueuePendingCommand(db, taskCommand());
    expect(reused).toEqual(
      expect.objectContaining({
        id: commandId,
        status: "retryable",
        attemptCount: 1,
      }),
    );
  });

  it("replays in created order and deletes only after canonical success is applied", async () => {
    const db = database();
    await prepareOfflineIdentity(db, "10001");
    await enqueuePendingCommand(db, taskCommand());
    await enqueuePendingCommand(db, {
      id: "019c0000-0000-7000-8000-000000000303",
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      kind: "symptom_check_in",
      createdAt: "2026-07-20T10:01:00.000Z",
      occurredAt: "2026-07-20T10:01:00.000Z",
      localDate: "2026-07-20",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
      payload: {
        checkIn: {
          timing: "post_training",
          leftPain: 0,
          rightPain: 0,
          swelling: "none",
          stiffness: false,
          mechanicalSymptoms: false,
          weightBearingIssue: false,
          localizedBonePain: false,
          nightOrRestPain: false,
          note: "Anonymous feedback",
        },
        clientSafetyPolicy: null,
        localSafetyLevel: null,
      },
    });

    const sent: string[] = [];
    const applied: string[] = [];
    const result = await replayPendingCommands(db, {
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      ownerId: "anonymous-tab",
      now: () => new Date("2026-07-20T10:02:00.000Z"),
      send: async (command) => {
        sent.push(command.id);
        return command.kind === "task_update"
          ? {
              kind: "task_update" as const,
              commandId: command.id,
              status: command.payload.status,
              replayed: false,
            }
          : {
              kind: "symptom_check_in" as const,
              commandId: command.id,
              id: command.id,
              safetyLevel: "green" as const,
              replayed: false,
              safetyPolicy: {
                policyId: "019c0000-0000-7000-8000-000000000304",
                version: 1,
                hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              },
              clientPolicyOutdated: false,
            };
      },
      onCanonicalSuccess: async (command) => {
        expect(await db.pendingCommands.get(command.id)).not.toBeUndefined();
        applied.push(command.id);
      },
    });

    expect(result).toMatchObject({ sent: 2, succeeded: 2, failed: 0 });
    expect(sent).toEqual([commandId, "019c0000-0000-7000-8000-000000000303"]);
    expect(applied).toEqual(sent);
    expect(await db.pendingCommands.count()).toBe(0);
  });

  it.each([
    {
      label: "temporary provider failure",
      error: new PendingCommandTransportError("server_unavailable", 503),
      status: "retryable",
      errorCode: "server_unavailable",
    },
    {
      label: "network timeout",
      error: new DOMException("anonymous timeout", "AbortError"),
      status: "retryable",
      errorCode: "timeout",
    },
    {
      label: "authentication failure",
      error: new PendingCommandTransportError("authentication_required", 401),
      status: "waiting_auth",
      errorCode: "authentication_required",
    },
    {
      label: "business conflict",
      error: new PendingCommandTransportError("version_conflict", 409),
      status: "needs_attention",
      errorCode: "version_conflict",
    },
  ])(
    "stops after a $label and persists its safe state",
    async ({ error, status, errorCode }) => {
      const db = database();
      await prepareOfflineIdentity(db, "10001");
      await enqueuePendingCommand(db, taskCommand());
      await enqueuePendingCommand(db, {
        ...taskCommand(),
        id: "019c0000-0000-7000-8000-000000000305",
        createdAt: "2026-07-20T10:01:00.000Z",
      });
      const sent: string[] = [];

      const result = await replayPendingCommands(db, {
        githubUserId: "10001",
        trackerKey: "knee-rehab",
        ownerId: "anonymous-tab",
        now: () => new Date("2026-07-20T10:02:00.000Z"),
        send: async (command) => {
          sent.push(command.id);
          throw error;
        },
      });

      expect(result).toMatchObject({ sent: 1, succeeded: 0, failed: 1 });
      expect(sent).toEqual([commandId]);
      expect(await db.pendingCommands.get(commandId)).toEqual(
        expect.objectContaining({
          status,
          attemptCount: 1,
          lastErrorCode: errorCode,
        }),
      );
      expect(
        await db.pendingCommands.get("019c0000-0000-7000-8000-000000000305"),
      ).toEqual(expect.objectContaining({ status: "local_only" }));
    },
  );

  it("uses one lease when two pages trigger replay concurrently", async () => {
    const db = database();
    await prepareOfflineIdentity(db, "10001");
    await enqueuePendingCommand(db, taskCommand());
    let releaseSend!: () => void;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    let sendCount = 0;
    const send = async () => {
      sendCount += 1;
      await sendGate;
      return {
        kind: "task_update" as const,
        commandId,
        status: "completed" as const,
        replayed: false,
      };
    };
    const base = {
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      now: () => new Date("2026-07-20T10:02:00.000Z"),
      send,
    };

    const first = replayPendingCommands(db, {
      ...base,
      ownerId: "anonymous-tab-one",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await replayPendingCommands(db, {
      ...base,
      ownerId: "anonymous-tab-two",
    });
    releaseSend();

    expect(second).toEqual({
      acquired: false,
      sent: 0,
      succeeded: 0,
      failed: 0,
    });
    await expect(first).resolves.toMatchObject({ succeeded: 1 });
    expect(sendCount).toBe(1);
  });

  it("respects retry backoff automatically but lets the user retry the same command id", async () => {
    const db = database();
    await prepareOfflineIdentity(db, "10001");
    await enqueuePendingCommand(db, taskCommand());
    const failed = await replayPendingCommands(db, {
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      ownerId: "anonymous-tab-one",
      now: () => new Date("2026-07-20T10:02:00.000Z"),
      send: async () => {
        throw new PendingCommandTransportError("server_unavailable", 503);
      },
    });
    expect(failed.failed).toBe(1);

    const automaticSend = vi.fn();
    const automatic = await replayPendingCommands(db, {
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      ownerId: "anonymous-tab-two",
      now: () => new Date("2026-07-20T10:02:01.000Z"),
      send: automaticSend,
    });
    expect(automatic.sent).toBe(0);
    expect(automaticSend).not.toHaveBeenCalled();

    const manual = await replayPendingCommands(db, {
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      ownerId: "anonymous-tab-two",
      force: true,
      now: () => new Date("2026-07-20T10:02:01.000Z"),
      send: async (command) => ({
        kind: "task_update",
        commandId: command.id,
        status: "completed",
        replayed: true,
      }),
    });
    expect(manual.succeeded).toBe(1);
    expect(await db.pendingCommands.count()).toBe(0);
  });

  it.each(["waiting_auth", "needs_attention"] as const)(
    "does not overtake a first command in %s state",
    async (blockedStatus) => {
      const db = database();
      await prepareOfflineIdentity(db, "10001");
      await enqueuePendingCommand(db, taskCommand());
      await enqueuePendingCommand(db, {
        ...taskCommand(),
        id: "019c0000-0000-7000-8000-000000000306",
        createdAt: "2026-07-20T10:01:00.000Z",
      });
      const first = await db.pendingCommands.get(commandId);
      expect(first).toBeDefined();
      await db.pendingCommands.put({
        ...first!,
        status: blockedStatus,
        lastErrorCode:
          blockedStatus === "waiting_auth"
            ? "authentication_required"
            : "version_conflict",
      });
      const send = vi.fn();

      const result = await replayPendingCommands(db, {
        githubUserId: "10001",
        trackerKey: "knee-rehab",
        ownerId: "anonymous-tab",
        now: () => new Date("2026-07-20T10:02:00.000Z"),
        send,
      });

      expect(result.sent).toBe(0);
      expect(send).not.toHaveBeenCalled();
    },
  );
});
