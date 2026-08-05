import "server-only";

import { localDateInTimeZone } from "@/domain/planning-time";
import { contentHash } from "@/server/integrations/core/content-hash";
import type { NormalizedExternalRecord } from "@/server/integrations/core/external-records";

import { XunjiProviderError } from "./adapter";
import type { XunjiTrain } from "./contracts";

const maxTrainingDurationMs = 24 * 60 * 60 * 1_000;

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
  return input.trains.map((train) => {
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
      train.datestr !== input.date ||
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
