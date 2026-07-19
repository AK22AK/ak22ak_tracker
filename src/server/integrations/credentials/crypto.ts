import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedIntegrationCredential = {
  algorithm: "aes-256-gcm";
  keyVersion: number;
  nonce: string;
  ciphertext: string;
  authTag: string;
};

function decodeKey(keyBase64: string) {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("invalid_integration_encryption_key");
  }
  return key;
}

function additionalAuthenticatedData(provider: string, keyVersion: number) {
  return Buffer.from(
    `ak22ak_tracker:integration-credential:${provider}:v${keyVersion}`,
    "utf8",
  );
}

export function encryptIntegrationCredential({
  plaintext,
  provider,
  keyBase64,
  keyVersion,
}: {
  plaintext: string;
  provider: string;
  keyBase64: string;
  keyVersion: number;
}): EncryptedIntegrationCredential {
  if (!Number.isInteger(keyVersion) || keyVersion < 1) {
    throw new Error("invalid_integration_encryption_key_version");
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", decodeKey(keyBase64), nonce);
  cipher.setAAD(additionalAuthenticatedData(provider, keyVersion));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    algorithm: "aes-256-gcm",
    keyVersion,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptIntegrationCredential({
  encrypted,
  provider,
  keyBase64,
}: {
  encrypted: EncryptedIntegrationCredential;
  provider: string;
  keyBase64: string;
}) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    decodeKey(keyBase64),
    Buffer.from(encrypted.nonce, "base64"),
  );
  decipher.setAAD(additionalAuthenticatedData(provider, encrypted.keyVersion));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
