import { describe, expect, it } from "vitest";

import {
  AssistantFeedbackCommandConflictError,
  executeAssistantFeedbackCommand,
  type AssistantFeedbackCommandStore,
  type PreparedAssistantFeedbackCommand,
} from "@/server/commands/assistant-feedback-core";

const trackerId = "019c0000-0000-7000-8000-000000000061";
const turnId = "019c0000-0000-7000-8000-000000000062";
const firstCommandId = "019c0000-0000-7000-8000-000000000063";
const secondCommandId = "019c0000-0000-7000-8000-000000000064";

function input(commandId: string, note = "匿名反馈") {
  return {
    commandId,
    trackerKey: "knee-rehab",
    turnId,
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
      note,
      safetyLevel: "yellow",
      safetyPolicy: {
        policyId: "019c0000-0000-7000-8000-000000000065",
        version: 1,
        hash: "a".repeat(64),
      },
    },
    occurredAt: "2026-08-03T04:00:00.000Z",
    occurredTimeZone: "Asia/Shanghai",
    occurredUtcOffsetMinutes: 480,
  };
}

function createStore(): AssistantFeedbackCommandStore {
  let canonical: PreparedAssistantFeedbackCommand["event"] | null = null;
  const commands = new Map<string, PreparedAssistantFeedbackCommand["event"]>();
  return {
    findTracker: async () => ({
      id: trackerId,
      key: "knee-rehab",
      planningTimeZone: "Asia/Shanghai",
    }),
    confirmAtomically: async (command) => {
      const commandEvent = commands.get(command.event.idempotencyKey) ?? null;
      if (!canonical && !commandEvent) {
        canonical = command.event;
        commands.set(command.event.idempotencyKey, command.event);
        return {
          canonicalEvent: canonical,
          commandEvent: canonical,
          created: true,
        };
      }
      return { canonicalEvent: canonical, commandEvent, created: false };
    },
  };
}

describe("assistant feedback command", () => {
  it("returns one canonical feedback for stable replays and different concurrent command ids", async () => {
    const store = createStore();
    const first = await executeAssistantFeedbackCommand(
      store,
      input(firstCommandId),
      new Date("2026-08-04T00:00:00.000Z"),
    );
    const replay = await executeAssistantFeedbackCommand(
      store,
      input(firstCommandId),
      new Date("2026-08-04T00:00:01.000Z"),
    );
    const competing = await executeAssistantFeedbackCommand(
      store,
      input(secondCommandId),
      new Date("2026-08-04T00:00:02.000Z"),
    );

    expect(first).toMatchObject({ replayed: false });
    expect(replay).toMatchObject({
      event: { id: first.event.id },
      replayed: true,
    });
    expect(competing).toMatchObject({
      event: { id: first.event.id },
      replayed: true,
    });
  });

  it("rejects changed intent when the same command id is replayed", async () => {
    const store = createStore();
    await executeAssistantFeedbackCommand(store, input(firstCommandId));

    await expect(
      executeAssistantFeedbackCommand(
        store,
        input(firstCommandId, "同一命令被修改"),
      ),
    ).rejects.toBeInstanceOf(AssistantFeedbackCommandConflictError);
  });
});
