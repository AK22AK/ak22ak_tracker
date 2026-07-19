import "server-only";

import type {
  IntegrationProvider,
  NormalizedExternalRecord,
} from "./external-records";

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

function publicErrorCode(error: unknown): string {
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

export async function syncProviderDate(input: {
  trackerId: string;
  provider: IntegrationProvider;
  date: string;
  now: Date;
  store: ProviderDateSyncStore;
  readSource: () => Promise<NormalizedExternalRecord[]>;
}): Promise<ProviderDateSyncResult> {
  const cached = await input.store.getCachedSuccess(input);
  if (cached) return cached;

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
    await input.store.markFailure({
      trackerId: input.trackerId,
      provider: input.provider,
      date: input.date,
      failedAt: input.now,
      errorCode: publicErrorCode(error),
    });
    throw error;
  }
}
