// @vitest-environment node

import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { createGarminRecoveryCronHandler } from "@/server/integrations/garmin/cron";

const connected = {
  provider: "garmin" as const,
  state: "connected" as const,
  verifiedAt: "2026-07-24T03:00:00.000Z",
  updatedAt: "2026-07-24T03:00:00.000Z",
  lastErrorCode: null,
  sync: {
    status: "succeeded" as const,
    lastAttemptAt: "2026-07-24T03:00:00.000Z",
    lastSucceededDate: "2026-07-23",
    nextCursor: "2026-07-24",
    lastErrorCode: null,
  },
};

const completedRecovery = {
  status: "completed" as const,
  sync: {
    provider: "garmin",
    batch: { from: "2026-07-22", to: "2026-07-24" },
    targetDate: "2026-07-24",
    days: [
      {
        date: "2026-07-22",
        status: "succeeded" as const,
        cached: false,
        created: 1,
        changed: 0,
        unchanged: 0,
        recordCount: 1,
        syncedAt: "2026-07-24T03:00:00.000Z",
      },
      {
        date: "2026-07-23",
        status: "failed" as const,
        errorCode: "rate_limited",
      },
    ],
    summary: {
      succeeded: 1,
      failed: 1,
      created: 1,
      changed: 0,
      unchanged: 0,
    },
    nextCursor: "2026-07-23",
    complete: false,
    lastSucceededDate: "2026-07-22",
  },
  connection: {
    ...connected,
    sync: {
      ...connected.sync,
      status: "failed" as const,
      lastErrorCode: "rate_limited" as const,
    },
  },
};

function request(authorization?: string) {
  return new Request("https://example.test/api/cron/garmin-activity", {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
}

describe("P3b-2e Garmin daily recovery Cron", () => {
  it("registers a separate daily hour without replacing the GitHub Cron", async () => {
    const config = JSON.parse(
      await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    ) as { crons?: Array<{ path?: string; schedule?: string }> };

    expect(config.crons).toContainEqual({
      path: "/api/cron/github-mirror",
      schedule: "0 19 * * *",
    });
    expect(config.crons).toContainEqual({
      path: "/api/cron/garmin-activity",
      schedule: "0 21 * * *",
    });
    const routeSource = await readFile(
      new URL("../src/app/api/cron/garmin-activity/route.ts", import.meta.url),
      "utf8",
    );
    expect(routeSource).toContain("export const maxDuration = 45");
  });

  it.each([
    ["missing authorization", "anonymous-cron-secret", undefined, 401],
    [
      "wrong authorization",
      "anonymous-cron-secret",
      "Bearer wrong-secret",
      401,
    ],
    ["missing server secret", undefined, "Bearer anonymous-cron-secret", 503],
  ])(
    "rejects %s before constructing the database-backed runtime",
    async (_name, secret, header, status) => {
      const createRuntime = vi.fn();
      const handler = createGarminRecoveryCronHandler({
        readSecret: () => secret,
        createRuntime,
      });

      const response = await handler(request(header));

      expect(response.status).toBe(status);
      expect(createRuntime).not.toHaveBeenCalled();
      expect(await response.json()).not.toHaveProperty("secret");
    },
  );

  it("runs exactly one server-owned daily Cron batch and returns a safe summary", async () => {
    const recoverActivityHistory = vi.fn(async () => completedRecovery);
    const handler = createGarminRecoveryCronHandler({
      readSecret: () => "anonymous-cron-secret",
      createRuntime: () => ({ recoverActivityHistory }),
    });

    const response = await handler(request("Bearer anonymous-cron-secret"));

    expect(response.status).toBe(200);
    expect(recoverActivityHistory).toHaveBeenCalledOnce();
    expect(recoverActivityHistory).toHaveBeenCalledWith({
      trackerKey: "knee-rehab",
      profile: "daily_cron",
    });
    await expect(response.json()).resolves.toEqual({
      status: "completed",
      sync: {
        batch: { from: "2026-07-22", to: "2026-07-24" },
        targetDate: "2026-07-24",
        summary: {
          succeeded: 1,
          failed: 1,
          created: 1,
          changed: 0,
          unchanged: 0,
        },
        nextCursor: "2026-07-23",
        complete: false,
        lastSucceededDate: "2026-07-22",
        errorCode: "rate_limited",
      },
    });
  });

  it.each([
    ["not connected", "not_connected"],
    ["credential refresh required", "needs_refresh"],
    ["not due", "not_due"],
    ["concurrent foreground recovery", "in_progress"],
  ] as const)("returns a safe skipped result for %s", async (_name, reason) => {
    const handler = createGarminRecoveryCronHandler({
      readSecret: () => "anonymous-cron-secret",
      createRuntime: () => ({
        recoverActivityHistory: vi.fn(async () => ({
          status: "skipped" as const,
          reason,
          connection: {
            ...connected,
            state:
              reason === "not_connected"
                ? ("not_connected" as const)
                : reason === "needs_refresh"
                  ? ("needs_refresh" as const)
                  : ("connected" as const),
          },
        })),
      }),
    });

    const response = await handler(request("Bearer anonymous-cron-secret"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "skipped",
      reason,
    });
  });

  it.each([
    [
      "runtime failure",
      vi.fn(async () => Promise.reject(new Error("private"))),
    ],
    ["invalid result", vi.fn(async () => ({ raw: "private" }))],
  ])("fails closed on %s", async (_name, recoverActivityHistory) => {
    const handler = createGarminRecoveryCronHandler({
      readSecret: () => "anonymous-cron-secret",
      createRuntime: () => ({ recoverActivityHistory }),
    });

    const response = await handler(request("Bearer anonymous-cron-secret"));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe('{"status":"unavailable"}');
    expect(body).not.toContain("private");
  });
});
