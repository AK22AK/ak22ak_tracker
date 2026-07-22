// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type {
  GitHubMirrorOutboxItem,
  GitHubMirrorOutboxStore,
} from "@/server/mirror/consumer";
import { scheduleGitHubMirrorAfterResponse } from "@/server/mirror/after-response";
import { consumeOneGitHubMirrorAfterResponse } from "@/server/mirror/runtime";

describe("GitHub mirror after-response consumption", () => {
  it("does not start mirror work until the response has completed", async () => {
    const callbacks: Array<() => Promise<void>> = [];
    const consumeOne = vi.fn(async () => undefined);

    scheduleGitHubMirrorAfterResponse({
      schedule: (callback) => callbacks.push(callback),
      consumeOne,
    });

    expect(consumeOne).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(1);

    await callbacks[0]!();
    expect(consumeOne).toHaveBeenCalledOnce();
  });

  it("claims at most one outbox item for each response trigger", async () => {
    const queue: GitHubMirrorOutboxItem[] = [
      {
        id: "019c0000-0000-7000-8000-000000000031",
        targetPath:
          "trackers/example-tracker/events/2026/07/019c0000-0000-7000-8000-000000000031.json",
        payload: { schemaVersion: 1, kind: "anonymous_event" },
        attempts: 0,
      },
      {
        id: "019c0000-0000-7000-8000-000000000032",
        targetPath:
          "trackers/example-tracker/events/2026/07/019c0000-0000-7000-8000-000000000032.json",
        payload: { schemaVersion: 1, kind: "anonymous_event" },
        attempts: 0,
      },
    ];
    const store: GitHubMirrorOutboxStore = {
      claimNext: vi.fn(async () => queue.shift() ?? null),
      markSucceeded: vi.fn(async () => true),
      markRetryable: vi.fn(async () => true),
      markFailed: vi.fn(async () => true),
    };
    const putJson = vi.fn(async () => ({
      outcome: "created" as const,
      sha: "anonymous-sha",
    }));

    const result = await consumeOneGitHubMirrorAfterResponse({
      resolveConfig: () => ({
        configuration: "configured" as const,
        mirror: { putJson },
      }),
      store,
      leaseOwner: "anonymous-response-worker",
    });

    expect(result).toMatchObject({ processed: 1, succeeded: 1 });
    expect(store.claimNext).toHaveBeenCalledOnce();
    expect(putJson).toHaveBeenCalledOnce();
    expect(queue).toHaveLength(1);
  });

  it("skips safely when mirror configuration is unavailable", async () => {
    const store: GitHubMirrorOutboxStore = {
      claimNext: vi.fn(async () => null),
      markSucceeded: vi.fn(async () => true),
      markRetryable: vi.fn(async () => true),
      markFailed: vi.fn(async () => true),
    };

    const result = await consumeOneGitHubMirrorAfterResponse({
      resolveConfig: () => ({
        configuration: "not_configured" as const,
        mirror: null,
      }),
      store,
    });

    expect(result).toEqual({
      status: "not_configured",
      processed: 0,
      succeeded: 0,
      failed: 0,
    });
    expect(store.claimNext).not.toHaveBeenCalled();
  });

  it("keeps core success isolated from scheduling and consumer failures", async () => {
    expect(() =>
      scheduleGitHubMirrorAfterResponse({
        schedule: () => {
          throw new Error("scheduler_unavailable");
        },
      }),
    ).not.toThrow();

    const callbacks: Array<() => Promise<void>> = [];
    scheduleGitHubMirrorAfterResponse({
      schedule: (callback) => callbacks.push(callback),
      consumeOne: vi.fn(async () => {
        throw new Error("github_unavailable");
      }),
    });

    await expect(callbacks[0]!()).resolves.toBeUndefined();
  });

  it("relies on the shared store lease when response triggers overlap", async () => {
    const queued: GitHubMirrorOutboxItem = {
      id: "019c0000-0000-7000-8000-000000000033",
      targetPath:
        "trackers/example-tracker/events/2026/07/019c0000-0000-7000-8000-000000000033.json",
      payload: { schemaVersion: 1, kind: "anonymous_event" },
      attempts: 0,
    };
    let available = true;
    const store: GitHubMirrorOutboxStore = {
      claimNext: vi.fn(async () => {
        if (!available) return null;
        available = false;
        return queued;
      }),
      markSucceeded: vi.fn(async () => true),
      markRetryable: vi.fn(async () => true),
      markFailed: vi.fn(async () => true),
    };
    const putJson = vi.fn(async () => ({
      outcome: "created" as const,
      sha: "anonymous-sha",
    }));
    const resolveConfig = () => ({
      configuration: "configured" as const,
      mirror: { putJson },
    });

    const results = await Promise.all([
      consumeOneGitHubMirrorAfterResponse({
        resolveConfig,
        store,
        leaseOwner: "anonymous-worker-a",
      }),
      consumeOneGitHubMirrorAfterResponse({
        resolveConfig,
        store,
        leaseOwner: "anonymous-worker-b",
      }),
    ]);

    expect(results.reduce((sum, result) => sum + result.processed, 0)).toBe(1);
    expect(putJson).toHaveBeenCalledOnce();
    expect(store.markSucceeded).toHaveBeenCalledOnce();
  });
});
