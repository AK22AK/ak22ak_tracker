// @vitest-environment node

import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { pendingCommandSchema } from "@/offline/command-contracts";

interface PublicOfflineContract {
  createPendingTaskCommand(value: unknown): unknown;
  validPendingCommand(value: unknown, identity: string): boolean;
}

async function loadPublicOfflineContract() {
  const source = await readFile(
    new URL("../public/offline-contract.js", import.meta.url),
    "utf8",
  );
  const context: { AKTrackerOfflineContract?: PublicOfflineContract } = {};
  runInNewContext(source, context);
  if (!context.AKTrackerOfflineContract) {
    throw new Error("offline_contract_unavailable");
  }
  return context.AKTrackerOfflineContract;
}

describe("public cold-start task command contract", () => {
  it("creates the same versioned task command accepted by the TypeScript outbox schema", async () => {
    const contract = await loadPublicOfflineContract();
    const actual = {
      kind: "general",
      exercises: [],
      durationMinutes: 18,
      distanceKm: null,
      summary: "Anonymous cached actual",
    };
    const value = contract.createPendingTaskCommand({
      id: "019c0000-0000-7000-8000-000000000501",
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      createdAt: "2026-07-20T10:00:00.001Z",
      occurredAt: "2026-07-20T10:00:00.000Z",
      localDate: "2026-07-20",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
      sourceVersion: "anonymous-today-v1",
      taskId: "019c0000-0000-7000-8000-000000000502",
      status: "completed",
      actual,
      note: "Anonymous cached note",
      baseStatus: "planned",
      planVersion: 3,
    });

    expect(pendingCommandSchema.parse(value)).toEqual(
      expect.objectContaining({
        id: "019c0000-0000-7000-8000-000000000501",
        schemaVersion: 1,
        kind: "task_update",
        status: "local_only",
        attemptCount: 0,
        nextAttemptAt: "2026-07-20T10:00:00.001Z",
        occurredTimeZone: "Asia/Shanghai",
        occurredUtcOffsetMinutes: 480,
        payload: {
          taskId: "019c0000-0000-7000-8000-000000000502",
          status: "completed",
          actual,
          note: "Anonymous cached note",
          baseStatus: "planned",
          planVersion: 3,
        },
      }),
    );
    expect(contract.validPendingCommand(value, "10001")).toBe(true);
  });
});
