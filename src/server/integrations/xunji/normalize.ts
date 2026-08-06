import "server-only";

import { localDateInTimeZone } from "@/domain/planning-time";
import { contentHash } from "@/server/integrations/core/content-hash";
import type { NormalizedExternalRecord } from "@/server/integrations/core/external-records";

import { XunjiProviderError } from "./adapter";
import type { XunjiTrain } from "./contracts";

const maxTrainingDurationMs = 24 * 60 * 60 * 1_000;

const completionMetricKeys = new Set([
  "duration",
  "duration_s",
  "durationSeconds",
  "elapsed",
  "elapsed_s",
  "elapsedSeconds",
  "distance",
  "distance_m",
  "distanceMeters",
  "calories",
  "calories_kcal",
  "heartRate",
  "heart_rate",
  "heartRateBpm",
  "averageHeartRate",
  "averageHeartRateBpm",
  "metrics",
  "metric",
  "actual",
  "actuals",
  "completedAt",
  "finishedAt",
  "endedAt",
]);

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return true;
}

function hasCompletionEvidence(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some(hasCompletionEvidence);
  }

  return Object.entries(value).some(([key, nested]) => {
    if (key === "done" || key === "completed") {
      return (
        nested === true ||
        (typeof nested !== "boolean" && hasMeaningfulValue(nested))
      );
    }
    if (
      (key === "status" || key === "state") &&
      typeof nested === "string" &&
      ["completed", "done", "finished"].includes(nested.toLowerCase())
    ) {
      return true;
    }
    if (completionMetricKeys.has(key) && hasMeaningfulValue(nested)) {
      return true;
    }
    return hasCompletionEvidence(nested);
  });
}

function isUnstartedDraft(train: XunjiTrain) {
  // Xunji emits an unstarted planned training as a same-day 0/0 sentinel.
  // It is not an observed training and must never become AI/calendar/task evidence.
  return (
    train.start === 0 &&
    train.end === 0 &&
    !hasCompletionEvidence(train.movements) &&
    !hasCompletionEvidence(train)
  );
}

function shiftLocalDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function normalizeXunjiTrains(input: {
  trains: XunjiTrain[];
  date: string;
  fetchedAt: Date;
  planningTimeZone: string;
}): NormalizedExternalRecord[] {
  return input.trains.flatMap((train) => {
    if (train.datestr !== input.date) {
      throw new XunjiProviderError("invalid_response");
    }
    if (isUnstartedDraft(train)) return [];

    const occurredAt = new Date(train.start);
    const endedAt = new Date(train.end);
    const allowedLocalDates = new Set([
      shiftLocalDate(input.date, -1),
      input.date,
      shiftLocalDate(input.date, 1),
    ]);
    let occurredLocalDate: string;
    let endedLocalDate: string;
    try {
      occurredLocalDate = localDateInTimeZone(
        occurredAt,
        input.planningTimeZone,
      );
      endedLocalDate = localDateInTimeZone(endedAt, input.planningTimeZone);
    } catch (error) {
      throw new XunjiProviderError("invalid_response", { cause: error });
    }
    if (
      !allowedLocalDates.has(occurredLocalDate) ||
      !allowedLocalDates.has(endedLocalDate) ||
      train.end - train.start > maxTrainingDurationMs
    ) {
      throw new XunjiProviderError("invalid_response");
    }

    return {
      provider: "xunji",
      providerRecordId: train.localid,
      kind: "strength_training",
      localDate: input.date,
      occurredAt,
      fetchedAt: input.fetchedAt,
      contentHash: contentHash(train),
      payload: train,
    };
  });
}
