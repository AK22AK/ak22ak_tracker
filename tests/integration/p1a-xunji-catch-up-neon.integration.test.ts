import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/db/client";
import {
  integrationDateSyncState,
  integrationSyncState,
  trackers,
} from "@/server/db/schema";
import { createNeonProviderCatchUpStore } from "@/server/integrations/core/neon-catch-up-store";
import { createNeonProviderDateSyncStore } from "@/server/integrations/core/neon-date-sync-store";
import { syncProviderCatchUpBatch } from "@/server/integrations/core/sync-provider-catch-up";
import { syncProviderDate } from "@/server/integrations/core/sync-provider-date";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("P1a provider-neutral catch-up sync persistence", () => {
  const trackerId = randomUUID();
  const trackerKey = `anonymous-catch-up-${randomUUID()}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await getDatabase().insert(trackers).values({
      id: trackerId,
      key: trackerKey,
      name: "Anonymous catch-up tracker",
      module: "anonymous",
      startedOn: "2026-07-01",
      planningTimeZone: "Asia/Shanghai",
    });
  });

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    await getDatabase().delete(trackers).where(eq(trackers.id, trackerId));
  });

  it("persists bounded progress, recovers from a stale cursor and isolates one failed day", async () => {
    const database = getDatabase();
    const dateStore = createNeonProviderDateSyncStore(trackerKey, database);
    const catchUpStore = createNeonProviderCatchUpStore(database);
    const syncDate = (failedDate?: string) => (date: string) =>
      syncProviderDate({
        trackerId,
        provider: "xunji",
        date,
        now: new Date("2026-07-04T08:00:00.000Z"),
        store: dateStore,
        readSource: async () => {
          if (date === failedDate) {
            throw Object.assign(new Error("anonymous provider failure"), {
              code: "rate_limited",
            });
          }
          return [];
        },
      });

    const first = await syncProviderCatchUpBatch({
      trackerId,
      provider: "xunji",
      startedOn: "2026-07-01",
      today: "2026-07-04",
      now: new Date("2026-07-04T08:00:00.000Z"),
      batchSize: 2,
      store: catchUpStore,
      syncDate: syncDate(),
    });
    expect(first).toMatchObject({
      batch: { from: "2026-07-01", to: "2026-07-02" },
      nextCursor: "2026-07-03",
      complete: false,
    });

    await database
      .update(integrationSyncState)
      .set({ cursor: { kind: "date_catch_up_v1", nextDate: "2026-07-01" } })
      .where(
        and(
          eq(integrationSyncState.trackerId, trackerId),
          eq(integrationSyncState.provider, "xunji"),
        ),
      );

    const resumed = await syncProviderCatchUpBatch({
      trackerId,
      provider: "xunji",
      startedOn: "2026-07-01",
      today: "2026-07-04",
      now: new Date("2026-07-04T08:01:00.000Z"),
      batchSize: 2,
      store: catchUpStore,
      syncDate: syncDate("2026-07-03"),
    });
    expect(resumed.days).toEqual([
      { date: "2026-07-03", status: "failed", errorCode: "rate_limited" },
    ]);
    expect(resumed).toMatchObject({
      nextCursor: "2026-07-03",
      complete: false,
      summary: { succeeded: 0, failed: 1 },
    });

    const failedStates = await database
      .select({
        date: integrationDateSyncState.localDate,
        status: integrationDateSyncState.status,
        errorCode: integrationDateSyncState.lastErrorCode,
      })
      .from(integrationDateSyncState)
      .where(
        and(
          eq(integrationDateSyncState.trackerId, trackerId),
          eq(integrationDateSyncState.provider, "xunji"),
        ),
      );
    const [failedOverall] = await database
      .select({
        status: integrationSyncState.status,
        cursor: integrationSyncState.cursor,
        errorCode: integrationSyncState.lastErrorCode,
      })
      .from(integrationSyncState)
      .where(
        and(
          eq(integrationSyncState.trackerId, trackerId),
          eq(integrationSyncState.provider, "xunji"),
        ),
      );

    expect(failedStates).toEqual(
      expect.arrayContaining([
        { date: "2026-07-01", status: "succeeded", errorCode: null },
        { date: "2026-07-02", status: "succeeded", errorCode: null },
        {
          date: "2026-07-03",
          status: "failed",
          errorCode: "rate_limited",
        },
      ]),
    );
    expect(failedStates.some((state) => state.date === "2026-07-04")).toBe(
      false,
    );
    expect(failedOverall).toEqual({
      status: "failed",
      cursor: { kind: "date_catch_up_v1", nextDate: "2026-07-03" },
      errorCode: "rate_limited",
    });

    const recovered = await syncProviderCatchUpBatch({
      trackerId,
      provider: "xunji",
      startedOn: "2026-07-01",
      today: "2026-07-04",
      now: new Date("2026-07-04T08:02:00.000Z"),
      batchSize: 2,
      store: catchUpStore,
      syncDate: syncDate(),
    });
    expect(recovered.days).toEqual([
      expect.objectContaining({ date: "2026-07-03", status: "succeeded" }),
      expect.objectContaining({ date: "2026-07-04", status: "succeeded" }),
    ]);
    expect(recovered).toMatchObject({
      nextCursor: null,
      complete: true,
      summary: { succeeded: 2, failed: 0 },
    });

    const finalStates = await database
      .select({
        date: integrationDateSyncState.localDate,
        status: integrationDateSyncState.status,
        errorCode: integrationDateSyncState.lastErrorCode,
      })
      .from(integrationDateSyncState)
      .where(
        and(
          eq(integrationDateSyncState.trackerId, trackerId),
          eq(integrationDateSyncState.provider, "xunji"),
        ),
      );
    const [finalOverall] = await database
      .select({
        status: integrationSyncState.status,
        cursor: integrationSyncState.cursor,
        errorCode: integrationSyncState.lastErrorCode,
      })
      .from(integrationSyncState)
      .where(
        and(
          eq(integrationSyncState.trackerId, trackerId),
          eq(integrationSyncState.provider, "xunji"),
        ),
      );
    expect(finalStates).toEqual(
      expect.arrayContaining([
        { date: "2026-07-01", status: "succeeded", errorCode: null },
        { date: "2026-07-02", status: "succeeded", errorCode: null },
        { date: "2026-07-03", status: "succeeded", errorCode: null },
        { date: "2026-07-04", status: "succeeded", errorCode: null },
      ]),
    );
    expect(finalOverall).toEqual({
      status: "succeeded",
      cursor: null,
      errorCode: null,
    });
  }, 30_000);
});
