import { describe, expect, it, vi } from "vitest";

import { createXunjiRecoveryCronHandler } from "@/server/integrations/xunji/cron";

function request(authorization?: string) {
  return new Request("https://example.test/api/cron/xunji-training", {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
}

describe("Xunji daily recovery cron", () => {
  it("rejects before running recovery when CRON_SECRET is missing or wrong", async () => {
    const recover = vi.fn();
    const missing = createXunjiRecoveryCronHandler({
      readSecret: () => undefined,
      recover,
    });
    const wrong = createXunjiRecoveryCronHandler({
      readSecret: () => "anonymous-secret",
      recover,
    });

    expect((await missing(request())).status).toBe(503);
    expect((await wrong(request("Bearer wrong"))).status).toBe(401);
    expect(recover).not.toHaveBeenCalled();
  });

  it("uses one server-owned three-day batch and returns only safe status", async () => {
    const recover = vi.fn(async () => ({
      status: "skipped" as const,
      reason: "not_due" as const,
    }));
    const handler = createXunjiRecoveryCronHandler({
      readSecret: () => "anonymous-secret",
      recover,
    });

    const response = await handler(request("Bearer anonymous-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "skipped",
      reason: "not_due",
    });
    expect(recover).toHaveBeenCalledWith({
      trackerKey: "knee-rehab",
      batchSize: 3,
    });
  });
});
