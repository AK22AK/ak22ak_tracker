import { describe, expect, it, vi } from "vitest";

import type { IntegrationStatus } from "@/domain/integrations";
import type { AutomaticProviderRecoveryClaimStore } from "@/server/integrations/core/automatic-provider-recovery";
import type { ProviderCatchUpStore } from "@/server/integrations/core/sync-provider-catch-up";
import type { ProviderDateSyncStore } from "@/server/integrations/core/sync-provider-date";
import type { ProviderHistoryStore } from "@/server/integrations/core/sync-provider-history";
import {
  createXunjiRuntime,
  type XunjiCredentialStore,
  type XunjiRuntimeAdapter,
} from "@/server/integrations/xunji/runtime";
import { XunjiProviderError } from "@/server/integrations/xunji/adapter";

const tracker = {
  id: "019c0000-0000-7000-8000-000000000001",
  key: "anonymous-tracker",
  startedOn: "2026-07-19",
  planningTimeZone: "Asia/Shanghai",
};

const baseStatus: IntegrationStatus = {
  provider: "xunji",
  configured: true,
  maskedKey: "••••••••",
  verifiedAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
  sync: {
    status: "succeeded",
    lastAttemptAt: "2026-08-06T00:00:00.000Z",
    lastSucceededAt: "2026-08-06T00:00:00.000Z",
    lastSucceededDate: "2026-08-06",
    nextCursor: null,
    lastErrorCode: null,
  },
};

function successfulDateSyncStore(): ProviderDateSyncStore {
  return {
    getCachedSuccess: vi.fn(async () => null),
    markAttempt: vi.fn(async () => undefined),
    commitSuccess: vi.fn(async () => ({
      cached: false,
      created: 0,
      changed: 0,
      unchanged: 0,
      recordCount: 0,
      syncedAt: "2026-08-06T00:00:00.000Z",
    })),
    markFailure: vi.fn(async () => undefined),
  };
}

function successfulCatchUpStore(): ProviderCatchUpStore {
  return {
    loadProgress: vi.fn(async () => ({
      cursorDate: "2026-08-06",
      overallStatus: "running" as const,
      states: [],
    })),
    saveProgress: vi.fn(async () => undefined),
  };
}

function successfulHistoryStore(): ProviderHistoryStore {
  return {
    load: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
  };
}

function fixture() {
  let status = baseStatus;
  let activeOwner: string | null = null;
  let cooldownUntil: Date | null = null;
  let cooldownKind: "normal" | "rate_limited" = "normal";
  let enteredProvider: (() => void) | null = null;
  let releaseProvider: (() => void) | null = null;
  const providerEntered = new Promise<void>((resolve) => {
    enteredProvider = resolve;
  });
  const providerRelease = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  const adapter: XunjiRuntimeAdapter = {
    fetchTrainsForDate: vi.fn(async () => {
      enteredProvider?.();
      await providerRelease;
      return [];
    }),
  };
  const dateStore = successfulDateSyncStore();
  const catchUpStore = successfulCatchUpStore();
  const historyStore = successfulHistoryStore();
  const automaticRecoveryStore: AutomaticProviderRecoveryClaimStore = {
    claim: vi.fn(async () => ({
      status: "claimed" as const,
      priorLastSucceededAt: null,
    })),
  };
  const store: XunjiCredentialStore = {
    requireTracker: vi.fn(async () => tracker),
    getStatus: vi.fn(async () => status),
    claimOperation: vi.fn(async () => {
      if (activeOwner) return { status: "busy" as const };
      activeOwner = "claimed-owner";
      return { status: "claimed" as const, plaintext: "anonymous-fake-key" };
    }),
    releaseOperation: vi.fn(async () => {
      activeOwner = null;
      return true;
    }),
    markFailure: vi.fn(async (_trackerId, _owner, _failedAt, errorCode) => {
      status = {
        ...status,
        sync: { ...status.sync, status: "failed", lastErrorCode: errorCode },
      };
      return true;
    }),
    claimProviderCooldown: vi.fn(async ({ claimedAt }) => {
      if (cooldownUntil && cooldownUntil > claimedAt) {
        return {
          status: "cooldown" as const,
          cooldown: {
            kind: cooldownKind,
            retryAvailableAt: cooldownUntil,
            retryAfterMs: cooldownUntil.valueOf() - claimedAt.valueOf(),
            serverNow: claimedAt,
          },
        };
      }
      cooldownUntil = new Date(claimedAt.valueOf() + 30_000);
      return {
        status: "claimed" as const,
        cooldown: {
          kind: "normal" as const,
          retryAvailableAt: cooldownUntil,
          retryAfterMs: 30_000,
          serverNow: claimedAt,
        },
      };
    }),
    extendProviderCooldown: vi.fn(
      async ({ now, cooldownUntil: nextCooldownUntil }) => {
        cooldownKind = "rate_limited";
        cooldownUntil = nextCooldownUntil;
        const cooldown = {
          kind: "rate_limited" as const,
          retryAvailableAt: nextCooldownUntil,
          retryAfterMs: nextCooldownUntil.valueOf() - now.valueOf(),
          serverNow: now,
        };
        return cooldown;
      },
    ),
  };
  const runtime = createXunjiRuntime({
    store,
    adapter,
    createDateSyncStore: () => dateStore,
    createCatchUpStore: () => catchUpStore,
    createHistoryStore: () => historyStore,
    automaticRecoveryStore,
    now: () => new Date("2026-08-06T00:00:00.000Z"),
  });
  return {
    runtime,
    store,
    adapter,
    automaticRecoveryStore,
    providerEntered,
    releaseProvider: () => releaseProvider?.(),
    dateStore,
    catchUpStore,
  };
}

describe("Xunji shared provider operation lease", () => {
  it("uses the frozen prior-success local date for automatic catch-up", async () => {
    const test = fixture();
    vi.mocked(test.automaticRecoveryStore.claim).mockResolvedValueOnce({
      status: "claimed",
      priorLastSucceededAt: new Date("2026-08-05T06:36:00.000Z"),
    });
    vi.mocked(test.catchUpStore.loadProgress).mockResolvedValueOnce({
      cursorDate: null,
      overallStatus: "running",
      states: [],
    });

    const recovery = test.runtime.recoverHistory({
      trackerKey: "anonymous-tracker",
      now: new Date("2026-08-06T00:27:00.000Z"),
      batchSize: 5,
    });
    await test.providerEntered;
    test.releaseProvider();

    await expect(recovery).resolves.toMatchObject({
      status: "completed",
      result: {
        batch: { from: "2026-08-05", to: "2026-08-06" },
        complete: true,
      },
    });
    expect(
      vi
        .mocked(test.adapter.fetchTrainsForDate)
        .mock.calls.map(([input]) => input.date),
    ).toEqual(["2026-08-05", "2026-08-06"]);
  });

  it("blocks manual catch-up while automatic recovery owns the provider I/O", async () => {
    const test = fixture();
    const recovery = test.runtime.recoverHistory({
      trackerKey: "anonymous-tracker",
    });
    await test.providerEntered;
    const automaticAttemptCount = vi.mocked(test.dateStore.markAttempt).mock
      .calls.length;

    const manual = test.runtime.syncCatchUp({
      trackerKey: "anonymous-tracker",
      batchSize: 1,
    });
    await expect(manual).rejects.toMatchObject({ code: "sync_in_progress" });
    expect(test.adapter.fetchTrainsForDate).toHaveBeenCalledTimes(1);
    expect(test.dateStore.markAttempt).toHaveBeenCalledTimes(
      automaticAttemptCount,
    );
    expect(test.catchUpStore.saveProgress).not.toHaveBeenCalled();

    test.releaseProvider();
    await expect(recovery).resolves.toMatchObject({ status: "completed" });
  });

  it("returns canonical in_progress when automatic recovery meets manual I/O", async () => {
    const test = fixture();
    const manual = test.runtime.syncCatchUp({
      trackerKey: "anonymous-tracker",
      batchSize: 1,
    });
    await test.providerEntered;

    await expect(
      test.runtime.recoverHistory({ trackerKey: "anonymous-tracker" }),
    ).resolves.toEqual({ status: "skipped", reason: "in_progress" });
    expect(test.automaticRecoveryStore.claim).not.toHaveBeenCalled();
    expect(test.adapter.fetchTrainsForDate).toHaveBeenCalledTimes(1);

    test.releaseProvider();
    await expect(manual).resolves.toMatchObject({ provider: "xunji" });
  });

  it("allows only one of two manual catch-up calls to reach the Provider", async () => {
    const test = fixture();
    const first = test.runtime.syncCatchUp({
      trackerKey: "anonymous-tracker",
      batchSize: 1,
    });
    await test.providerEntered;
    const second = test.runtime.syncCatchUp({
      trackerKey: "anonymous-tracker",
      batchSize: 1,
    });

    await expect(second).rejects.toMatchObject({ code: "sync_in_progress" });
    expect(test.adapter.fetchTrainsForDate).toHaveBeenCalledTimes(1);
    test.releaseProvider();
    await expect(first).resolves.toMatchObject({ provider: "xunji" });
  });

  it("shares the lease with bounded history instead of starting a second request", async () => {
    const test = fixture();
    const history = test.runtime.syncBoundedHistory({
      trackerKey: "anonymous-tracker",
      days: 7,
      batchSize: 1,
    });
    await test.providerEntered;
    const manual = test.runtime.syncCatchUp({
      trackerKey: "anonymous-tracker",
      batchSize: 1,
    });

    await expect(manual).rejects.toMatchObject({ code: "sync_in_progress" });
    expect(test.adapter.fetchTrainsForDate).toHaveBeenCalledTimes(1);
    test.releaseProvider();
    await expect(history).resolves.toMatchObject({ provider: "xunji" });
  });

  it("keeps a provider cooldown after the first scope releases its operation lease", async () => {
    const test = fixture();
    const first = test.runtime.syncCatchUp({
      trackerKey: "anonymous-tracker",
      batchSize: 1,
    });
    await test.providerEntered;
    test.releaseProvider();
    await expect(first).resolves.toMatchObject({ provider: "xunji" });

    await expect(
      test.runtime.syncBoundedHistory({
        trackerKey: "anonymous-tracker",
        days: 7,
        batchSize: 1,
      }),
    ).rejects.toMatchObject({
      code: "provider_cooldown",
      cooldown: { kind: "normal", retryAfterMs: 30_000 },
    });
    expect(test.adapter.fetchTrainsForDate).toHaveBeenCalledTimes(1);
  });

  it("extends the canonical cooldown when Xunji returns retry_after_ms", async () => {
    const test = fixture();
    test.adapter.fetchTrainsForDate = vi
      .fn()
      .mockRejectedValueOnce(
        new XunjiProviderError("rate_limited", { retryAfterMs: 45_000 }),
      );

    await expect(
      test.runtime.syncCatchUp({
        trackerKey: "anonymous-tracker",
        batchSize: 1,
      }),
    ).resolves.toMatchObject({
      days: [
        { status: "failed", errorCode: "rate_limited", retryAfterMs: 45_000 },
      ],
      cooldown: { kind: "rate_limited", retryAfterMs: 45_000 },
    });
    await expect(
      test.runtime.syncBoundedHistory({
        trackerKey: "anonymous-tracker",
        days: 7,
        batchSize: 1,
      }),
    ).rejects.toMatchObject({
      code: "provider_cooldown",
      cooldown: { kind: "rate_limited", retryAfterMs: 45_000 },
    });
  });
});
