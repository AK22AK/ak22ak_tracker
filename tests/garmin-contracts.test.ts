import { describe, expect, it } from "vitest";

import {
  garminActivityEvidenceSchema,
  garminCredentialSchema,
  garminPrivateClientDescriptor,
} from "@/server/integrations/garmin/contracts";
import {
  GarminProviderError,
  garminRuntimeFailureSchema,
  isRetryableGarminError,
} from "@/server/integrations/garmin/errors";
import {
  decryptIntegrationCredential,
  encryptIntegrationCredential,
} from "@/server/integrations/credentials/crypto";
import { publicCredentialStatus } from "@/server/integrations/credentials/public-status";

const anonymousTokenBundle = JSON.stringify({
  di_token: "anonymous-access-token",
  di_refresh_token: "anonymous-refresh-token",
  di_client_id: "anonymous-client-id",
});

const anonymousCredential = {
  schemaVersion: 1,
  client: garminPrivateClientDescriptor.id,
  clientVersion: garminPrivateClientDescriptor.version,
  region: "global",
  tokenBundle: anonymousTokenBundle,
} as const;

describe("P3b-1 Garmin credential boundary", () => {
  it("accepts only the pinned opaque token credential envelope", () => {
    expect(garminCredentialSchema.parse(anonymousCredential)).toEqual(
      anonymousCredential,
    );
    expect(
      garminCredentialSchema.safeParse({
        ...anonymousCredential,
        password: "anonymous-password",
      }).success,
    ).toBe(false);
    expect(
      garminCredentialSchema.safeParse({
        ...anonymousCredential,
        clientVersion: "latest",
      }).success,
    ).toBe(false);
    expect(
      garminCredentialSchema.safeParse({
        ...anonymousCredential,
        tokenBundle: JSON.stringify({ di_token: "anonymous" }),
      }).success,
    ).toBe(false);
  });

  it("reuses randomized provider-bound encryption without public readback", () => {
    const keyBase64 = Buffer.alloc(32, 7).toString("base64");
    const plaintext = JSON.stringify(anonymousCredential);
    const first = encryptIntegrationCredential({
      plaintext,
      provider: "garmin",
      keyBase64,
      keyVersion: 3,
    });
    const second = encryptIntegrationCredential({
      plaintext,
      provider: "garmin",
      keyBase64,
      keyVersion: 3,
    });

    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(
      decryptIntegrationCredential({
        encrypted: first,
        provider: "garmin",
        keyBase64,
      }),
    ).toBe(plaintext);
    expect(() =>
      decryptIntegrationCredential({
        encrypted: first,
        provider: "xunji",
        keyBase64,
      }),
    ).toThrow();

    const status = publicCredentialStatus({
      provider: "garmin",
      configured: true,
      verifiedAt: new Date("2026-07-24T00:00:00.000Z"),
      updatedAt: new Date("2026-07-24T00:00:00.000Z"),
      encrypted: first,
    });
    expect(status).toEqual({
      provider: "garmin",
      configured: true,
      maskedKey: "••••••••",
      verifiedAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z",
    });
    expect(JSON.stringify(status)).not.toContain("anonymous-access-token");
    expect(JSON.stringify(status)).not.toContain(first.ciphertext);
  });
});

describe("P3b-1 Garmin evidence and failure boundaries", () => {
  it("keeps activity evidence separate from task completion", () => {
    const evidence = {
      providerRecordId: "anonymous-activity-1",
      activityType: "running",
      startedAt: "2026-07-24T06:30:00.000+08:00",
      durationSeconds: 1_800,
      distanceMeters: 3_100,
      averagePaceSecondsPerKilometer: 348,
      averageHeartRateBpm: 132,
    };

    expect(garminActivityEvidenceSchema.parse(evidence)).toEqual(evidence);
    expect(
      garminActivityEvidenceSchema.safeParse({
        ...evidence,
        taskStatus: "completed",
      }).success,
    ).toBe(false);
  });

  it("exposes only safe classified failures", () => {
    expect(
      garminRuntimeFailureSchema.parse({
        ok: false,
        errorCode: "authentication",
      }),
    ).toEqual({ ok: false, errorCode: "authentication" });
    expect(
      garminRuntimeFailureSchema.safeParse({
        ok: false,
        errorCode: "authentication",
        rawError: "private provider response",
      }).success,
    ).toBe(false);

    const error = new GarminProviderError("rate_limited", {
      cause: new Error("private provider response"),
    });
    expect(error.message).toBe("garmin_rate_limited");
    expect(error.code).toBe("rate_limited");
    expect(isRetryableGarminError(error.code)).toBe(true);
    expect(isRetryableGarminError("authentication")).toBe(false);
    expect(isRetryableGarminError("invalid_token_bundle")).toBe(false);
  });
});
