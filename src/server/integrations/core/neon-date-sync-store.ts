import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { externalRecordSchema, schemaVersion } from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import {
  externalRecordLinks,
  externalRecords,
  integrationDateSyncState,
  integrationSyncState,
} from "@/server/db/schema";

import { contentHash } from "./content-hash";
import { reconcileExternalRecords } from "./external-records";
import type {
  ProviderDateSyncResult,
  ProviderDateSyncStore,
} from "./sync-provider-date";

type Database = ReturnType<typeof getDatabase>;

function recordSetHash(
  records: Array<{ providerRecordId: string; contentHash: string }>,
) {
  return contentHash(
    records
      .map(({ providerRecordId, contentHash }) => ({
        providerRecordId,
        contentHash,
      }))
      .sort((left, right) =>
        left.providerRecordId.localeCompare(right.providerRecordId),
      ),
  );
}

export function createNeonProviderDateSyncStore(
  trackerKey: string,
  database: Database = getDatabase(),
): ProviderDateSyncStore {
  return {
    async getCachedSuccess(input) {
      const [row] = await database
        .select({
          status: integrationDateSyncState.status,
          cachedUntil: integrationDateSyncState.cachedUntil,
          recordCount: integrationDateSyncState.recordCount,
          lastSucceededAt: integrationDateSyncState.lastSucceededAt,
        })
        .from(integrationDateSyncState)
        .where(
          and(
            eq(integrationDateSyncState.trackerId, input.trackerId),
            eq(integrationDateSyncState.provider, input.provider),
            eq(integrationDateSyncState.localDate, input.date),
          ),
        )
        .limit(1);
      if (
        !row ||
        row.status !== "succeeded" ||
        !row.cachedUntil ||
        row.cachedUntil <= input.now ||
        !row.lastSucceededAt
      ) {
        return null;
      }
      return {
        cached: true,
        created: 0,
        changed: 0,
        unchanged: row.recordCount,
        recordCount: row.recordCount,
        syncedAt: row.lastSucceededAt.toISOString(),
      };
    },

    async markAttempt(input) {
      const state = {
        status: "running" as const,
        lastAttemptAt: input.attemptedAt,
        lastErrorCode: null,
        updatedAt: input.attemptedAt,
      };
      await database.batch([
        database
          .insert(integrationDateSyncState)
          .values({
            trackerId: input.trackerId,
            provider: input.provider,
            localDate: input.date,
            ...state,
          })
          .onConflictDoUpdate({
            target: [
              integrationDateSyncState.trackerId,
              integrationDateSyncState.provider,
              integrationDateSyncState.localDate,
            ],
            set: state,
          }),
        database
          .insert(integrationSyncState)
          .values({
            trackerId: input.trackerId,
            provider: input.provider,
            ...state,
          })
          .onConflictDoUpdate({
            target: [
              integrationSyncState.trackerId,
              integrationSyncState.provider,
            ],
            set: state,
          }),
      ]);
    },

    async commitSuccess(input): Promise<ProviderDateSyncResult> {
      const providerRecordIds = input.records.map(
        (record) => record.providerRecordId,
      );
      const existing = providerRecordIds.length
        ? await database
            .select({
              id: externalRecords.id,
              providerRecordId: externalRecords.providerRecordId,
              contentHash: externalRecords.contentHash,
              sourceVersion: externalRecords.sourceVersion,
            })
            .from(externalRecords)
            .where(
              and(
                eq(externalRecords.trackerId, input.trackerId),
                eq(externalRecords.provider, input.provider),
                inArray(externalRecords.providerRecordId, providerRecordIds),
              ),
            )
        : [];
      const reconciled = reconcileExternalRecords(existing, input.records);
      const statements = [];

      for (const record of reconciled.created) {
        const document = externalRecordSchema.parse({
          schemaVersion,
          id: record.id,
          trackerKey,
          provider: record.provider,
          providerRecordId: record.providerRecordId,
          kind: record.kind,
          occurredAt: record.occurredAt.toISOString(),
          localDate: record.localDate,
          payload: record.payload,
          fetchedAt: record.fetchedAt.toISOString(),
          contentHash: record.contentHash,
          sourceVersion: record.sourceVersion,
        });
        statements.push(
          database.insert(externalRecords).values({
            id: record.id,
            trackerId: input.trackerId,
            provider: record.provider,
            providerRecordId: record.providerRecordId,
            kind: record.kind,
            localDate: record.localDate,
            occurredAt: record.occurredAt,
            fetchedAt: record.fetchedAt,
            contentHash: record.contentHash,
            sourceVersion: record.sourceVersion,
            document,
          }),
        );
      }
      for (const change of reconciled.changed) {
        const document = externalRecordSchema.parse({
          schemaVersion,
          id: change.existing.id,
          trackerKey,
          provider: change.incoming.provider,
          providerRecordId: change.incoming.providerRecordId,
          kind: change.incoming.kind,
          occurredAt: change.incoming.occurredAt.toISOString(),
          localDate: change.incoming.localDate,
          payload: change.incoming.payload,
          fetchedAt: change.incoming.fetchedAt.toISOString(),
          contentHash: change.incoming.contentHash,
          sourceVersion: change.nextSourceVersion,
        });
        statements.push(
          database
            .update(externalRecords)
            .set({
              kind: change.incoming.kind,
              localDate: change.incoming.localDate,
              occurredAt: change.incoming.occurredAt,
              fetchedAt: change.incoming.fetchedAt,
              contentHash: change.incoming.contentHash,
              sourceVersion: change.nextSourceVersion,
              sourceChangedAt: input.succeededAt,
              document,
            })
            .where(eq(externalRecords.id, change.existing.id)),
          database
            .update(externalRecordLinks)
            .set({ needsReview: true })
            .where(
              eq(externalRecordLinks.externalRecordId, change.existing.id),
            ),
        );
      }

      const recordCount = input.records.length;
      const success = {
        status: "succeeded" as const,
        lastSucceededAt: input.succeededAt,
        lastErrorCode: null,
        updatedAt: input.succeededAt,
      };
      statements.push(
        database
          .insert(integrationDateSyncState)
          .values({
            trackerId: input.trackerId,
            provider: input.provider,
            localDate: input.date,
            cachedUntil: input.cachedUntil,
            recordCount,
            contentHash: recordSetHash(input.records),
            ...success,
          })
          .onConflictDoUpdate({
            target: [
              integrationDateSyncState.trackerId,
              integrationDateSyncState.provider,
              integrationDateSyncState.localDate,
            ],
            set: {
              cachedUntil: input.cachedUntil,
              recordCount,
              contentHash: recordSetHash(input.records),
              ...success,
            },
          }),
        database
          .insert(integrationSyncState)
          .values({
            trackerId: input.trackerId,
            provider: input.provider,
            ...success,
          })
          .onConflictDoUpdate({
            target: [
              integrationSyncState.trackerId,
              integrationSyncState.provider,
            ],
            set: success,
          }),
      );
      await database.batch(statements as never);
      return {
        cached: false,
        created: reconciled.created.length,
        changed: reconciled.changed.length,
        unchanged: reconciled.unchanged.length,
        recordCount,
        syncedAt: input.succeededAt.toISOString(),
      };
    },

    async markFailure(input) {
      const failed = {
        status: "failed" as const,
        lastAttemptAt: input.failedAt,
        lastErrorCode: input.errorCode,
        updatedAt: input.failedAt,
      };
      await database.batch([
        database
          .insert(integrationDateSyncState)
          .values({
            trackerId: input.trackerId,
            provider: input.provider,
            localDate: input.date,
            ...failed,
          })
          .onConflictDoUpdate({
            target: [
              integrationDateSyncState.trackerId,
              integrationDateSyncState.provider,
              integrationDateSyncState.localDate,
            ],
            set: failed,
          }),
        database
          .insert(integrationSyncState)
          .values({
            trackerId: input.trackerId,
            provider: input.provider,
            ...failed,
          })
          .onConflictDoUpdate({
            target: [
              integrationSyncState.trackerId,
              integrationSyncState.provider,
            ],
            set: failed,
          }),
      ]);
    },
  };
}
