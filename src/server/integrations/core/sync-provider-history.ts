import "server-only";

import { isLocalDate } from "@/domain/calendar";

import { IntegrationOperationInterruptedError } from "../credentials/operation-errors";
import type { IntegrationProvider } from "./external-records";
import {
  providerPublicErrorCode,
  type ProviderDateSyncResult,
} from "./sync-provider-date";

export const providerHistoryScopes = [
  "garmin_activity_history",
  "garmin_wellness_history",
  "xunji_training_history",
] as const;

export type ProviderHistoryScope = (typeof providerHistoryScopes)[number];
export type ProviderHistoryDays = 7 | 14 | 30;

export type ProviderHistoryState = {
  date: string;
  status: "idle" | "running" | "succeeded" | "failed";
};

export type ProviderHistoryStore = {
  load(input: {
    trackerId: string;
    scope: ProviderHistoryScope;
    rangeFrom: string;
    rangeThrough: string;
  }): Promise<{
    rangeFrom: string;
    rangeThrough: string;
    nextDate: string | null;
    states: ProviderHistoryState[];
  } | null>;
  save(input: {
    trackerId: string;
    scope: ProviderHistoryScope;
    attemptedAt: Date;
    rangeFrom: string;
    rangeThrough: string;
    nextDate: string | null;
    status: "running" | "succeeded" | "failed";
    lastErrorCode: string | null;
  }): Promise<void>;
};

function shiftDate(localDate: string, days: number) {
  if (!isLocalDate(localDate) || !Number.isInteger(days)) {
    throw new Error("invalid_history_sync_date");
  }
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function datesBetween(from: string, through: string) {
  const dates: string[] = [];
  for (let date = from; date <= through; date = shiftDate(date, 1)) {
    dates.push(date);
  }
  return dates;
}

export async function syncProviderHistoryBatch(input: {
  trackerId: string;
  provider: IntegrationProvider;
  scope: ProviderHistoryScope;
  days: ProviderHistoryDays;
  today: string;
  now: Date;
  batchSize: number;
  store: ProviderHistoryStore;
  syncDate: (date: string) => Promise<ProviderDateSyncResult>;
}) {
  if (
    !isLocalDate(input.today) ||
    ![7, 14, 30].includes(input.days) ||
    !Number.isInteger(input.batchSize) ||
    input.batchSize < 1 ||
    input.batchSize > 5
  ) {
    throw new Error("invalid_history_sync_input");
  }
  const rangeFrom = shiftDate(input.today, 1 - input.days);
  const rangeThrough = input.today;
  const persisted = await input.store.load({
    trackerId: input.trackerId,
    scope: input.scope,
    rangeFrom,
    rangeThrough,
  });
  const sameRange =
    persisted?.rangeFrom === rangeFrom &&
    persisted.rangeThrough === rangeThrough;
  const states = new Map(
    (sameRange ? persisted.states : []).map((state) => [state.date, state]),
  );
  const dates = datesBetween(rangeFrom, rangeThrough);
  const requestedStart = sameRange ? persisted.nextDate : rangeFrom;
  const start =
    requestedStart && requestedStart >= rangeFrom
      ? requestedStart
      : (dates.find((date) => states.get(date)?.status !== "succeeded") ??
        rangeFrom);
  const batch = dates
    .filter((date) => date >= start && states.get(date)?.status !== "succeeded")
    .slice(0, input.batchSize);
  const results: Array<
    | ({ date: string; status: "succeeded" } & ProviderDateSyncResult)
    | { date: string; status: "failed"; errorCode: string }
  > = [];

  for (const date of batch) {
    try {
      const result = await input.syncDate(date);
      results.push({ date, status: "succeeded", ...result });
      states.set(date, { date, status: "succeeded" });
    } catch (error) {
      if (error instanceof IntegrationOperationInterruptedError) throw error;
      const errorCode = providerPublicErrorCode(error);
      results.push({ date, status: "failed", errorCode });
      states.set(date, { date, status: "failed" });
      break;
    }
  }

  const failed = results.find(
    (
      result,
    ): result is Extract<(typeof results)[number], { status: "failed" }> =>
      result.status === "failed",
  );
  const last = results.at(-1)?.date ?? null;
  const nextDate = failed
    ? failed.date
    : last
      ? (dates.find(
          (date) => date > last && states.get(date)?.status !== "succeeded",
        ) ?? null)
      : (dates.find((date) => states.get(date)?.status !== "succeeded") ??
        null);
  const status = failed ? "failed" : nextDate ? "running" : "succeeded";
  await input.store.save({
    trackerId: input.trackerId,
    scope: input.scope,
    attemptedAt: input.now,
    rangeFrom,
    rangeThrough,
    nextDate,
    status,
    lastErrorCode: failed?.errorCode ?? null,
  });
  const succeeded = results.filter(
    (
      result,
    ): result is Extract<(typeof results)[number], { status: "succeeded" }> =>
      result.status === "succeeded",
  );
  return {
    provider: input.provider,
    scope: input.scope,
    range: { from: rangeFrom, through: rangeThrough, days: input.days },
    batch: results.length
      ? { from: results[0]!.date, to: results.at(-1)!.date }
      : null,
    days: results,
    summary: {
      succeeded: succeeded.length,
      empty: succeeded.filter((day) => day.recordCount === 0).length,
      failed: results.length - succeeded.length,
      created: succeeded.reduce((sum, day) => sum + day.created, 0),
      changed: succeeded.reduce((sum, day) => sum + day.changed, 0),
      unchanged: succeeded.reduce((sum, day) => sum + day.unchanged, 0),
    },
    nextCursor: nextDate,
    complete: !failed && nextDate === null,
  } as const;
}
