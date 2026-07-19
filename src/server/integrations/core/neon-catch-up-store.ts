import "server-only";

import { and, eq, gte, lte } from "drizzle-orm";

import { isLocalDate } from "@/domain/calendar";
import { getDatabase } from "@/server/db/client";
import {
  integrationDateSyncState,
  integrationSyncState,
} from "@/server/db/schema";

import type { ProviderCatchUpStore } from "./sync-provider-catch-up";

type Database = ReturnType<typeof getDatabase>;

function cursorDate(value: unknown): string | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("kind" in value) ||
    value.kind !== "date_catch_up_v1" ||
    !("nextDate" in value) ||
    typeof value.nextDate !== "string" ||
    !isLocalDate(value.nextDate)
  ) {
    return null;
  }
  return value.nextDate;
}

export function createNeonProviderCatchUpStore(
  database: Database = getDatabase(),
): ProviderCatchUpStore {
  return {
    async loadProgress(input) {
      const [syncRows, states] = await Promise.all([
        database
          .select({
            cursor: integrationSyncState.cursor,
            status: integrationSyncState.status,
          })
          .from(integrationSyncState)
          .where(
            and(
              eq(integrationSyncState.trackerId, input.trackerId),
              eq(integrationSyncState.provider, input.provider),
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
              eq(integrationDateSyncState.provider, input.provider),
              gte(integrationDateSyncState.localDate, input.startedOn),
              lte(integrationDateSyncState.localDate, input.targetDate),
            ),
          ),
      ]);
      return {
        cursorDate: cursorDate(syncRows[0]?.cursor),
        overallStatus: syncRows[0]?.status ?? "idle",
        states: states.map((state) => ({
          date: state.date,
          status: state.status,
        })),
      };
    },

    async saveProgress(input) {
      const state = {
        status: input.status,
        lastAttemptAt: input.attemptedAt,
        cursor: input.cursorDate
          ? { kind: "date_catch_up_v1", nextDate: input.cursorDate }
          : null,
        lastErrorCode: input.lastErrorCode,
        updatedAt: input.attemptedAt,
      };
      await database
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
        });
    },
  };
}
