import "server-only";

import type { EncryptedIntegrationCredential } from "./crypto";

export function publicCredentialStatus({
  provider,
  configured,
  verifiedAt,
  updatedAt,
}: {
  provider: string;
  configured: boolean;
  verifiedAt: Date | null;
  updatedAt: Date | null;
  encrypted?: EncryptedIntegrationCredential;
}) {
  return {
    provider,
    configured,
    maskedKey: configured ? "••••••••" : null,
    verifiedAt: verifiedAt?.toISOString() ?? null,
    updatedAt: updatedAt?.toISOString() ?? null,
  };
}
