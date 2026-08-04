import { randomUUID } from "node:crypto";

import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schemaVersion } from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import {
  githubSyncOutbox,
  planVersions,
  rehabProfiles,
  trackers,
} from "@/server/db/schema";
import { prepareAiAnalysisContext } from "@/server/integrations/ai/context";
import { createNeonAiAnalysisStore } from "@/server/integrations/ai/repository";
import { createNeonAssistantStore } from "@/server/integrations/assistant/repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!testDatabaseUrl);

integration("P5c rehabilitation assistant Neon persistence", () => {
  const trackerId = randomUUID();
  const trackerKey = `anonymous-${randomUUID()}`;
  const planId = randomUUID();
  const turnId = randomUUID();
  const commandId = randomUUID();
  const owner = randomUUID();
  const jobId = randomUUID();
  const now = new Date("2026-08-04T08:00:00.000Z");

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    const database = getDatabase();
    await database.insert(trackers).values({
      id: trackerId,
      key: trackerKey,
      name: "Anonymous Tracker",
      module: "anonymous",
      startedOn: "2026-07-01",
      planningTimeZone: "Asia/Shanghai",
    });
    await database.insert(planVersions).values({
      id: planId,
      trackerId,
      version: 1,
      effectiveFrom: "2026-07-01",
      document: {
        schemaVersion,
        id: planId,
        trackerKey,
        version: 1,
        effectiveFrom: "2026-07-01",
        createdAt: "2026-07-01T00:00:00.000Z",
        createdBy: "import",
        tasks: [],
      },
    });
  });

  afterAll(async () => {
    if (!testDatabaseUrl) return;
    const database = getDatabase();
    await database
      .delete(githubSyncOutbox)
      .where(inArray(githubSyncOutbox.aggregateId, [jobId]));
    await database.delete(trackers).where(eq(trackers.id, trackerId));
  });

  it("versions profiles, persists safe memory, and binds v3 advice to one source turn", async () => {
    const database = getDatabase();
    const assistant = createNeonAssistantStore(database);
    const firstProfile = {
      schemaVersion,
      goals: ["Anonymous stable goal"],
      background: [],
      clinicianGuidance: [],
      hardConstraints: [],
      trainingPreferences: [],
    };
    const secondProfile = {
      ...firstProfile,
      trainingPreferences: ["Anonymous stable preference"],
    };
    await assistant.saveActiveProfile({
      trackerId,
      document: firstProfile,
      now,
    });
    await assistant.saveActiveProfile({
      trackerId,
      document: secondProfile,
      now: new Date(now.valueOf() + 1_000),
    });
    await assistant.saveActiveProfile({
      trackerId,
      document: firstProfile,
      now: new Date(now.valueOf() + 2_000),
    });
    const profiles = await database
      .select({ version: rehabProfiles.version, status: rehabProfiles.status })
      .from(rehabProfiles)
      .where(eq(rehabProfiles.trackerId, trackerId))
      .orderBy(asc(rehabProfiles.version));
    expect(profiles).toEqual([
      { version: 1, status: "superseded" },
      { version: 2, status: "superseded" },
      { version: 3, status: "active" },
    ]);

    await assistant.createTurn({
      trackerId,
      id: turnId,
      commandId,
      message: "Anonymous source conversation",
      association: { kind: "auto" },
      createdAt: now,
    });
    expect(
      await assistant.claimTurn({
        trackerId,
        turnId,
        owner,
        claimedAt: now,
        expiresAt: new Date(now.valueOf() + 60_000),
      }),
    ).toBe(true);
    await assistant.completeTurn({
      trackerId,
      turnId,
      owner,
      response: {
        reply: "Anonymous structured reply",
        followUpQuestions: [],
        feedbackDraft: null,
        planReview: "suggested",
        memoryActions: [
          {
            type: "remember",
            category: "equipment",
            content: "Anonymous available equipment",
          },
        ],
        evidenceReferences: [],
      },
      provider: "deepseek",
      model: "anonymous-model",
      contextVersion: "3",
      contextHash: "a".repeat(64),
      contextRevision: 1,
      completedAt: new Date(now.valueOf() + 3_000),
      memoryActions: [
        {
          type: "remember",
          category: "equipment",
          content: "Anonymous available equipment",
        },
      ],
    });

    const beforeStaleCompletion = await assistant.loadConversation(trackerKey);
    const [trackerBeforeStaleCompletion] = await database
      .select({ aiContextRevision: trackers.aiContextRevision })
      .from(trackers)
      .where(eq(trackers.id, trackerId))
      .limit(1);
    await assistant.completeTurn({
      trackerId,
      turnId,
      owner: randomUUID(),
      response: {
        reply: "Stale worker reply",
        followUpQuestions: [],
        feedbackDraft: null,
        planReview: "not_needed",
        memoryActions: [],
        evidenceReferences: [],
      },
      provider: "deepseek",
      model: "anonymous-model",
      contextVersion: "3",
      contextHash: "b".repeat(64),
      contextRevision: 2,
      completedAt: new Date(now.valueOf() + 3_500),
      memoryActions: [
        {
          type: "remember",
          category: "equipment",
          content: "Stale worker must not persist this",
        },
      ],
    });
    const afterStaleCompletion = await assistant.loadConversation(trackerKey);
    const [trackerAfterStaleCompletion] = await database
      .select({ aiContextRevision: trackers.aiContextRevision })
      .from(trackers)
      .where(eq(trackers.id, trackerId))
      .limit(1);
    expect(afterStaleCompletion.memories).toEqual(
      beforeStaleCompletion.memories,
    );
    expect(trackerAfterStaleCompletion.aiContextRevision).toBe(
      trackerBeforeStaleCompletion.aiContextRevision,
    );

    const context = await prepareAiAnalysisContext({
      trackerKey,
      now,
      database,
      sourceAssistantTurnId: turnId,
    });
    expect(context).toMatchObject({
      contextVersion: "3",
      sourceAssistantTurnId: turnId,
      modelContext: {
        rehabProfile: { version: 3 },
        assistantMemories: [
          {
            category: "equipment",
            content: "Anonymous available equipment",
          },
        ],
        sourceConversation: {
          userMessage: "Anonymous source conversation",
          assistantReply: "Anonymous structured reply",
        },
      },
    });

    const job = await createNeonAiAnalysisStore(database).createJob({
      ...context,
      id: jobId,
      provider: "deepseek",
      model: "anonymous-model",
      requestedAt: now,
    });
    expect(job.sourceAssistantTurnId).toBe(turnId);

    const conversation = await assistant.loadConversation(trackerKey);
    const memory = conversation.memories.find(
      (item) => item.status === "active",
    );
    expect(memory).toBeDefined();
    await assistant.updateMemory({
      trackerId,
      memoryId: memory!.id,
      category: "equipment",
      content: "Anonymous updated equipment",
      now: new Date(now.valueOf() + 4_000),
    });
    const changed = await prepareAiAnalysisContext({
      trackerKey,
      now,
      database,
      sourceAssistantTurnId: turnId,
    });
    expect(changed.contextHash).not.toBe(context.contextHash);
  }, 45_000);
});
