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

const feedbackCommand: PendingCommand = {
  id: "019c0000-0000-7000-8000-000000000503",
  schemaVersion: 1,
  githubUserId: "10001",
  trackerKey: "knee-rehab",
  kind: "symptom_check_in",
  createdAt: "2026-07-20T10:01:00.000Z",
  occurredAt: "2026-07-20T10:01:00.000Z",
  localDate: "2026-07-20",
  occurredTimeZone: "Asia/Shanghai",
  occurredUtcOffsetMinutes: 480,
  attemptCount: 0,
  nextAttemptAt: "2026-07-20T10:01:00.000Z",
  lastAttemptAt: null,
  lastErrorCode: null,
  status: "local_only",
  sourceVersion: null,
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
};

const anonymousSafetyPolicy = {
  policyId: "019c0000-0000-7000-8000-000000000504",
  version: 1,
  hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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

  it("rejects a task response whose server command id does not match the queued command", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        commandId: "019c0000-0000-7000-8000-000000000599",
        status: "completed",
        replayed: false,
      }),
    );

    await expect(
      sendPendingCommand(taskCommand, fetcher),
    ).rejects.toMatchObject({
      name: "PendingCommandTransportError",
      safeCode: "invalid_response",
    });
  });

  it("accepts feedback only when the server event id matches the queued command", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        id: feedbackCommand.id,
        safetyLevel: "green",
        replayed: false,
        safetyPolicy: anonymousSafetyPolicy,
        clientPolicyOutdated: false,
      }),
    );

    await expect(sendPendingCommand(feedbackCommand, fetcher)).resolves.toEqual(
      {
        kind: "symptom_check_in",
        commandId: feedbackCommand.id,
        id: feedbackCommand.id,
        safetyLevel: "green",
        replayed: false,
        safetyPolicy: anonymousSafetyPolicy,
        clientPolicyOutdated: false,
      },
    );
  });

  it("rejects a feedback response whose server event id does not match the queued command", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        id: "019c0000-0000-7000-8000-000000000599",
        safetyLevel: "green",
        replayed: false,
        safetyPolicy: anonymousSafetyPolicy,
        clientPolicyOutdated: false,
      }),
    );

    await expect(
      sendPendingCommand(feedbackCommand, fetcher),
    ).rejects.toMatchObject({
      name: "PendingCommandTransportError",
      safeCode: "invalid_response",
    });
  });

  it.each([
    {
      label: "invalid JSON",
      response: () =>
        new Response("not-json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    },
    {
      label: "a schema mismatch",
      response: () => Response.json({ status: "completed" }),
    },
  ])("classifies $label as an invalid response", async ({ response }) => {
    await expect(
      sendPendingCommand(
        taskCommand,
        vi.fn(async () => response()),
      ),
    ).rejects.toMatchObject({
      name: "PendingCommandTransportError",
      safeCode: "invalid_response",
    });
  });
});
