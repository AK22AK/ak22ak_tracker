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
    }),
    read: vi.fn(async () => {
      if (plaintext === null) throw new Error("missing");
      return plaintext;
    }),
    markFailure: vi.fn(async (_trackerId, _failedAt, code) => {
      lastErrorCode = code;
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
  };
  const runtime = createGarminRuntime({
    store,
    client,
    now: () => new Date("2026-07-24T02:00:00.000Z"),
    assertEncryptionConfigured: vi.fn(),
  });
  return { runtime, store, client, getPlaintext: () => plaintext };
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
    expect(store.saveAndReset).toHaveBeenLastCalledWith(
      expect.objectContaining({
        verifiedAt: new Date("2026-07-24T02:00:00.000Z"),
        attemptedAt: new Date("2026-07-24T02:00:00.000Z"),
      }),
    );
    expect(JSON.stringify(result)).not.toContain("anonymous-activity-1");
    expect(JSON.stringify(result)).not.toContain("anonymous-access-token");
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
      expect.any(Date),
      "invalid_response",
    );
  });

  it("previews a user-selected historical day before the plan started", async () => {
    const { runtime, client } = fixture();
    await runtime.importCredential({ trackerKey: "knee-rehab", credential });
    vi.mocked(client.fetchActivitiesForDate).mockResolvedValueOnce({
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
    });

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
    expect(client.fetchActivitiesForDate).not.toHaveBeenCalled();
  });
});
