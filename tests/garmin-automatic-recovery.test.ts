import { describe, expect, it, vi } from "vitest";

import {
  runAutomaticProviderRecovery,
  type AutomaticProviderRecoveryClaimStore,
} from "@/server/integrations/core/automatic-provider-recovery";

describe("P3b-2d automatic Provider recovery", () => {
  it("runs at most one bounded recovery after an atomic claim", async () => {
    const store: AutomaticProviderRecoveryClaimStore = {
      claim: vi.fn(async () => "claimed" as const),
    };
    const recover = vi.fn(async () => ({ complete: false }));

    await expect(
      runAutomaticProviderRecovery({
        trackerId: "019c0000-0000-7000-8000-000000000001",
        provider: "garmin",
        now: new Date("2026-07-24T03:00:00.000Z"),
        minimumIntervalMs: 30 * 60_000,
        leaseMs: 2 * 60_000,
        store,
        recover,
      }),
    ).resolves.toEqual({ status: "completed", result: { complete: false } });
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it.each(["not_due", "in_progress"] as const)(
    "skips Provider work when the claim reports %s",
    async (reason) => {
      const store: AutomaticProviderRecoveryClaimStore = {
        claim: vi.fn(async () => reason),
      };
      const recover = vi.fn();

      await expect(
        runAutomaticProviderRecovery({
          trackerId: "019c0000-0000-7000-8000-000000000001",
          provider: "garmin",
          now: new Date("2026-07-24T03:00:00.000Z"),
          minimumIntervalMs: 30 * 60_000,
          leaseMs: 2 * 60_000,
          store,
          recover,
        }),
      ).resolves.toEqual({ status: "skipped", reason });
      expect(recover).not.toHaveBeenCalled();
    },
  );

  it("lets the database claim suppress concurrent pages", async () => {
    const store: AutomaticProviderRecoveryClaimStore = {
      claim: vi
        .fn()
        .mockResolvedValueOnce("claimed")
        .mockResolvedValueOnce("in_progress"),
    };
    const recover = vi.fn(async () => ({ complete: true }));
    const input = {
      trackerId: "019c0000-0000-7000-8000-000000000001",
      provider: "garmin" as const,
      now: new Date("2026-07-24T03:00:00.000Z"),
      minimumIntervalMs: 30 * 60_000,
      leaseMs: 2 * 60_000,
      store,
      recover,
    };

    const [first, second] = await Promise.all([
      runAutomaticProviderRecovery(input),
      runAutomaticProviderRecovery(input),
    ]);

    expect(first.status).toBe("completed");
    expect(second).toEqual({ status: "skipped", reason: "in_progress" });
    expect(recover).toHaveBeenCalledTimes(1);
  });
});
