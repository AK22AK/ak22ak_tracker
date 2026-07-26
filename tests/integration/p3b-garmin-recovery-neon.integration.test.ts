import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/db/client";
import { integrationSyncState, trackers } from "@/server/db/schema";
import { createNeonAutomaticProviderRecoveryClaimStore } from "@/server/integrations/core/neon-automatic-recovery-store";
import { createNeonProviderCatchUpStore } from "@/server/integrations/core/neon-catch-up-store";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("P3b-2d Garmin automatic recovery claim", () => {
  const trackerId = randomUUID();
  const trackerKey = `anonymous-${randomUUID()}`;
  const firstAttemptAt = new Date("2026-07-24T03:00:00.000Z");

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await getDatabase().insert(trackers).values({
      id: trackerId,
      key: trackerKey,
      name: "Anonymous recovery tracker",
      module: "anonymous",
      startedOn: "2026-07-01",
      planningTimeZone: "Asia/Shanghai",
    });
  });

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    await getDatabase().delete(trackers).where(eq(trackers.id, trackerId));
  });

  it("atomically suppresses concurrent claims and recovers an expired lease", async () => {
    const database = getDatabase();
    const store = createNeonAutomaticProviderRecoveryClaimStore(database);
    const claim = (attemptedAt: Date, provider = "garmin") =>
      store.claim({
        trackerId,
        provider,
        attemptedAt,
        minimumIntervalMs: 30 * 60_000,
        leaseMs: 2 * 60_000,
      });

    const concurrent = await Promise.all([
      claim(firstAttemptAt),
      claim(firstAttemptAt),
    ]);
    expect(concurrent.sort()).toEqual(["claimed", "in_progress"]);
    const wellnessConcurrent = await Promise.all([
      claim(firstAttemptAt, "garmin_wellness"),
      claim(firstAttemptAt, "garmin_wellness"),
    ]);
    expect(wellnessConcurrent.sort()).toEqual(["claimed", "in_progress"]);

    await database
      .update(integrationSyncState)
      .set({ status: "succeeded", lastAttemptAt: firstAttemptAt })
      .where(
        and(
          eq(integrationSyncState.trackerId, trackerId),
          eq(integrationSyncState.provider, "garmin"),
        ),
      );
    await expect(claim(new Date("2026-07-24T03:10:00.000Z"))).resolves.toBe(
      "not_due",
    );
    await expect(claim(new Date("2026-07-24T03:31:00.000Z"))).resolves.toBe(
      "claimed",
    );

    await expect(claim(new Date("2026-07-24T03:32:00.000Z"))).resolves.toBe(
      "in_progress",
    );
    await expect(claim(new Date("2026-07-24T03:34:00.000Z"))).resolves.toBe(
      "claimed",
    );
  }, 20_000);

  it("keeps activity and wellness catch-up cursors independent", async () => {
    const store = createNeonProviderCatchUpStore(getDatabase());
    await store.saveProgress({
      trackerId,
      provider: "garmin",
      attemptedAt: firstAttemptAt,
      cursorDate: "2026-07-20",
      status: "running",
      lastErrorCode: null,
    });
    await store.saveProgress({
      trackerId,
      provider: "garmin_wellness",
      attemptedAt: firstAttemptAt,
      cursorDate: "2026-07-22",
      status: "failed",
      lastErrorCode: "rate_limited",
    });

    const [activity, wellness] = await Promise.all([
      store.loadProgress({
        trackerId,
        provider: "garmin",
        startedOn: "2026-07-01",
        targetDate: "2026-07-24",
      }),
      store.loadProgress({
        trackerId,
        provider: "garmin_wellness",
        startedOn: "2026-07-01",
        targetDate: "2026-07-24",
      }),
    ]);

    expect(activity).toMatchObject({
      cursorDate: "2026-07-20",
      overallStatus: "running",
      lastErrorCode: null,
    });
    expect(wellness).toMatchObject({
      cursorDate: "2026-07-22",
      overallStatus: "failed",
      lastErrorCode: "rate_limited",
    });
  });
});
