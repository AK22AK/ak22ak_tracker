import { randomBytes, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { schemaVersion } from "@/domain/schemas";
import { createNeonTaskCommandStore } from "@/server/commands/task-command";
import { executeTaskCommand } from "@/server/commands/task-command-core";
import { getDatabase } from "@/server/db/client";
import {
  events,
  externalRecordLinks,
  externalRecords,
  githubSyncOutbox,
  integrationCredentials,
  integrationDateSyncState,
  planVersions,
  taskInstances,
  trackers,
} from "@/server/db/schema";
import { createNeonProviderDateSyncStore } from "@/server/integrations/core/neon-date-sync-store";
import { syncProviderDate } from "@/server/integrations/core/sync-provider-date";
import {
  readIntegrationCredential,
  saveIntegrationCredential,
} from "@/server/integrations/credentials/repository";
import { createXunjiReadOnlyAdapter } from "@/server/integrations/xunji/adapter";
import { normalizeXunjiTrains } from "@/server/integrations/xunji/normalize";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("P1a Xunji provider-neutral database slice", () => {
  const trackerId = randomUUID();
  const trackerKey = `anonymous-${randomUUID()}`;
  const planVersionId = randomUUID();
  const taskId = randomUUID();
  const taskCommandId = randomUUID();
  const date = "2026-07-19";

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY =
      randomBytes(32).toString("base64");
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY_VERSION = "1";
    const database = getDatabase();
    await database.insert(trackers).values({
      id: trackerId,
      key: trackerKey,
      name: "Anonymous Tracker",
      module: "anonymous",
      startedOn: date,
      planningTimeZone: "Asia/Shanghai",
    });
    await database.insert(planVersions).values({
      id: planVersionId,
      trackerId,
      version: 1,
      effectiveFrom: date,
      document: {
        schemaVersion,
        id: planVersionId,
        trackerKey,
        version: 1,
        effectiveFrom: date,
        createdAt: "2026-07-19T00:00:00.000Z",
        createdBy: "import",
        tasks: [],
      },
    });
    await database.insert(taskInstances).values({
      id: taskId,
      trackerId,
      planVersionId,
      taskDefinitionId: "anonymous-task",
      scheduledOn: date,
    });
  });

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    const database = getDatabase();
    await database
      .delete(githubSyncOutbox)
      .where(eq(githubSyncOutbox.aggregateId, taskCommandId));
    await database.delete(trackers).where(eq(trackers.id, trackerId));
    delete process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY;
    delete process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY_VERSION;
  });

  it("stores encrypted credentials without returning plaintext", async () => {
    const database = getDatabase();
    await saveIntegrationCredential({
      trackerId,
      provider: "xunji",
      plaintext: "anonymous-fake-key",
      verifiedAt: new Date("2026-07-19T08:00:00.000Z"),
      database,
    });
    const [row] = await database
      .select({
        ciphertext: integrationCredentials.ciphertext,
        nonce: integrationCredentials.nonce,
      })
      .from(integrationCredentials)
      .where(
        and(
          eq(integrationCredentials.trackerId, trackerId),
          eq(integrationCredentials.provider, "xunji"),
        ),
      );

    expect(row?.ciphertext).not.toContain("anonymous-fake-key");
    expect(row?.nonce).toBeTruthy();
    await expect(
      readIntegrationCredential({ trackerId, provider: "xunji", database }),
    ).resolves.toBe("anonymous-fake-key");
  });

  it("upserts idempotently and versions a changed source record", async () => {
    const database = getDatabase();
    const store = createNeonProviderDateSyncStore(trackerKey, database);
    const input = (title: string, now: Date) => ({
      trackerId,
      provider: "xunji" as const,
      date,
      now,
      store,
      readSource: async () =>
        normalizeXunjiTrains({
          trains: [{ localid: "anonymous-train-1", title }],
          date,
          fetchedAt: now,
          planningTimeZone: "Asia/Shanghai",
        }),
    });

    const first = await syncProviderDate(
      input("Anonymous session", new Date("2026-07-19T08:00:00.000Z")),
    );
    const [createdRecord] = await database
      .select({ id: externalRecords.id })
      .from(externalRecords)
      .where(
        and(
          eq(externalRecords.trackerId, trackerId),
          eq(externalRecords.providerRecordId, "anonymous-train-1"),
        ),
      );
    await database.insert(externalRecordLinks).values({
      externalRecordId: createdRecord!.id,
      taskInstanceId: taskId,
      status: "confirmed",
      confirmedAt: new Date("2026-07-19T08:00:05.000Z"),
      sourceVersion: 1,
    });
    const cached = await syncProviderDate(
      input("Ignored during cache", new Date("2026-07-19T08:00:10.000Z")),
    );
    const unchanged = await syncProviderDate(
      input("Anonymous session", new Date("2026-07-19T08:01:00.000Z")),
    );
    const changed = await syncProviderDate(
      input("Updated session", new Date("2026-07-19T08:02:00.000Z")),
    );
    const rows = await database
      .select({
        sourceVersion: externalRecords.sourceVersion,
        sourceChangedAt: externalRecords.sourceChangedAt,
      })
      .from(externalRecords)
      .where(
        and(
          eq(externalRecords.trackerId, trackerId),
          eq(externalRecords.provider, "xunji"),
        ),
      );
    const [link] = await database
      .select({
        sourceVersion: externalRecordLinks.sourceVersion,
        needsReview: externalRecordLinks.needsReview,
      })
      .from(externalRecordLinks)
      .where(eq(externalRecordLinks.externalRecordId, createdRecord!.id));

    expect(first).toMatchObject({ created: 1, recordCount: 1 });
    expect(cached).toMatchObject({ cached: true, unchanged: 1 });
    expect(unchanged).toMatchObject({ unchanged: 1 });
    expect(changed).toMatchObject({ changed: 1 });
    expect(rows).toEqual([
      expect.objectContaining({
        sourceVersion: 2,
        sourceChangedAt: expect.any(Date),
      }),
    ]);
    expect(link).toEqual({ sourceVersion: 1, needsReview: true });
  });

  it("keeps core task/event/outbox committed when the real provider boundary fails (P0-10)", async () => {
    const database = getDatabase();
    await executeTaskCommand(createNeonTaskCommandStore(database), {
      commandId: taskCommandId,
      taskId,
      status: "completed",
      actual: null,
      note: "anonymous manual record",
      occurredAt: "2026-07-19T08:03:00.000Z",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
    });
    const adapter = createXunjiReadOnlyAdapter({
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 429 })),
    });

    await expect(
      syncProviderDate({
        trackerId,
        provider: "xunji",
        date: "2026-07-20",
        now: new Date("2026-07-20T08:00:00.000Z"),
        store: createNeonProviderDateSyncStore(trackerKey, database),
        readSource: async () =>
          normalizeXunjiTrains({
            trains: await adapter.fetchTrainsForDate({
              apiKey: "anonymous-fake-key",
              date: "2026-07-20",
            }),
            date: "2026-07-20",
            fetchedAt: new Date("2026-07-20T08:00:00.000Z"),
            planningTimeZone: "Asia/Shanghai",
          }),
      }),
    ).rejects.toMatchObject({ code: "rate_limited" });

    const [task] = await database
      .select({ status: taskInstances.status })
      .from(taskInstances)
      .where(eq(taskInstances.id, taskId));
    const eventRows = await database
      .select({ id: events.id })
      .from(events)
      .where(eq(events.idempotencyKey, taskCommandId));
    const outboxRows = await database
      .select({ id: githubSyncOutbox.id })
      .from(githubSyncOutbox)
      .where(eq(githubSyncOutbox.aggregateId, taskCommandId));
    const [failed] = await database
      .select({
        status: integrationDateSyncState.status,
        lastErrorCode: integrationDateSyncState.lastErrorCode,
      })
      .from(integrationDateSyncState)
      .where(
        and(
          eq(integrationDateSyncState.trackerId, trackerId),
          eq(integrationDateSyncState.provider, "xunji"),
          eq(integrationDateSyncState.localDate, "2026-07-20"),
        ),
      );

    expect(task?.status).toBe("completed");
    expect(eventRows).toHaveLength(1);
    expect(outboxRows).toHaveLength(1);
    expect(failed).toEqual({ status: "failed", lastErrorCode: "rate_limited" });
  });
});
