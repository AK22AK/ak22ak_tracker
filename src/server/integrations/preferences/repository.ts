import "server-only";

import { and, eq } from "drizzle-orm";

import {
  integrationPreferenceDocumentSchema,
  type IntegrationPreferenceDocument,
} from "@/domain/integration-preferences";
import { getDatabase } from "@/server/db/client";
import { integrationPreferences } from "@/server/db/schema";

type Database = ReturnType<typeof getDatabase>;

export async function readIntegrationPreference(input: {
  trackerId: string;
  provider: string;
  database?: Database;
}): Promise<IntegrationPreferenceDocument | null> {
  const database = input.database ?? getDatabase();
  const [row] = await database
    .select({ document: integrationPreferences.document })
    .from(integrationPreferences)
    .where(
      and(
        eq(integrationPreferences.trackerId, input.trackerId),
        eq(integrationPreferences.provider, input.provider),
      ),
    )
    .limit(1);
  if (!row) return null;
  const parsed = integrationPreferenceDocumentSchema.parse(row.document);
  if (parsed.provider !== input.provider) {
    throw new Error("integration_preference_provider_mismatch");
  }
  return parsed;
}

export async function saveIntegrationPreference(input: {
  trackerId: string;
  document: IntegrationPreferenceDocument;
  now: Date;
  database?: Database;
}) {
  const database = input.database ?? getDatabase();
  const document = integrationPreferenceDocumentSchema.parse(input.document);
  await database
    .insert(integrationPreferences)
    .values({
      trackerId: input.trackerId,
      provider: document.provider,
      document,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [
        integrationPreferences.trackerId,
        integrationPreferences.provider,
      ],
      set: { document, updatedAt: input.now },
    });
}
