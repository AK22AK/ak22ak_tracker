import "server-only";

export function getIntegrationEncryptionConfig() {
  const keyBase64 = process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY;
  const keyVersion = Number(
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY_VERSION ?? "1",
  );
  if (!keyBase64) throw new Error("integration_encryption_key_missing");
  if (!Number.isInteger(keyVersion) || keyVersion < 1) {
    throw new Error("integration_encryption_key_version_invalid");
  }
  return { keyBase64, keyVersion };
}
