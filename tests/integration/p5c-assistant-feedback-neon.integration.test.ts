import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schemaVersion } from "@/domain/schemas";
import { executeAssistantFeedbackCommand } from "@/server/commands/assistant-feedback-core";
import { createNeonAssistantFeedbackCommandStore } from "@/server/commands/assistant-feedback";
import { getDatabase } from "@/server/db/client";
import {
  assistantTurns,
  events,
  githubSyncOutbox,
  trackers,
} from "@/server/db/schema";
import { createNeonAssistantStore } from "@/server/integrations/assistant/repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("P5c assistant feedback canonical Neon command", () => {
  const trackerId = randomUUID();
  const trackerKey = `anonymous-assistant-feedback-${randomUUID()}`;
  const commandIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await getDatabase().insert(trackers).values({
      id: trackerId,
      key: trackerKey,
      name: "Anonymous assistant feedback tracker",
      module: "anonymous",
      startedOn: "2026-08-01",
      planningTimeZone: "Asia/Shanghai",
    });
  }, 45_000);

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    const database = getDatabase();
    if (commandIds.length > 0) {
      await database
        .delete(githubSyncOutbox)
        .where(inArray(githubSyncOutbox.aggregateId, commandIds));
    }
    await database.delete(trackers).where(eq(trackers.id, trackerId));
  }, 45_000);

  async function createSucceededTurn() {
    const assistant = createNeonAssistantStore();
    const turnId = randomUUID();
    const owner = randomUUID();
    const now = new Date("2026-08-04T08:00:00.000Z");
    await assistant.createTurn({
      trackerId,
      id: turnId,
      commandId: randomUUID(),
      message: "Anonymous feedback source",
      association: { kind: "date", localDate: "2026-08-03" },
      createdAt: now,
    });
    await assistant.claimTurn({
      trackerId,
      turnId,
      owner,
      claimedAt: now,
      expiresAt: new Date(now.valueOf() + 60_000),
    });
    await assistant.completeTurn({
      trackerId,
      turnId,
      owner,
      response: {
        reply: "Anonymous reply",
        followUpQuestions: [],
        feedbackDraft: {
          localDate: "2026-08-03",
          timing: "post_training",
          leftPain: 1,
          rightPain: 2,
          swelling: "mild",
          stiffness: true,
          mechanicalSymptoms: false,
          weightBearingIssue: false,
          localizedBonePain: false,
          nightOrRestPain: false,
          note: "Anonymous feedback",
          association: { kind: "date", localDate: "2026-08-03" },
        },
        planReview: "not_needed",
        memoryActions: [],
        evidenceReferences: [],
      },
      provider: "deepseek",
      model: "anonymous-model",
      contextVersion: "3",
      contextHash: "a".repeat(64),
      contextRevision: 1,
      completedAt: new Date(now.valueOf() + 1_000),
      memoryActions: [],
    });
    return turnId;
  }

  function command(turnId: string, commandId: string) {
    return {
      trackerKey,
      turnId,
      commandId,
      occurredAt: "2026-08-03T04:00:00.000Z",
      occurredTimeZone: "Asia/Shanghai",
      occurredUtcOffsetMinutes: 480,
      payload: {
        localDate: "2026-08-03",
        timing: "post_training",
        leftPain: 1,
        rightPain: 2,
        swelling: "mild",
        stiffness: true,
        mechanicalSymptoms: false,
        weightBearingIssue: false,
        localizedBonePain: false,
        nightOrRestPain: false,
        note: "Anonymous feedback",
        safetyLevel: "yellow",
        safetyPolicy: {
          policyId: randomUUID(),
          version: 1,
          hash: "b".repeat(64),
        },
      },
    };
  }

  it("commits one canonical event/outbox/pointer under different command ids and replays it stably", async () => {
    const turnId = await createSucceededTurn();
    const firstCommandId = randomUUID();
    const secondCommandId = randomUUID();
    commandIds.push(firstCommandId, secondCommandId);
    const firstInput = command(turnId, firstCommandId);
    const secondInput = {
      ...command(turnId, secondCommandId),
      payload: firstInput.payload,
    };
    const store = createNeonAssistantFeedbackCommandStore();

    const results = await Promise.all([
      executeAssistantFeedbackCommand(store, firstInput),
      executeAssistantFeedbackCommand(store, secondInput),
    ]);
    expect(new Set(results.map((result) => result.event.id)).size).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    const canonicalId = results[0].event.id;

    const replay = await executeAssistantFeedbackCommand(
      store,
      canonicalId === firstCommandId ? firstInput : secondInput,
    );
    expect(replay).toMatchObject({
      event: { id: canonicalId },
      replayed: true,
    });
    const database = getDatabase();
    const [eventRows, outboxRows, turnRows] = await Promise.all([
      database
        .select({ id: events.id })
        .from(events)
        .where(inArray(events.id, [firstCommandId, secondCommandId])),
      database
        .select({ aggregateId: githubSyncOutbox.aggregateId })
        .from(githubSyncOutbox)
        .where(
          and(
            eq(githubSyncOutbox.aggregateType, "event"),
            inArray(githubSyncOutbox.aggregateId, [
              firstCommandId,
              secondCommandId,
            ]),
          ),
        ),
      database
        .select({ confirmedFeedbackId: assistantTurns.confirmedFeedbackId })
        .from(assistantTurns)
        .where(eq(assistantTurns.id, turnId)),
    ]);
    expect(eventRows).toEqual([{ id: canonicalId }]);
    expect(outboxRows).toEqual([{ aggregateId: canonicalId }]);
    expect(turnRows).toEqual([{ confirmedFeedbackId: canonicalId }]);
  }, 45_000);

  it("rolls back the event and turn pointer when the final outbox insert conflicts", async () => {
    const turnId = await createSucceededTurn();
    const commandId = randomUUID();
    commandIds.push(commandId);
    const database = getDatabase();
    await database.insert(githubSyncOutbox).values({
      aggregateType: "event",
      aggregateId: commandId,
      targetPath: `trackers/${trackerKey}/conflict/${commandId}.json`,
      payload: { schemaVersion, anonymous: true },
    });

    await expect(
      executeAssistantFeedbackCommand(
        createNeonAssistantFeedbackCommandStore(),
        command(turnId, commandId),
      ),
    ).rejects.toBeDefined();
    const [eventRows, turnRows] = await Promise.all([
      database
        .select({ id: events.id })
        .from(events)
        .where(eq(events.id, commandId)),
      database
        .select({ confirmedFeedbackId: assistantTurns.confirmedFeedbackId })
        .from(assistantTurns)
        .where(eq(assistantTurns.id, turnId)),
    ]);
    expect(eventRows).toHaveLength(0);
    expect(turnRows).toEqual([{ confirmedFeedbackId: null }]);
  }, 45_000);
});
