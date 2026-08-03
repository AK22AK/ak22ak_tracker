import "server-only";

import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";

import {
  providerHistoryOverviewSchema,
  providerHistoryErrorCodeSchema,
  type ProviderHistoryOverview,
  type ProviderHistoryScope,
} from "@/domain/integrations";
import { schemaVersion } from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import {
  externalRecords,
  integrationCredentials,
  integrationDateSyncState,
  integrationSyncState,
} from "@/server/db/schema";
import { requireIntegrationTracker } from "@/server/integrations/credentials/repository";
import { garminWellnessEvidenceSchema } from "@/server/integrations/garmin/contracts";

import { parseProviderHistoryCursor } from "./neon-history-sync-store";
import { providerHistoryScopes } from "./sync-provider-history";

type Database = ReturnType<typeof getDatabase>;

type SyncRow = {
  provider: string;
  status: "idle" | "running" | "succeeded" | "failed";
  cursor: unknown;
  lastErrorCode: string | null;
  updatedAt: Date;
};

type DateStateRow = {
  provider: string;
  localDate: string;
  status: "idle" | "running" | "succeeded" | "failed";
  recordCount: number;
};

type RecordRow = {
  provider: string;
  kind: string;
  localDate: string;
  document: { payload: unknown };
};

function rangeDays(from: string, through: string) {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${through}T00:00:00.000Z`);
  const days = Math.round((end - start) / 86_400_000) + 1;
  return days === 7 || days === 14 || days === 30 ? days : null;
}

function historyScopeProvider(scope: ProviderHistoryScope) {
  return scope === "xunji_training_history" ? "xunji" : "garmin";
}

function safeHistoryErrorCode(value: string | null) {
  if (value === null) return null;
  const parsed = providerHistoryErrorCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : "provider_unavailable";
}

export function projectProviderHistoryOverview(input: {
  syncRows: SyncRow[];
  dateStates: DateStateRow[];
  records: RecordRow[];
  connectedProviders: string[];
}): ProviderHistoryOverview {
  const validSyncRows = input.syncRows
    .map((row) => ({ row, cursor: parseProviderHistoryCursor(row.cursor) }))
    .filter(
      (
        entry,
      ): entry is {
        row: SyncRow;
        cursor: NonNullable<ReturnType<typeof parseProviderHistoryCursor>>;
      } =>
        providerHistoryScopes.includes(
          entry.row.provider as ProviderHistoryScope,
        ) &&
        entry.cursor !== null &&
        rangeDays(entry.cursor.rangeFrom, entry.cursor.rangeThrough) !== null,
    )
    .sort(
      (left, right) =>
        right.row.updatedAt.getTime() - left.row.updatedAt.getTime(),
    );
  const latest = validSyncRows[0];
  const range = latest
    ? {
        from: latest.cursor.rangeFrom,
        through: latest.cursor.rangeThrough,
        days: rangeDays(latest.cursor.rangeFrom, latest.cursor.rangeThrough)!,
      }
    : null;
  const connected = new Set(input.connectedProviders);

  const sourcesByDate = new Map<
    string,
    Set<"garmin_activity" | "garmin_wellness" | "xunji_training">
  >();
  if (range) {
    for (const record of input.records) {
      if (record.localDate < range.from || record.localDate > range.through)
        continue;
      let source:
        "garmin_activity" | "garmin_wellness" | "xunji_training" | null = null;
      if (record.provider === "garmin" && record.kind === "activity") {
        source = "garmin_activity";
      } else if (
        record.provider === "xunji" &&
        record.kind === "strength_training"
      ) {
        source = "xunji_training";
      } else if (
        record.provider === "garmin" &&
        record.kind === "daily_wellness"
      ) {
        const wellness = garminWellnessEvidenceSchema.safeParse(
          record.document.payload,
        );
        if (
          wellness.success &&
          wellness.data.localDate === record.localDate &&
          (wellness.data.steps.status === "available" ||
            wellness.data.sleep.status === "available")
        ) {
          source = "garmin_wellness";
        }
      }
      if (!source) continue;
      const sources = sourcesByDate.get(record.localDate) ?? new Set();
      sources.add(source);
      sourcesByDate.set(record.localDate, sources);
    }
  }

  const scopes = providerHistoryScopes.map((scope) => {
    const matchingSync = validSyncRows.find(
      (entry) =>
        entry.row.provider === scope &&
        range &&
        entry.cursor.rangeFrom === range.from &&
        entry.cursor.rangeThrough === range.through,
    );
    const states =
      matchingSync && range
        ? input.dateStates.filter(
            (state) =>
              state.provider === scope &&
              state.localDate >= range.from &&
              state.localDate <= range.through,
          )
        : [];
    const processed = states.filter((state) => state.status === "succeeded");
    const failed = states.filter((state) => state.status === "failed").length;
    const recordSource =
      scope === "garmin_activity_history"
        ? "garmin_activity"
        : scope === "garmin_wellness_history"
          ? "garmin_wellness"
          : "xunji_training";
    const records = processed.filter((state) =>
      scope === "garmin_wellness_history"
        ? sourcesByDate.get(state.localDate)?.has(recordSource)
        : state.recordCount > 0,
    ).length;
    return {
      scope,
      connected: connected.has(historyScopeProvider(scope)),
      status: matchingSync?.row.status ?? "idle",
      nextCursor: matchingSync?.cursor.nextDate ?? null,
      lastErrorCode: safeHistoryErrorCode(
        matchingSync?.row.lastErrorCode ?? null,
      ),
      updatedAt: matchingSync?.row.updatedAt.toISOString() ?? null,
      summary: {
        processed: processed.length,
        records,
        empty: processed.length - records,
        failed,
        unknown: range
          ? Math.max(0, range.days - processed.length - failed)
          : 0,
      },
    };
  });

  const sourceOrder = [
    "garmin_activity",
    "garmin_wellness",
    "xunji_training",
  ] as const;
  return providerHistoryOverviewSchema.parse({
    schemaVersion,
    range,
    updatedAt: latest?.row.updatedAt.toISOString() ?? null,
    scopes,
    recordDates: [...sourcesByDate.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([date, sources]) => ({
        date,
        sources: sourceOrder.filter((source) => sources.has(source)),
      })),
  });
}

export async function getProviderHistoryOverview(
  trackerKey: string,
  database: Database = getDatabase(),
) {
  const tracker = await requireIntegrationTracker(trackerKey, database);
  const [syncRows, credentialRows] = await Promise.all([
    database
      .select({
        provider: integrationSyncState.provider,
        status: integrationSyncState.status,
        cursor: integrationSyncState.cursor,
        lastErrorCode: integrationSyncState.lastErrorCode,
        updatedAt: integrationSyncState.updatedAt,
      })
      .from(integrationSyncState)
      .where(
        and(
          eq(integrationSyncState.trackerId, tracker.id),
          inArray(integrationSyncState.provider, [...providerHistoryScopes]),
        ),
      )
      .orderBy(desc(integrationSyncState.updatedAt)),
    database
      .select({ provider: integrationCredentials.provider })
      .from(integrationCredentials)
      .where(
        and(
          eq(integrationCredentials.trackerId, tracker.id),
          inArray(integrationCredentials.provider, ["garmin", "xunji"]),
        ),
      ),
  ]);
  const latest = syncRows
    .map((row) => ({ row, cursor: parseProviderHistoryCursor(row.cursor) }))
    .find(
      (entry) =>
        entry.cursor &&
        rangeDays(entry.cursor.rangeFrom, entry.cursor.rangeThrough) !== null,
    );
  if (!latest?.cursor) {
    return projectProviderHistoryOverview({
      syncRows,
      dateStates: [],
      records: [],
      connectedProviders: credentialRows.map((row) => row.provider),
    });
  }
  const [dateStates, records] = await Promise.all([
    database
      .select({
        provider: integrationDateSyncState.provider,
        localDate: integrationDateSyncState.localDate,
        status: integrationDateSyncState.status,
        recordCount: integrationDateSyncState.recordCount,
      })
      .from(integrationDateSyncState)
      .where(
        and(
          eq(integrationDateSyncState.trackerId, tracker.id),
          inArray(integrationDateSyncState.provider, [
            ...providerHistoryScopes,
          ]),
          gte(integrationDateSyncState.localDate, latest.cursor.rangeFrom),
          lte(integrationDateSyncState.localDate, latest.cursor.rangeThrough),
        ),
      ),
    database
      .select({
        provider: externalRecords.provider,
        kind: externalRecords.kind,
        localDate: externalRecords.localDate,
        document: externalRecords.document,
      })
      .from(externalRecords)
      .where(
        and(
          eq(externalRecords.trackerId, tracker.id),
          inArray(externalRecords.provider, ["garmin", "xunji"]),
          gte(externalRecords.localDate, latest.cursor.rangeFrom),
          lte(externalRecords.localDate, latest.cursor.rangeThrough),
        ),
      ),
  ]);
  return projectProviderHistoryOverview({
    syncRows,
    dateStates,
    records,
    connectedProviders: credentialRows.map((row) => row.provider),
  });
}
