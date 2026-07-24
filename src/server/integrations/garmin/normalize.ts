import "server-only";

import { localDateInTimeZone } from "@/domain/planning-time";
import { contentHash } from "@/server/integrations/core/content-hash";
import type { NormalizedExternalRecord } from "@/server/integrations/core/external-records";

import type { GarminActivityEvidence } from "./contracts";
import { GarminProviderError } from "./errors";

function persistedPayload(activity: GarminActivityEvidence) {
  return {
    activityType: activity.activityType,
    startedAt: activity.startedAt,
    durationSeconds: activity.durationSeconds,
    distanceMeters: activity.distanceMeters,
    averagePaceSecondsPerKilometer: activity.averagePaceSecondsPerKilometer,
    averageHeartRateBpm: activity.averageHeartRateBpm,
  };
}

export function normalizeGarminActivities(input: {
  activities: GarminActivityEvidence[];
  localDate: string;
  planningTimeZone: string;
  fetchedAt: Date;
}): NormalizedExternalRecord[] {
  return input.activities.map((activity) => {
    const occurredAt = new Date(activity.startedAt);
    if (
      localDateInTimeZone(occurredAt, input.planningTimeZone) !==
      input.localDate
    ) {
      throw new GarminProviderError("invalid_response");
    }
    const payload = persistedPayload(activity);
    return {
      provider: "garmin",
      providerRecordId: activity.providerRecordId,
      kind: "activity",
      localDate: input.localDate,
      occurredAt,
      fetchedAt: input.fetchedAt,
      contentHash: contentHash(payload),
      payload,
    };
  });
}
