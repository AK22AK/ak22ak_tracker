import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/db/client";
import {
  integrationDateSyncState,
  integrationSyncState,
  trackers,
} from "@/server/db/schema";
import { createNeonProviderDateSyncStore } from "@/server/integrations/core/neon-date-sync-store";
import { createNeonProviderHistoryStore } from "@/server/integrations/core/neon-history-sync-store";
import { getProviderHistoryOverview } from "@/server/integrations/core/history-sync-overview";
import { syncProviderDate } from "@/server/integrations/core/sync-provider-date";
import { syncProviderHistoryBatch } from "@/server/integrations/core/sync-provider-history";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("P5b provider-neutral bounded history persistence", () => {
  const trackerId = randomUUID();
  const trackerKey = `anonymous-history-${randomUUID()}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await getDatabase().insert(trackers).values({
      id: trackerId,
      key: trackerKey,
      name: "Anonymous history tracker",
      module: "anonymous",
      startedOn: "2026-08-03",
      planningTimeZone: "Asia/Shanghai",
    });
  });

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    await getDatabase().delete(trackers).where(eq(trackers.id, trackerId));
  });

  it("persists empty days and a failed cursor without touching the normal cursor", async () => {
    const database = getDatabase();
    const normalDateStore = createNeonProviderDateSyncStore(
      trackerKey,
      database,
      { stateProvider: "xunji" },
    );
    await syncProviderDate({
      trackerId,
      provider: "xunji",
      date: "2026-08-03",
      now: new Date("2026-08-03T08:00:00.000Z"),
      store: normalDateStore,
      readSource: async () => [],
    });
    await database.insert(integrationSyncState).values({
      trackerId,
      provider: "xunji",
      status: "succeeded",
      cursor: { kind: "date_catch_up_v1", nextDate: null },
      lastSucceededAt: new Date("2026-08-03T08:00:00.000Z"),
      updatedAt: new Date("2026-08-03T08:00:00.000Z"),
    });

    const historyDateStore = createNeonProviderDateSyncStore(
      trackerKey,
      database,
      { stateProvider: "xunji_training_history" },
    );
    const store = createNeonProviderHistoryStore(database);
    const syncDate = (failedDate?: string) => (date: string) =>
      syncProviderDate({
        trackerId,
        provider: "xunji",
        date,
        now: new Date("2026-08-03T08:01:00.000Z"),
        store: historyDateStore,
        readSource: async () => {
          if (date === failedDate) {
            throw Object.assign(new Error("anonymous limited"), {
              code: "rate_limited",
            });
          }
          return [];
        },
      });

    const first = await syncProviderHistoryBatch({
      trackerId,
      provider: "xunji",
      scope: "xunji_training_history",
      days: 7,
      today: "2026-08-03",
      now: new Date("2026-08-03T08:01:00.000Z"),
      batchSize: 2,
      store,
      syncDate: syncDate(),
    });
    expect(first).toMatchObject({
      range: { from: "2026-07-28", through: "2026-08-03", days: 7 },
      summary: { succeeded: 2, empty: 2, failed: 0 },
      nextCursor: "2026-07-30",
    });

    const failed = await syncProviderHistoryBatch({
      trackerId,
      provider: "xunji",
      scope: "xunji_training_history",
      days: 7,
      today: "2026-08-03",
      now: new Date("2026-08-03T08:02:00.000Z"),
      batchSize: 2,
      store,
      syncDate: syncDate("2026-07-30"),
    });
    expect(failed).toMatchObject({
      days: [
        {
          date: "2026-07-30",
          status: "failed",
          errorCode: "rate_limited",
        },
      ],
      nextCursor: "2026-07-30",
      complete: false,
    });

    const [normal, history] = await database
      .select({
        provider: integrationSyncState.provider,
        cursor: integrationSyncState.cursor,
        status: integrationSyncState.status,
      })
      .from(integrationSyncState)
      .where(
        and(
          eq(integrationSyncState.trackerId, trackerId),
          inArray(integrationSyncState.provider, [
            "xunji",
            "xunji_training_history",
          ]),
        ),
      )
      .orderBy(integrationSyncState.provider);
    expect(normal).toEqual({
      provider: "xunji",
      cursor: { kind: "date_catch_up_v1", nextDate: null },
      status: "succeeded",
    });
    expect(history).toMatchObject({
      provider: "xunji_training_history",
      cursor: {
        kind: "bounded_date_range_v1",
        rangeFrom: "2026-07-28",
        rangeThrough: "2026-08-03",
        nextDate: "2026-07-30",
      },
      status: "failed",
    });

    const historyDates = await database
      .select({
        provider: integrationDateSyncState.provider,
        date: integrationDateSyncState.localDate,
        status: integrationDateSyncState.status,
        recordCount: integrationDateSyncState.recordCount,
      })
      .from(integrationDateSyncState)
      .where(
        and(
          eq(integrationDateSyncState.trackerId, trackerId),
          eq(integrationDateSyncState.provider, "xunji_training_history"),
        ),
      );
    expect(historyDates).toEqual(
      expect.arrayContaining([
        {
          provider: "xunji_training_history",
          date: "2026-07-28",
          status: "succeeded",
          recordCount: 0,
        },
        {
          provider: "xunji_training_history",
          date: "2026-07-29",
          status: "succeeded",
          recordCount: 0,
        },
        {
          provider: "xunji_training_history",
          date: "2026-07-30",
          status: "failed",
          recordCount: 0,
        },
      ]),
    );

    const overview = await getProviderHistoryOverview(trackerKey, database);
    expect(overview).toMatchObject({
      range: { from: "2026-07-28", through: "2026-08-03", days: 7 },
      scopes: expect.arrayContaining([
        expect.objectContaining({
          scope: "xunji_training_history",
          nextCursor: "2026-07-30",
          summary: {
            processed: 2,
            records: 0,
            empty: 2,
            failed: 1,
            unknown: 4,
          },
        }),
      ]),
      recordDates: [],
    });
  });
});
