import "server-only";

import { and, eq, isNull, lte, ne, or } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { integrationSyncState } from "@/server/db/schema";

import type { AutomaticProviderRecoveryClaimStore } from "./automatic-provider-recovery";

type Database = ReturnType<typeof getDatabase>;

export function createNeonAutomaticProviderRecoveryClaimStore(
  database: Database = getDatabase(),
): AutomaticProviderRecoveryClaimStore {
  return {
    async claim(input) {
      const dueBefore = new Date(
        input.attemptedAt.valueOf() - input.minimumIntervalMs,
      );
      const leaseExpiredBefore = new Date(
        input.attemptedAt.valueOf() - input.leaseMs,
      );
      const claimedState = {
        status: "running" as const,
        lastAttemptAt: input.attemptedAt,
        lastErrorCode: null,
        updatedAt: input.attemptedAt,
      };
      const [claimed] = await database
        .insert(integrationSyncState)
        .values({
          trackerId: input.trackerId,
          provider: input.provider,
          ...claimedState,
        })
        .onConflictDoUpdate({
          target: [
            integrationSyncState.trackerId,
            integrationSyncState.provider,
          ],
          set: claimedState,
          setWhere: or(
            and(
              eq(integrationSyncState.status, "running"),
              or(
                isNull(integrationSyncState.lastAttemptAt),
                lte(integrationSyncState.lastAttemptAt, leaseExpiredBefore),
              ),
            ),
            and(
              ne(integrationSyncState.status, "running"),
              or(
                isNull(integrationSyncState.lastAttemptAt),
                lte(integrationSyncState.lastAttemptAt, dueBefore),
              ),
            ),
          ),
        })
        .returning({ id: integrationSyncState.id });
      if (claimed) return "claimed";

      const [current] = await database
        .select({
          status: integrationSyncState.status,
          lastAttemptAt: integrationSyncState.lastAttemptAt,
        })
        .from(integrationSyncState)
        .where(
          and(
            eq(integrationSyncState.trackerId, input.trackerId),
            eq(integrationSyncState.provider, input.provider),
          ),
        )
        .limit(1);
      if (
        current?.status === "running" &&
        current.lastAttemptAt &&
        current.lastAttemptAt > leaseExpiredBefore
      ) {
        return "in_progress";
      }
      return "not_due";
    },
  };
}
