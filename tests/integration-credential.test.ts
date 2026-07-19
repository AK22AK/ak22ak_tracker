import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decryptIntegrationCredential,
  encryptIntegrationCredential,
} from "@/server/integrations/credentials/crypto";
import { publicCredentialStatus } from "@/server/integrations/credentials/public-status";

describe("integration credential boundary", () => {
  const key = randomBytes(32).toString("base64");

  it("encrypts with a fresh nonce and binds ciphertext to provider and key version", () => {
    const first = encryptIntegrationCredential({
      plaintext: "anonymous-api-key",
      provider: "xunji",
      keyBase64: key,
      keyVersion: 3,
    });
    const second = encryptIntegrationCredential({
      plaintext: "anonymous-api-key",
      provider: "xunji",
      keyBase64: key,
      keyVersion: 3,
    });

    expect(first.algorithm).toBe("aes-256-gcm");
    expect(first.keyVersion).toBe(3);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(
      decryptIntegrationCredential({
        encrypted: first,
        provider: "xunji",
        keyBase64: key,
      }),
    ).toBe("anonymous-api-key");
    expect(() =>
      decryptIntegrationCredential({
        encrypted: first,
        provider: "garmin",
        keyBase64: key,
      }),
    ).toThrow();
  });

  it("returns connection metadata without any recoverable credential material", () => {
    const status = publicCredentialStatus({
      provider: "xunji",
      configured: true,
      verifiedAt: new Date("2026-07-19T08:00:00.000Z"),
      updatedAt: new Date("2026-07-19T08:05:00.000Z"),
      encrypted: {
        algorithm: "aes-256-gcm",
        keyVersion: 1,
        nonce: "private-nonce",
        ciphertext: "private-ciphertext",
        authTag: "private-tag",
      },
    });

    expect(status).toEqual({
      provider: "xunji",
      configured: true,
      maskedKey: "••••••••",
      verifiedAt: "2026-07-19T08:00:00.000Z",
      updatedAt: "2026-07-19T08:05:00.000Z",
    });
    expect(JSON.stringify(status)).not.toContain("private");
    expect(JSON.stringify(status)).not.toContain("anonymous-api-key");
  });
});
