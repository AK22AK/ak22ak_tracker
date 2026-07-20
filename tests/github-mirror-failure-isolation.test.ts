// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  executeTaskCommand,
  type PreparedTaskCommand,
} from "@/server/commands/task-command-core";
import {
  consumeGitHubMirrorBatch,
  type GitHubMirrorOutboxItem,
  type GitHubMirrorOutboxStore,
} from "@/server/mirror/consumer";
import { GitHubMirrorError } from "@/server/mirror/github";

describe("GitHub mirror fault isolation (P0-10/S10)", () => {
  it("keeps the core task event and outbox committed when GitHub later fails", async () => {
    const commits: PreparedTaskCommand[] = [];
    const commandId = "019c0000-0000-7000-8000-000000000011";
    const coreResult = await executeTaskCommand(
      {
        findTask: vi.fn(async () => ({
          id: "019c0000-0000-7000-8000-000000000012",
          trackerId: "019c0000-0000-7000-8000-000000000013",
          trackerKey: "example-tracker",
          planningTimeZone: "Asia/Shanghai",
        })),
        findEventByCommandId: vi.fn(async () => null),
        commitAtomically: vi.fn(async (value) => {
          commits.push(value);
        }),
      },
      {
        commandId,
        taskId: "019c0000-0000-7000-8000-000000000012",
        status: "completed",
        actual: null,
        note: null,
        occurredAt: "2026-07-20T08:00:00.000Z",
        occurredTimeZone: "Asia/Shanghai",
        occurredUtcOffsetMinutes: 480,
      },
    );
    expect(coreResult.status).toBe("completed");
    expect(commits).toHaveLength(1);

    const committed = commits[0]!;
    const outbox = committed.outbox;
    let queueState = "pending";
    const store: GitHubMirrorOutboxStore = {
      claimNext: vi.fn(async () => {
        queueState = "processing";
        return {
          id: commandId,
          targetPath: outbox.targetPath,
          payload: outbox.payload,
          attempts: 0,
        } satisfies GitHubMirrorOutboxItem;
      }),
      markSucceeded: vi.fn(async () => false),
      markRetryable: vi.fn(async () => {
        queueState = "pending";
        return true;
      }),
      markFailed: vi.fn(async () => false),
    };

    const mirrorResult = await consumeGitHubMirrorBatch({
      store,
      mirror: {
        putJson: vi.fn(async () => {
          throw new GitHubMirrorError("github_unavailable", true);
        }),
      },
      leaseOwner: "anonymous-worker",
      now: () => new Date("2026-07-20T08:01:00.000Z"),
    });

    expect(mirrorResult.status).toBe("retry_scheduled");
    expect(queueState).toBe("pending");
    expect(committed.event.id).toBe(commandId);
    expect(committed.taskUpdate.status).toBe("completed");
  });
});
