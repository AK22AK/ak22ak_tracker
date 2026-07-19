// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { PendingCommand } from "@/offline/command-contracts";
import { sendPendingCommand } from "@/offline/command-transport";

const taskCommand: PendingCommand = {
  id: "019c0000-0000-7000-8000-000000000501",
  schemaVersion: 1,
  githubUserId: "10001",
  trackerKey: "knee-rehab",
  kind: "task_update",
  createdAt: "2026-07-20T10:00:00.000Z",
  occurredAt: "2026-07-20T10:00:00.000Z",
  localDate: "2026-07-20",
  occurredTimeZone: "Asia/Shanghai",
  occurredUtcOffsetMinutes: 480,
  attemptCount: 0,
  nextAttemptAt: "2026-07-20T10:00:00.000Z",
  lastAttemptAt: null,
  lastErrorCode: null,
  status: "local_only",
  sourceVersion: null,
  payload: {
    taskId: "019c0000-0000-7000-8000-000000000502",
    status: "completed",
    actual: null,
    note: "Anonymous note",
    baseStatus: "planned",
    planVersion: 1,
  },
};

describe("P2b-1 pending command transport", () => {
  it("calls only the existing task endpoint without credentials or private queue metadata", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return Response.json({
          commandId: taskCommand.id,
          status: "completed",
          replayed: false,
        });
      },
    );

    await expect(sendPendingCommand(taskCommand, fetcher)).resolves.toEqual({
      kind: "task_update",
      commandId: taskCommand.id,
      status: "completed",
      replayed: false,
    });
    const [url, request] = fetcher.mock.calls[0]!;
    expect(request).toBeDefined();
    if (!request) throw new Error("missing request init");
    expect(url).toBe(`/api/tasks/${taskCommand.payload.taskId}`);
    expect(request.method).toBe("PATCH");
    expect(request.headers).not.toHaveProperty("Authorization");
    expect(String(request.body)).not.toMatch(
      /githubUserId|trackerKey|attemptCount|cookie|authorization/i,
    );
  });
});
