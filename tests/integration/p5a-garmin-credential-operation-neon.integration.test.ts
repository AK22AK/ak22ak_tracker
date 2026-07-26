import { randomBytes, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDatabase } from "@/server/db/client";
import { integrationSyncState, trackers } from "@/server/db/schema";
import {
  claimIntegrationCredentialOperation,
  markIntegrationConnectionFailureUnderOperationLease,
  readIntegrationCredential,
  releaseIntegrationCredentialOperation,
  saveIntegrationCredential,
  saveIntegrationCredentialUnderOperationLease,
} from "@/server/integrations/credentials/repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("P5a-2b shared Garmin credential operation lease", () => {
  const trackerId = randomUUID();
  const trackerKey = `anonymous-${randomUUID()}`;
  const firstCredential = "anonymous-first-credential";
  const replacementCredential = "anonymous-replacement-credential";
  const claimedAt = new Date("2026-07-27T01:00:00.000Z");
  const expiresAt = new Date("2026-07-27T01:02:00.000Z");

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
      startedOn: "2026-07-01",
      planningTimeZone: "Asia/Shanghai",
    });
    await saveIntegrationCredential({
      trackerId,
      provider: "garmin",
      plaintext: firstCredential,
      verifiedAt: claimedAt,
      database,
    });
    await database.insert(integrationSyncState).values([
      {
        trackerId,
        provider: "garmin",
        status: "idle",
        cursor: { kind: "date_catch_up_v1", nextDate: "2026-07-20" },
      },
      {
        trackerId,
        provider: "garmin_wellness",
        status: "idle",
        cursor: { kind: "date_catch_up_v1", nextDate: "2026-07-22" },
      },
    ]);
  });

  afterAll(async () => {
    if (testDatabaseUrl) {
      await getDatabase().delete(trackers).where(eq(trackers.id, trackerId));
    }
    delete process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY;
    delete process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY_VERSION;
  });

  it("serializes scopes, enforces owner writes, recovers expiry, and invalidates old owners on replacement", async () => {
    const database = getDatabase();
    const firstOwner = randomUUID();
    const secondOwner = randomUUID();
    const [first, concurrent] = await Promise.all([
      claimIntegrationCredentialOperation({
        trackerId,
        provider: "garmin",
        owner: firstOwner,
        claimedAt,
        expiresAt,
        database,
      }),
      claimIntegrationCredentialOperation({
        trackerId,
        provider: "garmin",
        owner: secondOwner,
        claimedAt,
        expiresAt,
        database,
      }),
    ]);
    expect([first.status, concurrent.status].sort()).toEqual([
      "busy",
      "claimed",
    ]);
    const activeOwner = first.status === "claimed" ? firstOwner : secondOwner;
    const otherOwner = activeOwner === firstOwner ? secondOwner : firstOwner;

    await expect(
      saveIntegrationCredentialUnderOperationLease({
        trackerId,
        provider: "garmin",
        owner: otherOwner,
        plaintext: "anonymous-invalid-write",
        verifiedAt: claimedAt,
        savedAt: new Date("2026-07-27T01:00:30.000Z"),
        expiresAt,
        database,
      }),
    ).resolves.toBe(false);
    await expect(
      markIntegrationConnectionFailureUnderOperationLease({
        trackerId,
        provider: "garmin",
        owner: otherOwner,
        failedAt: new Date("2026-07-27T01:00:30.000Z"),
        errorCode: "authentication",
        database,
      }),
    ).resolves.toBe(false);
    await expect(
      releaseIntegrationCredentialOperation({
        trackerId,
        provider: "garmin",
        owner: otherOwner,
        database,
      }),
    ).resolves.toBe(false);
    await expect(
      readIntegrationCredential({ trackerId, provider: "garmin", database }),
    ).resolves.toBe(firstCredential);

    const recoveredOwner = randomUUID();
    await expect(
      claimIntegrationCredentialOperation({
        trackerId,
        provider: "garmin",
        owner: recoveredOwner,
        claimedAt: new Date("2026-07-27T01:02:01.000Z"),
        expiresAt: new Date("2026-07-27T01:04:01.000Z"),
        database,
      }),
    ).resolves.toMatchObject({ status: "claimed" });

    await saveIntegrationCredential({
      trackerId,
      provider: "garmin",
      plaintext: replacementCredential,
      verifiedAt: new Date("2026-07-27T01:02:30.000Z"),
      database,
    });
    await expect(
      saveIntegrationCredentialUnderOperationLease({
        trackerId,
        provider: "garmin",
        owner: recoveredOwner,
        plaintext: "anonymous-stale-refreshed-credential",
        verifiedAt: new Date("2026-07-27T01:02:31.000Z"),
        savedAt: new Date("2026-07-27T01:02:31.000Z"),
        expiresAt: new Date("2026-07-27T01:04:31.000Z"),
        database,
      }),
    ).resolves.toBe(false);
    await expect(
      readIntegrationCredential({ trackerId, provider: "garmin", database }),
    ).resolves.toBe(replacementCredential);

    const scopes = await database
      .select({
        provider: integrationSyncState.provider,
        status: integrationSyncState.status,
        cursor: integrationSyncState.cursor,
      })
      .from(integrationSyncState)
      .where(
        and(
          eq(integrationSyncState.trackerId, trackerId),
          eq(integrationSyncState.status, "idle"),
        ),
      );
    expect(scopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "garmin",
          cursor: { kind: "date_catch_up_v1", nextDate: "2026-07-20" },
        }),
        expect.objectContaining({
          provider: "garmin_wellness",
          cursor: { kind: "date_catch_up_v1", nextDate: "2026-07-22" },
        }),
      ]),
    );
  }, 20_000);
});
