// @vitest-environment node

import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import type { TodayAggregate } from "@/domain/api-contracts";
import {
  createOfflineDatabase,
  type TrackerOfflineDatabase,
} from "@/offline/store";
import {
  clearOfflinePrivateData,
  prepareOfflineIdentity,
  readQuerySnapshot,
  saveQuerySnapshot,
} from "@/offline/query-snapshots";
import { projectTodaySnapshot } from "@/offline/snapshot-contracts";

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

const databases: TrackerOfflineDatabase[] = [];

function database() {
  const instance = createOfflineDatabase(
    `ak-tracker-test-${crypto.randomUUID()}`,
  );
  databases.push(instance);
  return instance;
}

function anonymousToday(): TodayAggregate {
  return {
    tracker: {
      key: "knee-rehab",
      name: "Anonymous Tracker",
      startedOn: "2026-07-01",
      planningTimeZone: "Asia/Shanghai",
    },
    targetDate: "2026-07-21",
    plan: {
      id: "019c0000-0000-7000-8000-000000000001",
      version: 1,
      effectiveFrom: "2026-07-01",
    },
    day: {
      state: "ready",
      trackerName: "Anonymous Tracker",
      startDate: "2026-07-01",
      planVersion: 1,
      tasks: [],
      feedbackCount: 0,
      feedbacks: [],
      externalTrainingRecords: [],
    },
    safetyPolicy: {
      schemaVersion: "1.0.0",
      policyId: "019c0000-0000-7000-8000-000000000002",
      trackerKey: "knee-rehab",
      version: 3,
      effectiveFrom: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
      createdBy: "import",
      rules: [
        {
          id: "anonymous-rule",
          outcome: "yellow",
          match: "all",
          conditions: [{ operator: "number_gte", field: "score", value: 999 }],
        },
      ],
      hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    execution: {
      context: null,
      day: null,
      alternatives: [],
      safety: { blocked: false, reason: null },
    },
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((instance) => instance.delete()));
});

describe("private offline query snapshots (P2a)", () => {
  it("migrates the version 1 scaffold to the versioned snapshot schema without retaining legacy tables", async () => {
    const name = `ak-tracker-legacy-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      pendingEvents: "id, queuedAt",
      cachedPlans: "trackerKey, cachedAt",
    });
    await legacy.table("cachedPlans").put({
      trackerKey: "anonymous",
      cachedAt: "2026-07-01T00:00:00.000Z",
    });
    legacy.close();

    const upgraded = createOfflineDatabase(name);
    databases.push(upgraded);
    await upgraded.open();

    expect(upgraded.tables.map((table) => table.name).sort()).toEqual([
      "metadata",
      "pendingCommands",
      "querySnapshots",
      "safetyPolicies",
    ]);
    expect(await upgraded.querySnapshots.count()).toBe(0);
  });

  it("persists only the Today whitelist and restores it for the same immutable identity", async () => {
    const db = database();
    await prepareOfflineIdentity(db, "10001");
    const projected = projectTodaySnapshot(anonymousToday());

    await saveQuerySnapshot(db, {
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      kind: "today",
      scope: "2026-07-21",
      data: projected,
      savedAt: "2026-07-21T03:00:00.000Z",
      expiresAt: "2026-07-28T03:00:00.000Z",
      sourceVersion: "plan:1;policy:3:aaaaaaaa",
    });

    const restored = await readQuerySnapshot(db, {
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      kind: "today",
      scope: "2026-07-21",
      now: new Date("2026-07-21T04:00:00.000Z"),
    });

    expect(restored?.data).toEqual(projected);
    expect(JSON.stringify(restored)).not.toContain("rules");
    expect(JSON.stringify(restored)).not.toMatch(
      /authorization|cookie|api.?key|raw.?payload/i,
    );
    expect(
      await readQuerySnapshot(db, {
        githubUserId: "10002",
        trackerKey: "knee-rehab",
        kind: "today",
        scope: "2026-07-21",
      }),
    ).toBeNull();
  });

  it("rejects expired and damaged snapshots instead of presenting them as current", async () => {
    const db = database();
    await prepareOfflineIdentity(db, "10001");
    await saveQuerySnapshot(db, {
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      kind: "today",
      scope: "2026-07-21",
      data: projectTodaySnapshot(anonymousToday()),
      savedAt: "2026-07-20T00:00:00.000Z",
      expiresAt: "2026-07-21T00:00:00.000Z",
      sourceVersion: "anonymous",
    });

    expect(
      await readQuerySnapshot(db, {
        githubUserId: "10001",
        trackerKey: "knee-rehab",
        kind: "today",
        scope: "2026-07-21",
        now: new Date("2026-07-21T00:00:01.000Z"),
      }),
    ).toBeNull();

    await db.querySnapshots.put({
      id: "10001:knee-rehab:today:2026-07-21",
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      kind: "today",
      scope: "2026-07-21",
      schemaVersion: 2,
      savedAt: "2026-07-21T03:00:00.000Z",
      expiresAt: "2026-07-28T03:00:00.000Z",
      sourceVersion: "anonymous",
      data: { invalid: true },
    });
    expect(
      await readQuerySnapshot(db, {
        githubUserId: "10001",
        trackerKey: "knee-rehab",
        kind: "today",
        scope: "2026-07-21",
      }),
    ).toBeNull();
  });

  it("clears all private tables when the immutable identity changes or the user clears local data", async () => {
    const db = database();
    await prepareOfflineIdentity(db, "10001");
    await saveQuerySnapshot(db, {
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      kind: "today",
      scope: "2026-07-21",
      data: projectTodaySnapshot(anonymousToday()),
      savedAt: "2026-07-21T03:00:00.000Z",
      expiresAt: "2026-07-28T03:00:00.000Z",
      sourceVersion: "anonymous",
    });
    await db.pendingCommands.put({
      id: "019c0000-0000-7000-8000-000000000099",
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      createdAt: "2026-07-21T03:00:00.000Z",
      occurredAt: "2026-07-21T03:00:00.000Z",
      localDate: "2026-07-21",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
      schemaVersion: 1,
      attemptCount: 0,
      nextAttemptAt: "2026-07-21T03:00:00.000Z",
      lastAttemptAt: null,
      lastErrorCode: null,
      status: "local_only",
      sourceVersion: null,
      kind: "reserved",
      payload: {},
    } as never);

    await prepareOfflineIdentity(db, "10002");
    expect(await db.querySnapshots.count()).toBe(0);
    expect(await db.pendingCommands.count()).toBe(0);
    expect((await db.metadata.get("active-identity"))?.value).toBe("10002");

    await clearOfflinePrivateData(db);
    expect(await db.querySnapshots.count()).toBe(0);
    expect(await db.metadata.count()).toBe(0);
  });
});
