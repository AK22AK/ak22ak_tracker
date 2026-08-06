import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/db/client";
import { integrationSyncState, trackers } from "@/server/db/schema";
import {
  claimIntegrationProviderCooldown,
  extendIntegrationProviderCooldown,
} from "@/server/integrations/credentials/repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("Xunji provider cooldown atomic persistence", () => {
  const trackerId = randomUUID();
  const trackerKey = `anonymous-cooldown-${randomUUID()}`;
  const start = new Date("2026-08-06T00:00:00.000Z");

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await getDatabase().insert(trackers).values({
      id: trackerId,
      key: trackerKey,
      name: "Anonymous cooldown tracker",
      module: "anonymous",
      startedOn: "2026-08-01",
      planningTimeZone: "Asia/Shanghai",
    });
  });

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    await getDatabase().delete(trackers).where(eq(trackers.id, trackerId));
  });

  it("allows one atomic claim, blocks other scopes, preserves business cursor state, and recovers after expiry", async () => {
    const first = await claimIntegrationProviderCooldown({
      trackerId,
      provider: "xunji",
      claimedAt: start,
      cooldownUntil: new Date(start.valueOf() + 30_000),
    });
    expect(first).toMatchObject({
      status: "claimed",
      cooldown: { kind: "normal", retryAfterMs: 30_000 },
    });

    const blocked = await claimIntegrationProviderCooldown({
      trackerId,
      provider: "xunji",
      claimedAt: start,
      cooldownUntil: new Date(start.valueOf() + 30_000),
    });
    expect(blocked).toMatchObject({
      status: "cooldown",
      cooldown: { kind: "normal", retryAfterMs: 30_000 },
    });

    const [state] = await getDatabase()
      .select({
        status: integrationSyncState.status,
        cursor: integrationSyncState.cursor,
      })
      .from(integrationSyncState)
      .where(eq(integrationSyncState.trackerId, trackerId));
    expect(state).toEqual({ status: "idle", cursor: null });

    const recovered = await claimIntegrationProviderCooldown({
      trackerId,
      provider: "xunji",
      claimedAt: new Date(start.valueOf() + 30_000),
      cooldownUntil: new Date(start.valueOf() + 60_000),
    });
    expect(recovered).toMatchObject({
      status: "claimed",
      cooldown: { retryAfterMs: 30_000 },
    });
  });

  it("uses a Provider retry_after_ms longer than the default without changing scope state", async () => {
    const claimedAt = new Date(start.valueOf() + 60_000);
    await claimIntegrationProviderCooldown({
      trackerId,
      provider: "xunji",
      claimedAt,
      cooldownUntil: new Date(claimedAt.valueOf() + 30_000),
    });
    const extended = await extendIntegrationProviderCooldown({
      trackerId,
      provider: "xunji",
      now: claimedAt,
      cooldownUntil: new Date(claimedAt.valueOf() + 45_000),
    });
    expect(extended).toMatchObject({
      kind: "rate_limited",
      retryAfterMs: 45_000,
    });

    const blocked = await claimIntegrationProviderCooldown({
      trackerId,
      provider: "xunji",
      claimedAt: new Date(claimedAt.valueOf() + 30_000),
      cooldownUntil: new Date(claimedAt.valueOf() + 60_000),
    });
    expect(blocked).toMatchObject({
      status: "cooldown",
      cooldown: { kind: "rate_limited", retryAfterMs: 15_000 },
    });
  });
});
