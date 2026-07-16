import "server-only";

export const kneeRehabGarminScope = {
  activityTypes: [
    "running",
    "walking",
    "hiking",
    "cycling",
    "swimming",
    "strength_training",
  ],
  activityFields: [
    "startedAt",
    "durationSeconds",
    "distanceMeters",
    "pace",
    "heartRate",
    "steps",
    "cadence",
    "elevationGainMeters",
    "elevationLossMeters",
    "swimStroke",
  ],
  dailyFields: ["steps", "walkingDistanceMeters"],
  sleepFields: [
    "bedtime",
    "wakeTime",
    "durationSeconds",
    "score",
    "awakeDurationSeconds",
  ],
} as const;

export interface GarminRawRecord {
  providerRecordId: string;
  kind: "activity" | "sleep" | "daily_steps";
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface GarminClient {
  fetchRecords(window: { from: Date; to: Date }): Promise<GarminRawRecord[]>;
}

// The first implementation may use the same Garth-based approach as the
// existing personal automation. Keep it behind this boundary because it is an
// unofficial integration and may need replacement without touching the domain.
