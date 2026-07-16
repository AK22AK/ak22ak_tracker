const DAY_MS = 24 * 60 * 60 * 1_000;

export interface GarminSyncWindowInput {
  planStartedAt: Date;
  now: Date;
  lastSuccessfulSyncAt?: Date;
  overlapDays?: number;
}

export interface GarminSyncWindow {
  from: Date;
  to: Date;
}

export function calculateGarminSyncWindow({
  planStartedAt,
  now,
  lastSuccessfulSyncAt,
  overlapDays = 2,
}: GarminSyncWindowInput): GarminSyncWindow {
  if (now < planStartedAt) {
    throw new Error("The sync end cannot precede the plan start");
  }

  if (!lastSuccessfulSyncAt) {
    return { from: planStartedAt, to: now };
  }

  const overlapped = new Date(
    lastSuccessfulSyncAt.getTime() - overlapDays * DAY_MS,
  );

  return {
    from: overlapped < planStartedAt ? planStartedAt : overlapped,
    to: now,
  };
}
