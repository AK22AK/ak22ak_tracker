// @vitest-environment node

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/db/client";
import { githubSyncOutbox } from "@/server/db/schema";
import { createNeonGitHubMirrorOutboxStore } from "@/server/mirror/neon-outbox-store";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("P3a GitHub outbox lease integration", () => {
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const aggregateIds = [randomUUID(), randomUUID(), randomUUID()];
  const sharedPath =
    "trackers/example-tracker/events/2026/07/019c0000-0000-7000-8000-000000000021.json";
  const recoveredPath =
    "trackers/example-tracker/events/2026/07/019c0000-0000-7000-8000-000000000022.json";

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const database = getDatabase();
    await database.insert(githubSyncOutbox).values([
      {
        id: ids[0],
        aggregateType: "anonymous_event",
        aggregateId: aggregateIds[0],
        targetPath: sharedPath,
        payload: { order: 1 },
        createdAt: new Date("2026-07-20T08:00:00.000Z"),
        updatedAt: new Date("2026-07-20T08:00:00.000Z"),
        nextAttemptAt: new Date("2026-07-20T08:00:00.000Z"),
      },
      {
        id: ids[1],
        aggregateType: "anonymous_event",
        aggregateId: aggregateIds[1],
        targetPath: sharedPath,
        payload: { order: 2 },
        createdAt: new Date("2026-07-20T08:01:00.000Z"),
        updatedAt: new Date("2026-07-20T08:01:00.000Z"),
        nextAttemptAt: new Date("2026-07-20T08:00:00.000Z"),
      },
      {
        id: ids[2],
        aggregateType: "anonymous_event",
        aggregateId: aggregateIds[2],
        targetPath: recoveredPath,
        payload: { recovered: true },
        status: "processing",
        leaseOwner: "expired-worker",
        leaseExpiresAt: new Date("2026-07-20T07:59:00.000Z"),
        createdAt: new Date("2026-07-20T07:58:00.000Z"),
        updatedAt: new Date("2026-07-20T07:58:00.000Z"),
      },
    ]);
  });

  afterAll(async () => {
    await getDatabase()
      .delete(githubSyncOutbox)
      .where(inArray(githubSyncOutbox.id, ids));
  });

  it("claims concurrently without duplicating a row and recovers an expired lease", async () => {
    const store = createNeonGitHubMirrorOutboxStore();
    const now = new Date("2026-07-20T08:02:00.000Z");
    const [first, second] = await Promise.all([
      store.claimNext({
        leaseOwner: "worker-a",
        now,
        leaseExpiresAt: new Date("2026-07-20T08:03:00.000Z"),
      }),
      store.claimNext({
        leaseOwner: "worker-b",
        now,
        leaseExpiresAt: new Date("2026-07-20T08:03:00.000Z"),
      }),
    ]);
    expect(first?.id).not.toBe(second?.id);
    expect(new Set([first?.id, second?.id])).toEqual(new Set([ids[0], ids[2]]));

    const shared = first?.targetPath === sharedPath ? first : second;
    const sharedOwner = shared === first ? "worker-a" : "worker-b";
    expect(await store.markSucceeded(shared!.id, sharedOwner, now)).toBe(true);

    const next = await store.claimNext({
      leaseOwner: "worker-c",
      now,
      leaseExpiresAt: new Date("2026-07-20T08:03:00.000Z"),
    });
    expect(next?.id).toBe(ids[1]);

    const [stillProcessing] = await getDatabase()
      .select({ leaseOwner: githubSyncOutbox.leaseOwner })
      .from(githubSyncOutbox)
      .where(eq(githubSyncOutbox.id, ids[2]!));
    expect(stillProcessing?.leaseOwner).not.toBe("expired-worker");
  });
});
