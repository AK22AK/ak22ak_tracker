import "server-only";

import type {
  IntegrationProvider,
  NormalizedExternalRecord,
} from "./external-records";
import { IntegrationOperationInterruptedError } from "../credentials/operation-errors";

export type ProviderDateSyncResult = {
  cached: boolean;
  created: number;
  changed: number;
  unchanged: number;
  recordCount: number;
  syncedAt: string;
};

export type ProviderDateSyncStore = {
  getCachedSuccess(input: {
    trackerId: string;
    provider: IntegrationProvider;
    date: string;
    now: Date;
  }): Promise<ProviderDateSyncResult | null>;
  markAttempt(input: {
    trackerId: string;
    provider: IntegrationProvider;
    date: string;
    attemptedAt: Date;
  }): Promise<void>;
  commitSuccess(input: {
    trackerId: string;
    provider: IntegrationProvider;
    date: string;
    records: NormalizedExternalRecord[];
    succeededAt: Date;
    cachedUntil: Date;
  }): Promise<ProviderDateSyncResult>;
  markFailure(input: {
    trackerId: string;
    provider: IntegrationProvider;
    date: string;
    failedAt: Date;
    errorCode: string;
  }): Promise<void>;
};

export function providerPublicErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "provider_unavailable";
}

export function providerPublicRetryAfterMs(error: unknown): number | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("retryAfterMs" in error) ||
    typeof error.retryAfterMs !== "number" ||
    !Number.isFinite(error.retryAfterMs) ||
    !Number.isInteger(error.retryAfterMs) ||
    error.retryAfterMs < 0 ||
    error.retryAfterMs > 86_400_000
  ) {
    return undefined;
  }
  return error.retryAfterMs;
}

export async function syncProviderDate(input: {
  trackerId: string;
  provider: IntegrationProvider;
  date: string;
  now: Date;
  store: ProviderDateSyncStore;
  readSource: () => Promise<NormalizedExternalRecord[]>;
  beforeReadSource?: () => Promise<void>;
}): Promise<ProviderDateSyncResult> {
  const cached = await input.store.getCachedSuccess(input);
  if (cached) return cached;

  await input.beforeReadSource?.();
  await input.store.markAttempt({
    trackerId: input.trackerId,
    provider: input.provider,
    date: input.date,
    attemptedAt: input.now,
  });

  try {
    const records = await input.readSource();
    return await input.store.commitSuccess({
      trackerId: input.trackerId,
      provider: input.provider,
      date: input.date,
      records,
      succeededAt: input.now,
      cachedUntil: new Date(input.now.valueOf() + 30_000),
    });
  } catch (error) {
    if (error instanceof IntegrationOperationInterruptedError) throw error;
    await input.store.markFailure({
      trackerId: input.trackerId,
      provider: input.provider,
      date: input.date,
      failedAt: input.now,
      errorCode: providerPublicErrorCode(error),
    });
    throw error;
  }
}
