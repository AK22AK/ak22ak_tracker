// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  consumeGitHubMirrorBatch,
  type GitHubMirrorOutboxItem,
  type GitHubMirrorOutboxStore,
} from "@/server/mirror/consumer";
import { GitHubMirrorError } from "@/server/mirror/github";

function item(
  overrides: Partial<GitHubMirrorOutboxItem> = {},
): GitHubMirrorOutboxItem {
  return {
    id: "019c0000-0000-7000-8000-000000000001",
    targetPath:
      "trackers/example-tracker/events/2026/07/019c0000-0000-7000-8000-000000000001.json",
    payload: { schemaVersion: 1, kind: "anonymous_event" },
    attempts: 0,
    ...overrides,
  };
}

function store(items: GitHubMirrorOutboxItem[]): GitHubMirrorOutboxStore & {
  state: Map<string, string>;
} {
  const queue = [...items];
  const state = new Map(items.map((entry) => [entry.id, "pending"]));
  return {
    state,
    claimNext: vi.fn(async () => {
      const next = queue.shift() ?? null;
      if (next) state.set(next.id, "processing");
      return next;
    }),
    markSucceeded: vi.fn(async (id) => {
      state.set(id, "succeeded");
      return true;
    }),
    markRetryable: vi.fn(async (id) => {
      state.set(id, "pending");
      return true;
    }),
    markFailed: vi.fn(async (id) => {
      state.set(id, "failed");
      return true;
    }),
  };
}

describe("GitHub mirror outbox consumer", () => {
  it("claims a bounded batch and marks success only after GitHub confirms", async () => {
    const db = store([
      item(),
      item({ id: "019c0000-0000-7000-8000-000000000002" }),
    ]);
    const putJson = vi.fn(async () => ({
      outcome: "created" as const,
      sha: "sha",
    }));

    const result = await consumeGitHubMirrorBatch({
      store: db,
      mirror: { putJson },
      leaseOwner: "anonymous-worker",
      batchSize: 1,
      now: () => new Date("2026-07-20T08:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "succeeded",
      processed: 1,
      succeeded: 1,
    });
    expect(putJson).toHaveBeenCalledOnce();
    expect(db.markSucceeded).toHaveBeenCalledOnce();
    expect(db.state.get(item().id)).toBe("succeeded");
  });

  it("backs off retryable failures without rolling back the committed core item", async () => {
    const db = store([item()]);
    const putJson = vi.fn(async () => {
      throw new GitHubMirrorError("rate_limited", true);
    });

    const result = await consumeGitHubMirrorBatch({
      store: db,
      mirror: { putJson },
      leaseOwner: "anonymous-worker",
      now: () => new Date("2026-07-20T08:00:00.000Z"),
    });

    expect(result).toMatchObject({ status: "retry_scheduled", failed: 1 });
    expect(db.markRetryable).toHaveBeenCalledWith(
      item().id,
      "anonymous-worker",
      "rate_limited",
      expect.any(Date),
    );
    expect(db.state.get(item().id)).toBe("pending");
  });

  it("stops the batch on authentication or permission failure", async () => {
    const db = store([
      item(),
      item({ id: "019c0000-0000-7000-8000-000000000002" }),
    ]);
    const putJson = vi.fn(async () => {
      throw new GitHubMirrorError("permissions", false);
    });

    const result = await consumeGitHubMirrorBatch({
      store: db,
      mirror: { putJson },
      leaseOwner: "anonymous-worker",
    });

    expect(result).toMatchObject({
      status: "needs_attention",
      processed: 1,
      failed: 1,
    });
    expect(db.markFailed).toHaveBeenCalledWith(
      item().id,
      "anonymous-worker",
      "permissions",
    );
    expect(putJson).toHaveBeenCalledOnce();
  });

  it("returns not_configured without claiming business outbox rows", async () => {
    const db = store([item()]);
    const result = await consumeGitHubMirrorBatch({
      store: db,
      mirror: null,
      leaseOwner: "anonymous-worker",
    });
    expect(result).toMatchObject({ status: "not_configured", processed: 0 });
    expect(db.claimNext).not.toHaveBeenCalled();
    expect(db.state.get(item().id)).toBe("pending");
  });

  it("reports an unconfirmed result when success loses its lease", async () => {
    const db = store([item()]);
    vi.mocked(db.markSucceeded).mockResolvedValue(false);
    const result = await consumeGitHubMirrorBatch({
      store: db,
      mirror: {
        putJson: vi.fn(async () => ({
          outcome: "created" as const,
          sha: "sha",
        })),
      },
      leaseOwner: "stale-worker",
    });
    expect(result).toEqual({
      status: "unconfirmed",
      processed: 1,
      succeeded: 0,
      failed: 0,
    });
  });

  it.each([
    ["retryable", new GitHubMirrorError("rate_limited", true), "markRetryable"],
    ["terminal", new GitHubMirrorError("permissions", false), "markFailed"],
  ] as const)(
    "reports an unconfirmed result when a %s transition loses its lease",
    async (_kind, mirrorError, transition) => {
      const db = store([item()]);
      vi.mocked(db[transition]).mockResolvedValue(false);
      const result = await consumeGitHubMirrorBatch({
        store: db,
        mirror: {
          putJson: vi.fn(async () => {
            throw mirrorError;
          }),
        },
        leaseOwner: "stale-worker",
      });
      expect(result).toEqual({
        status: "unconfirmed",
        processed: 1,
        succeeded: 0,
        failed: 0,
      });
    },
  );
});
