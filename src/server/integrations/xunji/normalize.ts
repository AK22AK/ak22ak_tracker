import "server-only";

import { instantAtLocalNoon } from "@/domain/planning-time";
import { contentHash } from "@/server/integrations/core/content-hash";
import type { NormalizedExternalRecord } from "@/server/integrations/core/external-records";

import type { XunjiTrain } from "./contracts";

export function normalizeXunjiTrains(input: {
  trains: XunjiTrain[];
  date: string;
  fetchedAt: Date;
  planningTimeZone: string;
}): NormalizedExternalRecord[] {
  return input.trains.map((train) => ({
    provider: "xunji",
    providerRecordId: train.localid,
    kind: "strength_training",
    localDate: input.date,
    occurredAt: instantAtLocalNoon(input.date, input.planningTimeZone),
    fetchedAt: input.fetchedAt,
    contentHash: contentHash(train),
    payload: train,
  }));
}
