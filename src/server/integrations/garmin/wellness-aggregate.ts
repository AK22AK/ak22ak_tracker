import "server-only";

import { and, desc, eq } from "drizzle-orm";

import {
  garminRecoveryReferenceSchema,
  type GarminRecoveryReference,
} from "@/domain/garmin";
import { getDatabase } from "@/server/db/client";
import { externalRecords } from "@/server/db/schema";

import { garminWellnessEvidenceSchema } from "./contracts";

type Database = ReturnType<typeof getDatabase>;

export function projectGarminRecoveryReference(row: {
  localDate: string;
  sourceVersion: number;
  fetchedAt: Date;
  document: { payload: unknown };
}): GarminRecoveryReference | null {
  const wellness = garminWellnessEvidenceSchema.safeParse(row.document.payload);
  if (!wellness.success || wellness.data.localDate !== row.localDate) {
    return null;
  }
  const syncedAt = row.fetchedAt.toISOString();
  return garminRecoveryReferenceSchema.parse({
    provider: "garmin",
    localDate: row.localDate,
    sourceVersion: row.sourceVersion,
    steps: {
      ...wellness.data.steps,
      observedAt: syncedAt,
      syncedAt,
    },
    sleep: { ...wellness.data.sleep, syncedAt },
  });
}

export async function getGarminRecoveryReferenceForDay(input: {
  trackerId: string;
  localDate: string;
  database?: Database;
}): Promise<GarminRecoveryReference | null> {
  const database = input.database ?? getDatabase();
  const [row] = await database
    .select({
      localDate: externalRecords.localDate,
      sourceVersion: externalRecords.sourceVersion,
      fetchedAt: externalRecords.fetchedAt,
      document: externalRecords.document,
    })
    .from(externalRecords)
    .where(
      and(
        eq(externalRecords.trackerId, input.trackerId),
        eq(externalRecords.provider, "garmin"),
        eq(externalRecords.kind, "daily_wellness"),
        eq(externalRecords.localDate, input.localDate),
      ),
    )
    .orderBy(desc(externalRecords.fetchedAt))
    .limit(1);
  if (!row) return null;
  return projectGarminRecoveryReference(row);
}
