import "server-only";

import { localDateInTimeZone } from "@/domain/planning-time";
import { contentHash } from "@/server/integrations/core/content-hash";
import type { NormalizedExternalRecord } from "@/server/integrations/core/external-records";

import { XunjiProviderError } from "./adapter";
import type { XunjiTrain } from "./contracts";

export function normalizeXunjiTrains(input: {
  trains: XunjiTrain[];
  date: string;
  fetchedAt: Date;
  planningTimeZone: string;
}): NormalizedExternalRecord[] {
  return input.trains.map((train) => {
    const occurredAt = new Date(train.start);
    if (
      train.datestr !== input.date ||
      localDateInTimeZone(occurredAt, input.planningTimeZone) !== input.date
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
