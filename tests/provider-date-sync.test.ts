import { describe, expect, it, vi } from "vitest";

import {
  syncProviderDate,
  type ProviderDateSyncStore,
} from "@/server/integrations/core/sync-provider-date";
import { XunjiProviderError } from "@/server/integrations/xunji/adapter";

function createStore(): ProviderDateSyncStore {
  return {
    getCachedSuccess: vi.fn(async () => null),
    markAttempt: vi.fn(async () => undefined),
    commitSuccess: vi.fn(async (input) => ({
      cached: false,
      created: input.records.length,
      changed: 0,
      unchanged: 0,
      recordCount: input.records.length,
      syncedAt: input.succeededAt.toISOString(),
    })),
    markFailure: vi.fn(async () => undefined),
  };
}

describe("provider-neutral single-date sync", () => {
  it("uses a successful same-date cache without calling the provider", async () => {
    const store = createStore();
    const cached = {
      cached: true,
      created: 0,
      changed: 0,
      unchanged: 1,
      recordCount: 1,
      syncedAt: "2026-07-19T08:00:00.000Z",
    };
    vi.mocked(store.getCachedSuccess).mockResolvedValue(cached);
    const readSource = vi.fn();

    await expect(
      syncProviderDate({
        trackerId: "019c0000-0000-7000-8000-000000000001",
        provider: "xunji",
        date: "2026-07-19",
        now: new Date("2026-07-19T08:00:10.000Z"),
        store,
        readSource,
      }),
    ).resolves.toEqual(cached);
    expect(readSource).not.toHaveBeenCalled();
  });

  it("records provider failure without committing external records", async () => {
    const store = createStore();
    const error = new XunjiProviderError("rate_limited");

    await expect(
      syncProviderDate({
        trackerId: "019c0000-0000-7000-8000-000000000001",
        provider: "xunji",
        date: "2026-07-19",
        now: new Date("2026-07-19T08:00:00.000Z"),
        store,
        readSource: vi.fn(async () => {
          throw error;
        }),
      }),
    ).rejects.toBe(error);

    expect(store.markAttempt).toHaveBeenCalledOnce();
    expect(store.markFailure).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "rate_limited" }),
    );
    expect(store.commitSuccess).not.toHaveBeenCalled();
  });
});
