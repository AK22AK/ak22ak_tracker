import { describe, expect, it, vi } from "vitest";

import { createGarminPythonRuntimeClient } from "@/server/integrations/garmin/python-runtime-client";
import {
  garminPrivateClientDescriptor,
  type GarminCredential,
} from "@/server/integrations/garmin/contracts";

const credential: GarminCredential = {
  schemaVersion: 1,
  client: garminPrivateClientDescriptor.id,
  clientVersion: garminPrivateClientDescriptor.version,
  region: "global",
  tokenBundle: JSON.stringify({
    di_token: "anonymous-access-token",
    di_refresh_token: "anonymous-refresh-token",
    di_client_id: "anonymous-client-id",
  }),
};

const activity = {
  providerRecordId: "anonymous-activity-1",
  activityType: "running",
  startedAt: "2026-07-24T00:30:00.000Z",
  durationSeconds: 1_800,
  distanceMeters: 3_000,
  averagePaceSecondsPerKilometer: 360,
  averageHeartRateBpm: 128,
};

function client(fetchImpl: typeof fetch, timeoutMs = 12_000) {
  return createGarminPythonRuntimeClient({
    fetchImpl,
    resolveConfig: () => ({
      endpoint: "https://anonymous-runtime.example/api/garmin-runtime",
      secret: "anonymous-internal-secret",
    }),
    timeoutMs,
  });
}

describe("Garmin private Python runtime client", () => {
  it("sends the token only in an authenticated body and parses a strict response", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          schemaVersion: 1,
          operation: "preview_activities",
          clientVersion: "0.3.6",
          date: "2026-07-24",
          credential,
        });
        expect(String(_url)).not.toContain("anonymous-access-token");
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer anonymous-internal-secret",
          "X-AK-Garmin-Runtime-Version": "1",
        });
        return Response.json({
          ok: true,
          schemaVersion: 1,
          clientVersion: "0.3.6",
          activities: [activity],
          refreshedTokenBundle: credential.tokenBundle,
        });
      },
    );

    await expect(
      client(fetchMock as typeof fetch).fetchActivitiesForDate({
        credential,
        date: "2026-07-24",
      }),
    ).resolves.toEqual({
      activities: [activity],
      refreshedCredential: credential,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "classified provider failure",
      Response.json({ ok: false, errorCode: "rate_limited" }, { status: 429 }),
      "rate_limited",
    ],
    [
      "invalid response",
      Response.json({ ok: true, activities: [{ raw: "private" }] }),
      "invalid_response",
    ],
    [
      "internal authentication failure",
      Response.json(
        { ok: false, errorCode: "authentication" },
        { status: 401 },
      ),
      "provider_unavailable",
    ],
  ])("fails safely on %s", async (_name, response, expectedCode) => {
    const fetchMock = vi.fn(async () => response.clone());
    const promise = client(
      fetchMock as unknown as typeof fetch,
    ).fetchActivitiesForDate({ credential, date: "2026-07-24" });

    await expect(promise).rejects.toMatchObject({
      code: expectedCode,
    });
  });

  it("aborts a slow runtime with a bounded timeout", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );

    await expect(
      client(fetchMock as typeof fetch, 5).fetchActivitiesForDate({
        credential,
        date: "2026-07-24",
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });
});
