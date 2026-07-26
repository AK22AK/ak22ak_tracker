import { describe, expect, it, vi } from "vitest";

import type { IntegrationStatus } from "@/domain/integrations";
import {
  garminPrivateClientDescriptor,
  type GarminClient,
  type GarminCredential,
} from "@/server/integrations/garmin/contracts";
import { GarminProviderError } from "@/server/integrations/garmin/errors";
import {
  createGarminRuntime,
  type GarminCredentialStore,
} from "@/server/integrations/garmin/runtime";
import type { ProviderDateSyncStore } from "@/server/integrations/core/sync-provider-date";
import type { ProviderCatchUpStore } from "@/server/integrations/core/sync-provider-catch-up";
import type { AutomaticProviderRecoveryClaimStore } from "@/server/integrations/core/automatic-provider-recovery";

const credential: GarminCredential = {
  schemaVersion: 1,
  client: "python-garminconnect",
  clientVersion: "0.3.6",
  region: "global",
  tokenBundle: JSON.stringify({
    di_token: "anonymous-access-token",
    di_refresh_token: "anonymous-refresh-token",
    di_client_id: "anonymous-client-id",
  }),
};

function fixture() {
  let plaintext: string | null = null;
  let verifiedAt: Date | null = null;
  let lastErrorCode: string | null = null;
  let operationOwner: string | null = null;
  let operationExpiresAt: Date | null = null;
  const tracker = {
    id: "019c0000-0000-7000-8000-000000000001",
    key: "knee-rehab",
    startedOn: "2026-07-18",
    planningTimeZone: "Asia/Shanghai",
  };
  const status = (): IntegrationStatus => ({
    provider: "garmin",
    configured: plaintext !== null,
    maskedKey: plaintext === null ? null : "••••••••",
    verifiedAt: verifiedAt?.toISOString() ?? null,
    updatedAt: plaintext === null ? null : "2026-07-24T02:00:00.000Z",
    sync: {
      status: lastErrorCode ? "failed" : "idle",
      lastAttemptAt: null,
      lastSucceededAt: null,
      lastSucceededDate: null,
      lastErrorCode,
    },
  });
  const store: GarminCredentialStore = {
    requireTracker: vi.fn(async () => tracker),
    getStatus: vi.fn(async () => status()),
    saveAndReset: vi.fn(async (input) => {
      plaintext = input.plaintext;
      verifiedAt = input.verifiedAt;
      lastErrorCode = null;
      operationOwner = null;
      operationExpiresAt = null;
    }),
    claimOperation: vi.fn(async (input) => {
      if (plaintext === null) throw new Error("missing");
      if (
        operationOwner !== null &&
        operationExpiresAt !== null &&
        operationExpiresAt > input.claimedAt
      ) {
        return { status: "busy" as const };
      }
      operationOwner = input.owner;
      operationExpiresAt = input.expiresAt;
      return { status: "claimed" as const, plaintext };
    }),
    saveRefreshed: vi.fn(async (input) => {
      if (
        operationOwner !== input.owner ||
        operationExpiresAt === null ||
        operationExpiresAt <= input.savedAt
      ) {
        return false;
      }
      plaintext = input.plaintext;
      verifiedAt = input.verifiedAt;
      lastErrorCode = null;
      operationExpiresAt = input.expiresAt;
      return true;
    }),
    releaseOperation: vi.fn(async (input) => {
      if (operationOwner !== input.owner) return false;
      operationOwner = null;
      operationExpiresAt = null;
      return true;
    }),
    markFailure: vi.fn(async (_trackerId, owner, failedAt, code) => {
      if (
        operationOwner !== owner ||
        operationExpiresAt === null ||
        operationExpiresAt <= failedAt
      ) {
        return false;
      }
      lastErrorCode = code;
      return true;
    }),
  };
  const client: GarminClient<GarminCredential> = {
    descriptor: garminPrivateClientDescriptor,
    validateCredential: vi.fn(async () => ({ refreshedCredential: null })),
    fetchActivitiesForDate: vi.fn(async () => ({
      activities: [
        {
          providerRecordId: "anonymous-activity-1",
          activityType: "running",
          startedAt: "2026-07-24T00:30:00.000Z",
          durationSeconds: 1_800,
          distanceMeters: 3_000,
          averagePaceSecondsPerKilometer: 360,
          averageHeartRateBpm: 128,
        },
      ],
      refreshedCredential: credential,
    })),
    fetchWellnessForDate: vi.fn(async () => ({
      wellness: {
        localDate: "2026-07-24",
        steps: {
          status: "available" as const,
          totalSteps: 0,
          stepGoal: 8000,
        },
        sleep: {
          status: "missing" as const,
          sleepStart: null,
          sleepEnd: null,
          totalSleepSeconds: null,
          deepSleepSeconds: null,
          lightSleepSeconds: null,
          remSleepSeconds: null,
          awakeSleepSeconds: null,
          sleepScore: null,
        },
      },
      refreshedCredential: credential,
    })),
  };
  const committedRecords: unknown[] = [];
  const dateSyncStore: ProviderDateSyncStore = {
    getCachedSuccess: vi.fn(async () => null),
    markAttempt: vi.fn(async () => undefined),
    commitSuccess: vi.fn(async (input) => {
      committedRecords.push(...input.records);
      return {
        cached: false,
        created: input.records.length,
        changed: 0,
        unchanged: 0,
        recordCount: input.records.length,
        syncedAt: input.succeededAt.toISOString(),
      };
    }),
    markFailure: vi.fn(async () => undefined),
  };
  const catchUpStore: ProviderCatchUpStore = {
    loadProgress: vi.fn(async () => ({
      cursorDate: null,
      overallStatus: "idle" as const,
      states: [],
    })),
    saveProgress: vi.fn(async () => undefined),
  };
  const automaticRecoveryStore: AutomaticProviderRecoveryClaimStore = {
    claim: vi.fn(async () => "claimed" as const),
  };
  const runtime = createGarminRuntime({
    store,
    client,
    createDateSyncStore: () => dateSyncStore,
    createCatchUpStore: () => catchUpStore,
    automaticRecoveryStore,
    now: () => new Date("2026-07-24T02:00:00.000Z"),
    assertEncryptionConfigured: vi.fn(),
  });
  return {
    runtime,
    store,
    client,
    dateSyncStore,
    catchUpStore,
    automaticRecoveryStore,
    committedRecords,
    getPlaintext: () => plaintext,
  };
}

describe("P3b-2a Garmin token-only runtime", () => {
  it("imports a strict token bundle without verifying or returning plaintext", async () => {
    const { runtime, store, client, getPlaintext } = fixture();

    await expect(
      runtime.importCredential({ trackerKey: "knee-rehab", credential }),
    ).resolves.toMatchObject({
      provider: "garmin",
      state: "needs_validation",
      verifiedAt: null,
    });
    expect(store.saveAndReset).toHaveBeenCalledWith(
      expect.objectContaining({
        plaintext: JSON.stringify(credential),
        verifiedAt: null,
        attemptedAt: null,
      }),
    );
    expect(client.fetchActivitiesForDate).not.toHaveBeenCalled();
    expect(JSON.stringify(await runtime.status("knee-rehab"))).not.toContain(
      "anonymous-access-token",
    );
    expect(getPlaintext()).toContain("anonymous-access-token");
  });

  it("previews one day, refreshes the encrypted source, and omits provider IDs", async () => {
    const { runtime, store, client } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });

    const result = await runtime.previewActivities({
      trackerKey: "knee-rehab",
      date: "2026-07-24",
    });

    expect(result).toEqual({
      provider: "garmin",
      date: "2026-07-24",
      activities: [
        {
          activityType: "running",
          startedAt: "2026-07-24T00:30:00.000Z",
          durationSeconds: 1_800,
          distanceMeters: 3_000,
          averagePaceSecondsPerKilometer: 360,
          averageHeartRateBpm: 128,
        },
      ],
      connection: expect.objectContaining({ state: "connected" }),
    });
    expect(client.fetchActivitiesForDate).toHaveBeenCalledWith({
      credential,
      date: "2026-07-24",
    });
    expect(store.saveRefreshed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        verifiedAt: new Date("2026-07-24T02:00:00.000Z"),
        savedAt: new Date("2026-07-24T02:00:00.000Z"),
      }),
    );
    expect(JSON.stringify(result)).not.toContain("anonymous-activity-1");
    expect(JSON.stringify(result)).not.toContain("anonymous-access-token");
  });

  it("catches up from the tracker start in a bounded batch and carries refreshed credentials forward", async () => {
    const { runtime, client, catchUpStore, store } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    const refreshed = {
      ...credential,
      tokenBundle: JSON.stringify({
        di_token: "anonymous-refreshed-token",
        di_refresh_token: "anonymous-refresh-token-2",
        di_client_id: "anonymous-client-id",
      }),
    };
    vi.mocked(client.fetchActivitiesForDate).mockImplementation(
      async ({ credential: current, date }) => ({
        activities: [
          {
            providerRecordId: `anonymous-${date}`,
            activityType: "walking",
            startedAt: `${date}T00:30:00.000Z`,
            durationSeconds: 900,
            distanceMeters: 1_000,
            averagePaceSecondsPerKilometer: 900,
            averageHeartRateBpm: 100,
          },
        ],
        refreshedCredential: date === "2026-07-18" ? refreshed : current,
      }),
    );

    const result = await runtime.syncActivityHistory({
      trackerKey: "knee-rehab",
    });

    expect(result).toMatchObject({
      provider: "garmin",
      batch: { from: "2026-07-18", to: "2026-07-22" },
      targetDate: "2026-07-24",
      nextCursor: "2026-07-23",
      complete: false,
      summary: { succeeded: 5, failed: 0 },
    });
    expect(client.fetchActivitiesForDate).toHaveBeenCalledTimes(5);
    expect(client.fetchActivitiesForDate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ credential: refreshed, date: "2026-07-19" }),
    );
    expect(store.saveRefreshed).toHaveBeenCalledTimes(5);
    expect(catchUpStore.saveProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        cursorDate: "2026-07-23",
        status: "running",
      }),
    );
  });

  it("uses a two-day overlap after initial coverage is complete", async () => {
    const { runtime, client, catchUpStore } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    vi.mocked(catchUpStore.loadProgress).mockResolvedValueOnce({
      cursorDate: null,
      overallStatus: "succeeded",
      states: [
        "2026-07-18",
        "2026-07-19",
        "2026-07-20",
        "2026-07-21",
        "2026-07-22",
        "2026-07-23",
        "2026-07-24",
      ].map((date) => ({ date, status: "succeeded" as const })),
    });
    vi.mocked(client.fetchActivitiesForDate).mockResolvedValue({
      activities: [],
      refreshedCredential: credential,
    });

    const result = await runtime.syncActivityHistory({
      trackerKey: "knee-rehab",
    });

    expect(result.batch).toEqual({
      from: "2026-07-22",
      to: "2026-07-24",
    });
    expect(result.complete).toBe(true);
    expect(client.fetchActivitiesForDate).toHaveBeenCalledTimes(3);
  });

  it("skips automatic recovery before a credential is connected", async () => {
    const { runtime, client, automaticRecoveryStore } = fixture();

    await expect(
      runtime.recoverActivityHistory({ trackerKey: "knee-rehab" }),
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "not_connected",
      connection: { state: "not_connected" },
    });
    expect(automaticRecoveryStore.claim).not.toHaveBeenCalled();
    expect(client.fetchActivitiesForDate).not.toHaveBeenCalled();
  });

  it("uses the server claim for automatic due checks without affecting manual sync", async () => {
    const { runtime, client, automaticRecoveryStore } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    await runtime.previewActivities({
      trackerKey: "knee-rehab",
      date: "2026-07-24",
    });
    vi.mocked(client.fetchActivitiesForDate).mockClear();
    vi.mocked(client.fetchActivitiesForDate).mockResolvedValue({
      activities: [],
      refreshedCredential: credential,
    });
    vi.mocked(automaticRecoveryStore.claim).mockResolvedValueOnce("not_due");

    await expect(
      runtime.recoverActivityHistory({ trackerKey: "knee-rehab" }),
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "not_due",
      connection: { state: "connected" },
    });
    expect(client.fetchActivitiesForDate).not.toHaveBeenCalled();
    expect(automaticRecoveryStore.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "garmin",
        minimumIntervalMs: 30 * 60_000,
        leaseMs: 2 * 60_000,
      }),
    );
  });

  it("uses the same automatic claim with a three-day daily Cron profile", async () => {
    const { runtime, client, automaticRecoveryStore } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    await runtime.previewActivities({
      trackerKey: "knee-rehab",
      date: "2026-07-24",
    });
    vi.mocked(client.fetchActivitiesForDate).mockClear();
    vi.mocked(client.fetchActivitiesForDate).mockResolvedValue({
      activities: [],
      refreshedCredential: credential,
    });

    const result = await runtime.recoverActivityHistory({
      trackerKey: "knee-rehab",
      profile: "daily_cron",
    });

    expect(result).toMatchObject({
      status: "completed",
      sync: {
        batch: { from: "2026-07-18", to: "2026-07-20" },
        nextCursor: "2026-07-21",
        complete: false,
        summary: { succeeded: 3, failed: 0 },
      },
    });
    expect(client.fetchActivitiesForDate).toHaveBeenCalledTimes(3);
    expect(automaticRecoveryStore.claim).toHaveBeenCalledOnce();
  });

  it("stops a daily Cron batch on its first failed day", async () => {
    const { runtime, client } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    await runtime.previewActivities({
      trackerKey: "knee-rehab",
      date: "2026-07-24",
    });
    vi.mocked(client.fetchActivitiesForDate).mockReset();
    vi.mocked(client.fetchActivitiesForDate)
      .mockResolvedValueOnce({
        activities: [],
        refreshedCredential: credential,
      })
      .mockRejectedValueOnce(new GarminProviderError("timeout"));

    const result = await runtime.recoverActivityHistory({
      trackerKey: "knee-rehab",
      profile: "daily_cron",
    });

    expect(result).toMatchObject({
      status: "completed",
      sync: {
        nextCursor: "2026-07-19",
        complete: false,
        summary: { succeeded: 1, failed: 1 },
        days: [
          { date: "2026-07-18", status: "succeeded" },
          { date: "2026-07-19", status: "failed", errorCode: "timeout" },
        ],
      },
    });
    expect(client.fetchActivitiesForDate).toHaveBeenCalledTimes(2);
  });

  it("does not automatically retry a credential that needs refresh", async () => {
    const { runtime, client, automaticRecoveryStore } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    vi.mocked(client.fetchActivitiesForDate).mockRejectedValueOnce(
      new GarminProviderError("authentication"),
    );
    await expect(
      runtime.previewActivities({
        trackerKey: "knee-rehab",
        date: "2026-07-24",
      }),
    ).rejects.toMatchObject({ code: "authentication" });
    vi.mocked(client.fetchActivitiesForDate).mockClear();

    await expect(
      runtime.recoverActivityHistory({ trackerKey: "knee-rehab" }),
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "needs_refresh",
      connection: { state: "needs_refresh" },
    });
    expect(automaticRecoveryStore.claim).not.toHaveBeenCalled();
    expect(client.fetchActivitiesForDate).not.toHaveBeenCalled();
  });

  it("stops on the first failed day and resumes from that date", async () => {
    const { runtime, client, catchUpStore } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    vi.mocked(client.fetchActivitiesForDate)
      .mockResolvedValueOnce({
        activities: [],
        refreshedCredential: credential,
      })
      .mockRejectedValueOnce(new GarminProviderError("rate_limited"));

    const failed = await runtime.syncActivityHistory({
      trackerKey: "knee-rehab",
    });

    expect(failed).toMatchObject({
      nextCursor: "2026-07-19",
      complete: false,
      summary: { succeeded: 1, failed: 1 },
      days: [
        { date: "2026-07-18", status: "succeeded" },
        {
          date: "2026-07-19",
          status: "failed",
          errorCode: "rate_limited",
        },
      ],
    });
    expect(client.fetchActivitiesForDate).toHaveBeenCalledTimes(2);
    expect(catchUpStore.saveProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        cursorDate: "2026-07-19",
        status: "failed",
        lastErrorCode: "rate_limited",
      }),
    );
  });

  it("preserves the credential and marks a safe state when the Provider rejects it", async () => {
    const { runtime, store, client, getPlaintext } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    vi.mocked(client.fetchActivitiesForDate).mockRejectedValueOnce(
      new GarminProviderError("authentication", {
        cause: new Error("private provider response"),
      }),
    );

    await expect(
      runtime.previewActivities({
        trackerKey: "knee-rehab",
        date: "2026-07-24",
      }),
    ).rejects.toMatchObject({ code: "authentication" });
    expect(store.markFailure).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Date),
      "authentication",
    );
    await expect(runtime.status("knee-rehab")).resolves.toMatchObject({
      state: "needs_refresh",
      lastErrorCode: "authentication",
    });
    expect(getPlaintext()).toBe(JSON.stringify(credential));
  });

  it("rejects an activity outside the requested planning date", async () => {
    const { runtime, store, client } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    vi.mocked(client.fetchActivitiesForDate).mockResolvedValueOnce({
      activities: [
        {
          providerRecordId: "anonymous-wrong-day",
          activityType: "walking",
          startedAt: "2026-07-22T00:30:00.000Z",
          durationSeconds: 600,
          distanceMeters: 700,
          averagePaceSecondsPerKilometer: 857,
          averageHeartRateBpm: null,
        },
      ],
      refreshedCredential: credential,
    });

    await expect(
      runtime.previewActivities({
        trackerKey: "knee-rehab",
        date: "2026-07-24",
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(store.markFailure).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Date),
      "invalid_response",
    );
  });

  it("previews a user-selected historical day before the plan started", async () => {
    const { runtime, client } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    const historicalResult = {
      activities: [
        {
          providerRecordId: "anonymous-walking-activity",
          activityType: "walking",
          startedAt: "2026-07-13T00:30:00.000Z",
          durationSeconds: 1_200,
          distanceMeters: 1_400,
          averagePaceSecondsPerKilometer: 857,
          averageHeartRateBpm: 96,
        },
      ],
      refreshedCredential: credential,
    };
    vi.mocked(client.fetchActivitiesForDate).mockResolvedValue(
      historicalResult,
    );

    await expect(
      runtime.previewActivities({
        trackerKey: "knee-rehab",
        date: "2026-07-13",
      }),
    ).resolves.toMatchObject({
      date: "2026-07-13",
      activities: [{ activityType: "walking" }],
    });
    expect(client.fetchActivitiesForDate).toHaveBeenCalledWith({
      credential,
      date: "2026-07-13",
    });
    await expect(
      runtime.syncActivities({
        trackerKey: "knee-rehab",
        date: "2026-07-13",
      }),
    ).resolves.toMatchObject({
      date: "2026-07-13",
      sync: { created: 1 },
    });
  });

  it("rejects a future date without calling Garmin", async () => {
    const { runtime, client } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });

    await expect(
      runtime.previewActivities({
        trackerKey: "knee-rehab",
        date: "2026-07-25",
      }),
    ).rejects.toThrow("garmin_preview_date_out_of_range");
    await expect(
      runtime.syncActivities({
        trackerKey: "knee-rehab",
        date: "2026-07-25",
      }),
    ).rejects.toThrow("garmin_preview_date_out_of_range");
    expect(client.fetchActivitiesForDate).not.toHaveBeenCalled();
  });

  it("persists one selected day through the provider-neutral date store", async () => {
    const { runtime, dateSyncStore, committedRecords } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });

    const result = await runtime.syncActivities({
      trackerKey: "knee-rehab",
      date: "2026-07-24",
    });

    expect(result).toMatchObject({
      provider: "garmin",
      date: "2026-07-24",
      sync: { created: 1, changed: 0, recordCount: 1 },
      connection: { state: "connected" },
    });
    expect(dateSyncStore.commitSuccess).toHaveBeenCalledOnce();
    expect(committedRecords).toEqual([
      expect.objectContaining({
        provider: "garmin",
        providerRecordId: "anonymous-activity-1",
        kind: "activity",
        localDate: "2026-07-24",
        payload: expect.not.objectContaining({
          providerRecordId: expect.anything(),
        }),
      }),
    ]);
  });

  it("does not call Garmin again while the same-day success is cached", async () => {
    const { runtime, client, dateSyncStore } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    vi.mocked(dateSyncStore.getCachedSuccess).mockResolvedValueOnce({
      cached: true,
      created: 0,
      changed: 0,
      unchanged: 1,
      recordCount: 1,
      syncedAt: "2026-07-24T01:59:00.000Z",
    });

    const result = await runtime.syncActivities({
      trackerKey: "knee-rehab",
      date: "2026-07-24",
    });

    expect(result.sync.cached).toBe(true);
    expect(client.fetchActivitiesForDate).not.toHaveBeenCalled();
    expect(dateSyncStore.commitSuccess).not.toHaveBeenCalled();
  });

  it("isolates a Provider failure to date sync state without committing records", async () => {
    const { runtime, client, dateSyncStore } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    vi.mocked(client.fetchActivitiesForDate).mockRejectedValueOnce(
      new GarminProviderError("rate_limited"),
    );

    await expect(
      runtime.syncActivities({
        trackerKey: "knee-rehab",
        date: "2026-07-24",
      }),
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(dateSyncStore.markFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "garmin",
        date: "2026-07-24",
        errorCode: "rate_limited",
      }),
    );
    expect(dateSyncStore.commitSuccess).not.toHaveBeenCalled();
  });
});

describe("P5a-2a Garmin single-day wellness runtime", () => {
  it("persists one explicit day as a non-training record and refreshes the credential", async () => {
    const { runtime, client, store, committedRecords } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });

    await expect(
      runtime.syncWellness({
        trackerKey: "knee-rehab",
        date: "2026-07-24",
      }),
    ).resolves.toMatchObject({
      provider: "garmin",
      date: "2026-07-24",
      sync: { created: 1, recordCount: 1 },
    });

    expect(client.fetchWellnessForDate).toHaveBeenCalledWith({
      credential,
      date: "2026-07-24",
    });
    expect(store.saveRefreshed).toHaveBeenCalledWith(
      expect.objectContaining({ plaintext: JSON.stringify(credential) }),
    );
    expect(committedRecords).toEqual([
      expect.objectContaining({
        provider: "garmin",
        providerRecordId: "daily_wellness:2026-07-24",
        kind: "daily_wellness",
      }),
    ]);
  });

  it("rejects a future day before calling the Provider", async () => {
    const { runtime, client } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });

    await expect(
      runtime.syncWellness({
        trackerKey: "knee-rehab",
        date: "2026-07-25",
      }),
    ).rejects.toMatchObject({ name: "GarminPreviewDateOutOfRangeError" });
    expect(client.fetchWellnessForDate).not.toHaveBeenCalled();
  });

  it("records one safe wellness failure without touching committed activity data", async () => {
    const { runtime, client, dateSyncStore, committedRecords } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    vi.mocked(client.fetchWellnessForDate).mockRejectedValueOnce(
      new GarminProviderError("timeout"),
    );

    await expect(
      runtime.syncWellness({
        trackerKey: "knee-rehab",
        date: "2026-07-24",
      }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(dateSyncStore.markFailure).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "timeout" }),
    );
    expect(dateSyncStore.commitSuccess).not.toHaveBeenCalled();
    expect(committedRecords).toEqual([]);
  });
});

describe("P5a-2b Garmin wellness catch-up", () => {
  it("uses a server-owned five-day batch and an isolated wellness cursor", async () => {
    const { runtime, client, catchUpStore } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    vi.mocked(client.fetchWellnessForDate).mockImplementation(
      async ({ date }) => ({
        wellness: {
          localDate: date,
          steps: { status: "available", totalSteps: 0, stepGoal: null },
          sleep: {
            status: "missing",
            sleepStart: null,
            sleepEnd: null,
            totalSleepSeconds: null,
            deepSleepSeconds: null,
            lightSleepSeconds: null,
            remSleepSeconds: null,
            awakeSleepSeconds: null,
            sleepScore: null,
          },
        },
        refreshedCredential: credential,
      }),
    );

    const result = await runtime.syncWellnessHistory({
      trackerKey: "knee-rehab",
    });

    expect(result.days.map((day) => day.date)).toEqual([
      "2026-07-18",
      "2026-07-19",
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
    ]);
    expect(result.nextCursor).toBe("2026-07-23");
    expect(catchUpStore.loadProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "garmin_wellness",
        startedOn: "2026-07-18",
        targetDate: "2026-07-24",
      }),
    );
  });

  it("rechecks the two-day overlap after initial wellness coverage", async () => {
    const { runtime, client, catchUpStore } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    vi.mocked(catchUpStore.loadProgress).mockResolvedValueOnce({
      cursorDate: null,
      overallStatus: "succeeded",
      states: [
        "2026-07-18",
        "2026-07-19",
        "2026-07-20",
        "2026-07-21",
        "2026-07-22",
        "2026-07-23",
        "2026-07-24",
      ].map((date) => ({ date, status: "succeeded" as const })),
    });
    vi.mocked(client.fetchWellnessForDate).mockImplementation(
      async ({ date }) => ({
        wellness: {
          localDate: date,
          steps: { status: "available", totalSteps: 0, stepGoal: null },
          sleep: {
            status: "missing",
            sleepStart: null,
            sleepEnd: null,
            totalSleepSeconds: null,
            deepSleepSeconds: null,
            lightSleepSeconds: null,
            remSleepSeconds: null,
            awakeSleepSeconds: null,
            sleepScore: null,
          },
        },
        refreshedCredential: credential,
      }),
    );

    const result = await runtime.syncWellnessHistory({
      trackerKey: "knee-rehab",
    });

    expect(result.batch).toEqual({
      from: "2026-07-22",
      to: "2026-07-24",
    });
    expect(result.complete).toBe(true);
    expect(client.fetchWellnessForDate).toHaveBeenCalledTimes(3);
  });

  it("skips foreground wellness recovery until the credential is connected", async () => {
    const { runtime, client, automaticRecoveryStore } = fixture();

    await expect(
      runtime.recoverWellnessHistory({ trackerKey: "knee-rehab" }),
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "not_connected",
    });
    expect(automaticRecoveryStore.claim).not.toHaveBeenCalled();
    expect(client.fetchWellnessForDate).not.toHaveBeenCalled();
  });

  it("marks the shared Garmin credential when wellness authentication fails", async () => {
    const { runtime, client, store, catchUpStore } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    vi.mocked(client.fetchWellnessForDate).mockRejectedValueOnce(
      new GarminProviderError("authentication"),
    );

    const result = await runtime.syncWellnessHistory({
      trackerKey: "knee-rehab",
    });

    expect(result).toMatchObject({
      days: [
        {
          date: "2026-07-18",
          status: "failed",
          errorCode: "authentication",
        },
      ],
      nextCursor: "2026-07-18",
      complete: false,
    });
    expect(store.markFailure).toHaveBeenCalledWith(
      "019c0000-0000-7000-8000-000000000001",
      expect.any(String),
      new Date("2026-07-24T02:00:00.000Z"),
      "authentication",
    );
    expect(catchUpStore.saveProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "garmin_wellness",
        cursorDate: "2026-07-18",
        status: "failed",
        lastErrorCode: "authentication",
      }),
    );
  });

  it("claims an independent wellness recovery lease without touching activity scope", async () => {
    const { runtime, client, automaticRecoveryStore } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    await runtime.syncWellness({
      trackerKey: "knee-rehab",
      date: "2026-07-24",
    });
    vi.mocked(client.fetchWellnessForDate).mockImplementation(
      async ({ date }) => ({
        wellness: {
          localDate: date,
          steps: { status: "missing", totalSteps: null, stepGoal: null },
          sleep: {
            status: "missing",
            sleepStart: null,
            sleepEnd: null,
            totalSleepSeconds: null,
            deepSleepSeconds: null,
            lightSleepSeconds: null,
            remSleepSeconds: null,
            awakeSleepSeconds: null,
            sleepScore: null,
          },
        },
        refreshedCredential: credential,
      }),
    );

    await expect(
      runtime.recoverWellnessHistory({ trackerKey: "knee-rehab" }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(automaticRecoveryStore.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "garmin_wellness",
        minimumIntervalMs: 30 * 60_000,
        leaseMs: 2 * 60_000,
      }),
    );
    expect(automaticRecoveryStore.claim).not.toHaveBeenCalledWith(
      expect.objectContaining({ provider: "garmin" }),
    );
  });
});

describe("P5a-2b shared Garmin credential operation", () => {
  it("allows only one activity or wellness Provider call at a time", async () => {
    const { runtime, client } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    let releaseActivity: (() => void) | undefined;
    vi.mocked(client.fetchActivitiesForDate).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseActivity = () =>
            resolve({ activities: [], refreshedCredential: credential });
        }),
    );

    const activity = runtime.syncActivities({
      trackerKey: "knee-rehab",
      date: "2026-07-24",
    });
    await vi.waitFor(() =>
      expect(client.fetchActivitiesForDate).toHaveBeenCalledOnce(),
    );

    try {
      await expect(
        runtime.syncWellness({
          trackerKey: "knee-rehab",
          date: "2026-07-24",
        }),
      ).rejects.toMatchObject({ code: "sync_in_progress" });
      expect(client.fetchWellnessForDate).not.toHaveBeenCalled();
    } finally {
      releaseActivity?.();
      await activity;
    }
  });

  it("skips automatic recovery before touching its business claim when the shared operation is busy", async () => {
    const { runtime, client, automaticRecoveryStore } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    await runtime.syncActivities({
      trackerKey: "knee-rehab",
      date: "2026-07-24",
    });
    vi.mocked(automaticRecoveryStore.claim).mockClear();
    vi.mocked(client.fetchActivitiesForDate).mockClear();
    let releaseActivity: (() => void) | undefined;
    vi.mocked(client.fetchActivitiesForDate).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseActivity = () =>
            resolve({ activities: [], refreshedCredential: credential });
        }),
    );
    const activity = runtime.syncActivities({
      trackerKey: "knee-rehab",
      date: "2026-07-23",
    });
    await vi.waitFor(() =>
      expect(client.fetchActivitiesForDate).toHaveBeenCalledOnce(),
    );

    try {
      await expect(
        runtime.recoverWellnessHistory({ trackerKey: "knee-rehab" }),
      ).resolves.toMatchObject({ status: "skipped", reason: "in_progress" });
      expect(automaticRecoveryStore.claim).not.toHaveBeenCalled();
    } finally {
      releaseActivity?.();
      await activity;
    }
  });

  it("does not let an older Provider response overwrite a replacement credential", async () => {
    const { runtime, client, getPlaintext } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    let releaseActivity: (() => void) | undefined;
    const staleRefreshedCredential = {
      ...credential,
      tokenBundle: JSON.stringify({
        di_token: "anonymous-stale-access-token",
        di_refresh_token: "anonymous-stale-refresh-token",
        di_client_id: "anonymous-client-id",
      }),
    };
    vi.mocked(client.fetchActivitiesForDate).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseActivity = () =>
            resolve({
              activities: [],
              refreshedCredential: staleRefreshedCredential,
            });
        }),
    );
    const activity = runtime.syncActivities({
      trackerKey: "knee-rehab",
      date: "2026-07-24",
    });
    await vi.waitFor(() =>
      expect(client.fetchActivitiesForDate).toHaveBeenCalledOnce(),
    );

    const replacement = {
      ...credential,
      tokenBundle: JSON.stringify({
        di_token: "anonymous-replacement-access-token",
        di_refresh_token: "anonymous-replacement-refresh-token",
        di_client_id: "anonymous-client-id",
      }),
    };
    await runtime.importCredential({
      trackerKey: "knee-rehab",
      credential: replacement,
    });
    releaseActivity?.();

    await expect(activity).rejects.toMatchObject({ code: "sync_in_progress" });
    expect(getPlaintext()).toBe(JSON.stringify(replacement));
  });
});
