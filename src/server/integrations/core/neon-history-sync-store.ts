import "server-only";

import { and, eq, gte, lte } from "drizzle-orm";

import { isLocalDate } from "@/domain/calendar";
import { getDatabase } from "@/server/db/client";
import {
  integrationDateSyncState,
  integrationSyncState,
} from "@/server/db/schema";

import type {
  ProviderHistoryScope,
  ProviderHistoryStore,
} from "./sync-provider-history";

type Database = ReturnType<typeof getDatabase>;

function cursor(value: unknown) {
  if (
    typeof value !== "object" ||
    value === null ||
    !("kind" in value) ||
    value.kind !== "bounded_date_range_v1" ||
    !("rangeFrom" in value) ||
    !("rangeThrough" in value) ||
    !("nextDate" in value) ||
    typeof value.rangeFrom !== "string" ||
    typeof value.rangeThrough !== "string" ||
    !isLocalDate(value.rangeFrom) ||
    !isLocalDate(value.rangeThrough) ||
    (value.nextDate !== null &&
      (typeof value.nextDate !== "string" || !isLocalDate(value.nextDate)))
  ) {
    return null;
  }
  return {
    rangeFrom: value.rangeFrom,
    rangeThrough: value.rangeThrough,
    nextDate: value.nextDate as string | null,
  };
}

export function createNeonProviderHistoryStore(
  database: Database = getDatabase(),
): ProviderHistoryStore {
  return {
    async load(input) {
      const [syncRows, states] = await Promise.all([
        database
          .select({ cursor: integrationSyncState.cursor })
          .from(integrationSyncState)
          .where(
            and(
              eq(integrationSyncState.trackerId, input.trackerId),
              eq(integrationSyncState.provider, input.scope),
            ),
          )
          .limit(1),
        database
          .select({
            date: integrationDateSyncState.localDate,
            status: integrationDateSyncState.status,
          })
          .from(integrationDateSyncState)
          .where(
            and(
              eq(integrationDateSyncState.trackerId, input.trackerId),
              eq(integrationDateSyncState.provider, input.scope),
              gte(integrationDateSyncState.localDate, input.rangeFrom),
              lte(integrationDateSyncState.localDate, input.rangeThrough),
            ),
          ),
      ]);
      const parsed = cursor(syncRows[0]?.cursor);
      if (!parsed) return null;
      return {
        ...parsed,
        states: states.map((state) => ({
          date: state.date,
          status: state.status,
        })),
      };
    },
    async save(input) {
      const state = {
        status: input.status,
        lastAttemptAt: input.attemptedAt,
        lastSucceededAt:
          input.status === "succeeded" ? input.attemptedAt : undefined,
        cursor: {
          kind: "bounded_date_range_v1",
          rangeFrom: input.rangeFrom,
          rangeThrough: input.rangeThrough,
          nextDate: input.nextDate,
        },
        lastErrorCode: input.lastErrorCode,
        updatedAt: input.attemptedAt,
      };
      await database
        .insert(integrationSyncState)
        .values({
          trackerId: input.trackerId,
          provider: input.scope satisfies ProviderHistoryScope,
          ...state,
        })
        .onConflictDoUpdate({
          target: [
            integrationSyncState.trackerId,
            integrationSyncState.provider,
          ],
          set: state,
        });
    },
  };
}
