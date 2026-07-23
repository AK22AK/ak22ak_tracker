// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type {
  GitHubMirrorOutboxItem,
  GitHubMirrorOutboxStore,
} from "@/server/mirror/consumer";
import {
  resolveGitHubMirrorRuntimeConfig,
  syncGitHubMirrorBatch,
} from "@/server/mirror/runtime";

const safeStatus = {
  configuration: "configured" as const,
  pendingCount: 0,
  processingCount: 0,
  failedCount: 0,
  oldestPendingAt: null,
  lastSucceededAt: null,
  permissionError: false,
  delayed: false,
};

function mirrorItem(index: number): GitHubMirrorOutboxItem {
  return {
    id: `019c0000-0000-7000-8000-${String(index).padStart(12, "0")}`,
    targetPath: `trackers/example-tracker/events/2026/07/anonymous-${index}.json`,
    payload: { schemaVersion: 1, kind: "anonymous_event", index },
    attempts: 0,
  };
}

function runtimeStore(
  items: GitHubMirrorOutboxItem[],
): GitHubMirrorOutboxStore {
  const queue = [...items];
  return {
    claimNext: vi.fn(async () => queue.shift() ?? null),
    markSucceeded: vi.fn(async () => true),
    markRetryable: vi.fn(async () => true),
    markFailed: vi.fn(async () => true),
  };
}

describe("GitHub mirror runtime configuration", () => {
  it("distinguishes missing and invalid server configuration", () => {
    expect(resolveGitHubMirrorRuntimeConfig({})).toMatchObject({
      configuration: "not_configured",
      mirror: null,
    });
    expect(
      resolveGitHubMirrorRuntimeConfig({
        GITHUB_DATA_OWNER: "anonymous-owner",
        GITHUB_DATA_REPO: "../invalid",
        GITHUB_DATA_BRANCH: "main",
        GITHUB_DATA_TOKEN: "anonymous-fake-token",
      }),
    ).toMatchObject({
      configuration: "invalid_configuration",
      mirror: null,
    });
  });

  it("marks a complete anonymous server configuration as configured", () => {
    expect(
      resolveGitHubMirrorRuntimeConfig({
        GITHUB_DATA_OWNER: "anonymous-owner",
        GITHUB_DATA_REPO: "anonymous-data",
        GITHUB_DATA_BRANCH: "main",
        GITHUB_DATA_TOKEN: "anonymous-fake-token",
      }).configuration,
    ).toBe("configured");
  });

  it("keeps a scheduled invocation to one bounded three-item batch", async () => {
    const store = runtimeStore([
      mirrorItem(1),
      mirrorItem(2),
      mirrorItem(3),
      mirrorItem(4),
    ]);
    const putJson = vi.fn(async () => ({
      outcome: "created" as const,
      sha: "anonymous-sha",
    }));

    const response = await syncGitHubMirrorBatch({
      resolveConfig: () => ({
        configuration: "configured" as const,
        mirror: { putJson },
      }),
      store,
      leaseOwner: "anonymous-cron-worker",
      getStatus: vi.fn(async () => safeStatus),
    });

    expect(response.result).toEqual({
      status: "succeeded",
      processed: 3,
      succeeded: 3,
      failed: 0,
    });
    expect(putJson).toHaveBeenCalledTimes(3);
    expect(store.claimNext).toHaveBeenCalledTimes(3);
  });

  it("returns an honest idle result for an empty durable outbox", async () => {
    const store = runtimeStore([]);

    const response = await syncGitHubMirrorBatch({
      resolveConfig: () => ({
        configuration: "configured" as const,
        mirror: {
          putJson: vi.fn(async () => ({
            outcome: "created" as const,
            sha: "anonymous-sha",
          })),
        },
      }),
      store,
      leaseOwner: "anonymous-cron-worker",
      getStatus: vi.fn(async () => safeStatus),
    });

    expect(response.result).toEqual({
      status: "idle",
      processed: 0,
      succeeded: 0,
      failed: 0,
    });
  });

  it("stops a scheduled batch at the shared eight-second runtime budget", async () => {
    const store = runtimeStore([mirrorItem(1), mirrorItem(2)]);
    let clockReads = 0;

    const response = await syncGitHubMirrorBatch({
      resolveConfig: () => ({
        configuration: "configured" as const,
        mirror: {
          putJson: vi.fn(async () => ({
            outcome: "created" as const,
            sha: "anonymous-sha",
          })),
        },
      }),
      store,
      leaseOwner: "anonymous-cron-worker",
      getStatus: vi.fn(async () => safeStatus),
      now: () => {
        clockReads += 1;
        return new Date(
          clockReads <= 4
            ? "2026-07-23T08:00:00.000Z"
            : "2026-07-23T08:00:08.001Z",
        );
      },
    });

    expect(response.result).toMatchObject({
      status: "succeeded",
      processed: 1,
      succeeded: 1,
    });
    expect(store.claimNext).toHaveBeenCalledOnce();
  });

  it("relies on the shared lease when scheduled invocations overlap", async () => {
    let available = true;
    const queued = mirrorItem(1);
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

    const responses = await Promise.all([
      syncGitHubMirrorBatch({
        resolveConfig,
        store,
        leaseOwner: "anonymous-cron-worker-a",
        getStatus: vi.fn(async () => safeStatus),
      }),
      syncGitHubMirrorBatch({
        resolveConfig,
        store,
        leaseOwner: "anonymous-cron-worker-b",
        getStatus: vi.fn(async () => safeStatus),
      }),
    ]);

    expect(
      responses.reduce((total, response) => {
        return total + response.result.processed;
      }, 0),
    ).toBe(1);
    expect(putJson).toHaveBeenCalledOnce();
    expect(store.markSucceeded).toHaveBeenCalledOnce();
  });
});
