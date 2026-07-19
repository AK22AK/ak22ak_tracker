import "server-only";

import { isLocalDate } from "@/domain/calendar";

import type { IntegrationProvider } from "./external-records";
import {
  providerPublicErrorCode,
  type ProviderDateSyncResult,
} from "./sync-provider-date";

export type ProviderCatchUpState = {
  date: string;
  status: "idle" | "running" | "succeeded" | "failed";
};

export type ProviderCatchUpStore = {
  loadProgress(input: {
    trackerId: string;
    provider: IntegrationProvider;
    startedOn: string;
    targetDate: string;
  }): Promise<{
    cursorDate: string | null;
    overallStatus: "idle" | "running" | "succeeded" | "failed";
    states: ProviderCatchUpState[];
  }>;
  saveProgress(input: {
    trackerId: string;
    provider: IntegrationProvider;
    attemptedAt: Date;
    cursorDate: string | null;
    status: "running" | "succeeded" | "failed";
    lastErrorCode: string | null;
  }): Promise<void>;
};

export type ProviderCatchUpDayResult =
  | ({ date: string; status: "succeeded" } & ProviderDateSyncResult)
  | { date: string; status: "failed"; errorCode: string };

export type ProviderCatchUpResult = {
  provider: IntegrationProvider;
  batch: { from: string; to: string } | null;
  targetDate: string;
  days: ProviderCatchUpDayResult[];
  summary: {
    succeeded: number;
    failed: number;
    created: number;
    changed: number;
    unchanged: number;
  };
  nextCursor: string | null;
  complete: boolean;
  lastSucceededDate: string | null;
};

function shiftDate(localDate: string, days: number): string {
  if (!isLocalDate(localDate) || !Number.isInteger(days)) {
    throw new Error("invalid_sync_date");
  }
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function datesBetween(from: string, to: string): string[] {
  if (!isLocalDate(from) || !isLocalDate(to) || from > to) return [];
  const dates: string[] = [];
  for (let date = from; date <= to; date = shiftDate(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function latestSucceededDate(states: Map<string, ProviderCatchUpState>) {
  return (
    [...states.values()]
      .filter((state) => state.status === "succeeded")
      .map((state) => state.date)
      .sort()
      .at(-1) ?? null
  );
}

function resolveStartDate(input: {
  startedOn: string;
  targetDate: string;
  cursorDate: string | null;
  overallStatus: "idle" | "running" | "succeeded" | "failed";
  states: Map<string, ProviderCatchUpState>;
  overlapDays: number;
}) {
  if (input.startedOn > input.targetDate) return null;

  if (input.cursorDate) {
    let cursor =
      input.cursorDate < input.startedOn ? input.startedOn : input.cursorDate;
    while (
      cursor <= input.targetDate &&
      input.states.get(cursor)?.status === "succeeded"
    ) {
      cursor = shiftDate(cursor, 1);
    }
    if (cursor <= input.targetDate) return cursor;
  }

  if (input.overallStatus === "succeeded") {
    const latestSuccess = latestSucceededDate(input.states);
    if (latestSuccess) {
      const overlapped = shiftDate(latestSuccess, -input.overlapDays);
      return overlapped < input.startedOn ? input.startedOn : overlapped;
    }
  }

  const range = datesBetween(input.startedOn, input.targetDate);
  const firstIncomplete = range.find(
    (date) => input.states.get(date)?.status !== "succeeded",
  );
  if (firstIncomplete) return firstIncomplete;

  const overlapped = shiftDate(input.targetDate, -input.overlapDays);
  return overlapped < input.startedOn ? input.startedOn : overlapped;
}

export async function syncProviderCatchUpBatch(input: {
  trackerId: string;
  provider: IntegrationProvider;
  startedOn: string;
  today: string;
  now: Date;
  store: ProviderCatchUpStore;
  syncDate: (date: string) => Promise<ProviderDateSyncResult>;
  batchSize?: number;
  overlapDays?: number;
}): Promise<ProviderCatchUpResult> {
  const batchSize = input.batchSize ?? 5;
  const overlapDays = input.overlapDays ?? 2;
  if (
    !isLocalDate(input.startedOn) ||
    !isLocalDate(input.today) ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 31 ||
    !Number.isInteger(overlapDays) ||
    overlapDays < 0 ||
    overlapDays > 31
  ) {
    throw new Error("invalid_catch_up_sync_input");
  }

  const progress = await input.store.loadProgress({
    trackerId: input.trackerId,
    provider: input.provider,
    startedOn: input.startedOn,
    targetDate: input.today,
  });
  const states = new Map(progress.states.map((state) => [state.date, state]));
  const fullRange = datesBetween(input.startedOn, input.today);
  const coverageWasComplete = fullRange.every(
    (date) => states.get(date)?.status === "succeeded",
  );
  const overlapRun =
    coverageWasComplete ||
    (!progress.cursorDate && progress.overallStatus === "succeeded");
  const startDate = resolveStartDate({
    startedOn: input.startedOn,
    targetDate: input.today,
    cursorDate: progress.cursorDate,
    overallStatus: progress.overallStatus,
    states,
    overlapDays,
  });
  const candidateDates = startDate ? datesBetween(startDate, input.today) : [];
  const batchDates = (
    overlapRun
      ? candidateDates
      : candidateDates.filter(
          (date) => states.get(date)?.status !== "succeeded",
        )
  ).slice(0, batchSize);
  const days: ProviderCatchUpDayResult[] = [];

  for (const date of batchDates) {
    try {
      const result = await input.syncDate(date);
      days.push({ date, status: "succeeded", ...result });
      states.set(date, { date, status: "succeeded" });
    } catch (error) {
      const errorCode = providerPublicErrorCode(error);
      days.push({ date, status: "failed", errorCode });
      states.set(date, { date, status: "failed" });
    }
  }

  const lastBatchDate = batchDates.at(-1) ?? null;
  const nextCursor = lastBatchDate
    ? (candidateDates.find(
        (date) =>
          date > lastBatchDate &&
          (overlapRun || states.get(date)?.status !== "succeeded"),
      ) ?? null)
    : null;
  const rangeStates = datesBetween(input.startedOn, input.today).map((date) =>
    states.get(date),
  );
  const failedState = rangeStates.find((state) => state?.status === "failed");
  const status = nextCursor ? "running" : failedState ? "failed" : "succeeded";

  await input.store.saveProgress({
    trackerId: input.trackerId,
    provider: input.provider,
    attemptedAt: input.now,
    cursorDate: nextCursor,
    status,
    lastErrorCode: failedState ? "date_sync_failed" : null,
  });

  const successes = days.filter(
    (day): day is Extract<ProviderCatchUpDayResult, { status: "succeeded" }> =>
      day.status === "succeeded",
  );
  return {
    provider: input.provider,
    batch: batchDates.length
      ? { from: batchDates[0]!, to: batchDates.at(-1)! }
      : null,
    targetDate: input.today,
    days,
    summary: {
      succeeded: successes.length,
      failed: days.length - successes.length,
      created: successes.reduce((sum, day) => sum + day.created, 0),
      changed: successes.reduce((sum, day) => sum + day.changed, 0),
      unchanged: successes.reduce((sum, day) => sum + day.unchanged, 0),
    },
    nextCursor,
    complete: nextCursor === null,
    lastSucceededDate: latestSucceededDate(states),
  };
}
