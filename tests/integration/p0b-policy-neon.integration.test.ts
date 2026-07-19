import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  evaluateSafetyPolicy,
  safetyPolicyReference,
  type TrackerSafetyPolicyDocument,
} from "@/domain/safety-policy";
import { schemaVersion } from "@/domain/schemas";
import { getTodayAggregate } from "@/server/aggregates/tracker";
import { createNeonEventCommandStore } from "@/server/commands/event-command";
import { executeAppendEventCommand } from "@/server/commands/event-command-core";
import { getDatabase } from "@/server/db/client";
import {
  events,
  githubSyncOutbox,
  trackerSafetyPolicies,
  trackers,
} from "@/server/db/schema";
import { hashSafetyPolicy } from "@/server/safety-policy/hash";
import { getEffectiveTrackerSafetyPolicy } from "@/server/safety-policy/repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

function anonymousPolicy(
  trackerKey: string,
  version: number,
  effectiveFrom: string,
): TrackerSafetyPolicyDocument {
  return {
    schemaVersion,
    policyId: randomUUID(),
    trackerKey,
    version,
    effectiveFrom,
    createdAt: effectiveFrom,
    createdBy: "import",
    rules: [
      {
        id: `anonymous-warning-v${version}`,
        outcome: "yellow",
        match: "all",
        conditions: [
          { operator: "number_gte", field: "score", value: version + 2 },
        ],
      },
    ],
  };
}

integration("P0b TrackerSafetyPolicy integration", () => {
  const trackerId = randomUUID();
  const trackerKey = `anonymous-policy-${randomUUID()}`;
  const commandId = randomUUID();
  const first = anonymousPolicy(trackerKey, 1, "2026-07-18T00:00:00.000Z");
  const second = anonymousPolicy(trackerKey, 2, "2026-07-20T00:00:00.000Z");

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const database = getDatabase();
    await database.insert(trackers).values({
      id: trackerId,
      key: trackerKey,
      name: "Anonymous Policy Tracker",
      module: "anonymous",
      startedOn: "2026-07-18",
      planningTimeZone: "Asia/Shanghai",
    });
    await database.insert(trackerSafetyPolicies).values(
      [first, second].map((document) => ({
        id: document.policyId,
        trackerId,
        version: document.version,
        effectiveFrom: new Date(document.effectiveFrom),
        hash: hashSafetyPolicy(document),
        document,
        createdAt: new Date(document.createdAt),
      })),
    );
  });

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    await getDatabase().delete(trackers).where(eq(trackers.id, trackerId));
  });

  it("resolves the immutable version effective at the target instant", async () => {
    await expect(
      getEffectiveTrackerSafetyPolicy(
        trackerKey,
        new Date("2026-07-19T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ policyId: first.policyId, version: 1 });
    await expect(
      getEffectiveTrackerSafetyPolicy(
        trackerKey,
        new Date("2026-07-20T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ policyId: second.policyId, version: 2 });
  });

  it("returns the effective private policy through the aggregate DTO", async () => {
    const aggregate = await getTodayAggregate(trackerKey, "2026-07-19");
    expect(aggregate.safetyPolicy).toMatchObject({
      policyId: first.policyId,
      version: 1,
      hash: hashSafetyPolicy(first),
    });
    expect(aggregate.safetyPolicy.rules).toHaveLength(1);
  });

  it("records the exact server policy reference in the event and outbox", async () => {
    const policy = await getEffectiveTrackerSafetyPolicy(
      trackerKey,
      new Date("2026-07-19T12:00:00.000Z"),
    );
    const input = { score: 3 };
    const result = await executeAppendEventCommand(
      createNeonEventCommandStore(),
      {
        commandId,
        trackerKey,
        kind: "symptom_check_in",
        payload: {
          ...input,
          safetyLevel: evaluateSafetyPolicy(input, policy.rules),
          safetyPolicy: safetyPolicyReference(policy),
        },
        occurredAt: "2026-07-19T12:00:00.000Z",
        occurredTimeZone: "Asia/Shanghai",
        occurredUtcOffsetMinutes: 480,
      },
    );
    const [event] = await getDatabase()
      .select({ document: events.document })
      .from(events)
      .where(eq(events.id, commandId));
    const [outbox] = await getDatabase()
      .select({ payload: githubSyncOutbox.payload })
      .from(githubSyncOutbox)
      .where(eq(githubSyncOutbox.aggregateId, commandId));

    expect(result.event.payload.safetyPolicy).toEqual(
      safetyPolicyReference(policy),
    );
    expect(event?.document.payload.safetyPolicy).toEqual(
      safetyPolicyReference(policy),
    );
    expect((outbox?.payload as { payload?: unknown }).payload).toMatchObject({
      safetyPolicy: safetyPolicyReference(policy),
    });
  });
});
