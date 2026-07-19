// @vitest-environment node

import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import { readSafetyPolicy, saveSafetyPolicy } from "@/offline/safety-policies";
import { prepareOfflineIdentity } from "@/offline/query-snapshots";
import { createOfflineDatabase } from "@/offline/store";

Dexie.dependencies.indexedDB = indexedDB;
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

const databases = new Set<ReturnType<typeof createOfflineDatabase>>();
const policy = {
  schemaVersion: "1.0.0" as const,
  policyId: "019c0000-0000-7000-8000-000000000401",
  trackerKey: "knee-rehab",
  version: 3,
  effectiveFrom: "2026-07-20T00:00:00.000Z",
  createdAt: "2026-07-20T00:00:00.000Z",
  createdBy: "import" as const,
  rules: [
    {
      id: "anonymous-red-condition",
      outcome: "red" as const,
      match: "any" as const,
      conditions: [
        {
          operator: "equals" as const,
          field: "mechanicalSymptoms",
          value: true,
        },
      ],
    },
  ],
  hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

afterEach(async () => {
  await Promise.all([...databases].map((database) => database.delete()));
  databases.clear();
});

describe("P2b-1 private offline safety policy", () => {
  it("persists only an identity-scoped matching policy and clears it on identity change", async () => {
    const database = createOfflineDatabase(
      `ak-tracker-policy-${crypto.randomUUID()}`,
    );
    databases.add(database);
    await prepareOfflineIdentity(database, "10001");
    await saveSafetyPolicy(database, {
      githubUserId: "10001",
      trackerKey: "knee-rehab",
      policy,
      savedAt: "2026-07-20T10:00:00.000Z",
      expiresAt: "2026-08-20T10:00:00.000Z",
    });

    await expect(
      readSafetyPolicy(database, {
        githubUserId: "10001",
        trackerKey: "knee-rehab",
        reference: {
          policyId: policy.policyId,
          version: policy.version,
          hash: policy.hash,
        },
        now: new Date("2026-07-21T00:00:00.000Z"),
      }),
    ).resolves.toEqual(policy);

    await expect(
      readSafetyPolicy(database, {
        githubUserId: "10001",
        trackerKey: "knee-rehab",
        reference: { ...policy, hash: "b".repeat(64) },
      }),
    ).resolves.toBeNull();

    await prepareOfflineIdentity(database, "10002");
    expect(await database.safetyPolicies.count()).toBe(0);
  });
});
