// @vitest-environment node

import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { createGitHubMirrorCronHandler } from "@/server/mirror/cron";

const safeSyncResponse = {
  result: {
    status: "idle" as const,
    processed: 0,
    succeeded: 0,
    failed: 0,
  },
  status: {
    configuration: "configured" as const,
    pendingCount: 0,
    processingCount: 0,
    failedCount: 0,
    oldestPendingAt: null,
    lastSucceededAt: null,
    permissionError: false,
    delayed: false,
  },
};

function request(authorization?: string) {
  return new Request("https://example.test/api/cron/github-mirror", {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
}

describe("GitHub mirror daily Cron route", () => {
  it("keeps the GitHub mirror daily Vercel GET invocation", async () => {
    const config = JSON.parse(
      await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    ) as { crons?: Array<{ path?: string; schedule?: string }> };

    expect(config.crons).toContainEqual({
      path: "/api/cron/github-mirror",
      schedule: "0 19 * * *",
    });
  });

  it.each([
    ["missing server secret", undefined, "Bearer anonymous-cron-secret"],
    ["missing authorization", "anonymous-cron-secret", undefined],
    ["wrong authorization", "anonymous-cron-secret", "Bearer wrong-secret"],
    ["wrong scheme", "anonymous-cron-secret", "Basic anonymous-cron-secret"],
  ])(
    "rejects %s without touching the outbox",
    async (_name, secret, header) => {
      const sync = vi.fn(async () => safeSyncResponse);
      const handler = createGitHubMirrorCronHandler({
        readSecret: () => secret,
        sync,
      });

      const response = await handler(request(header));

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        status: "unauthorized",
      });
      expect(sync).not.toHaveBeenCalled();
    },
  );

  it("invokes the shared bounded consumer once and returns only its safe response", async () => {
    const sync = vi.fn(async () => safeSyncResponse);
    const handler = createGitHubMirrorCronHandler({
      readSecret: () => "anonymous-cron-secret",
      sync,
    });

    const response = await handler(request("Bearer anonymous-cron-secret"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(safeSyncResponse);
    expect(sync).toHaveBeenCalledOnce();
  });

  it.each([
    ["not configured", "not_configured"],
    ["invalid configuration", "invalid_configuration"],
  ] as const)(
    "reports %s without leaking configuration values",
    async (_name, status) => {
      const handler = createGitHubMirrorCronHandler({
        readSecret: () => "anonymous-cron-secret",
        sync: vi.fn(async () => ({
          ...safeSyncResponse,
          result: { ...safeSyncResponse.result, status },
          status: {
            ...safeSyncResponse.status,
            configuration: status,
          },
        })),
      });

      const response = await handler(request("Bearer anonymous-cron-secret"));
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain(status);
      expect(body).not.toContain("anonymous-cron-secret");
    },
  );

  it.each([
    [
      "consumer failure",
      vi.fn(async () => Promise.reject(new Error("private provider response"))),
    ],
    ["invalid result", vi.fn(async () => ({ unsafe: "private payload" }))],
  ])(
    "fails closed on %s without returning private error details",
    async (_name, sync) => {
      const handler = createGitHubMirrorCronHandler({
        readSecret: () => "anonymous-cron-secret",
        sync,
      });

      const response = await handler(request("Bearer anonymous-cron-secret"));
      const body = await response.text();

      expect(response.status).toBe(503);
      expect(body).toBe('{"status":"unavailable"}');
      expect(body).not.toContain("private");
    },
  );
});
