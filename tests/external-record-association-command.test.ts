import { describe, expect, it, vi } from "vitest";

import type { TrackerEvent } from "@/domain/schemas";
import {
  AssociationCommandConflictError,
  AssociationSourceVersionConflictError,
  AssociationTargetInvalidError,
  executeExternalRecordAssociationCommand,
  ExternalRecordNotFoundError,
  type ExternalRecordAssociationCommandInput,
  type ExternalRecordAssociationCommandStore,
  type PreparedExternalRecordAssociationCommand,
} from "@/server/commands/external-record-association-core";

const recordId = "019c0000-0000-7000-8000-000000000001";
const trackerId = "019c0000-0000-7000-8000-000000000002";
const firstTaskId = "019c0000-0000-7000-8000-000000000003";
const secondTaskId = "019c0000-0000-7000-8000-000000000004";

function command(
  commandId: string,
  decision: "link" | "unrelated" = "link",
  taskId: string = firstTaskId,
  sourceVersion = 2,
): ExternalRecordAssociationCommandInput {
  return {
    commandId,
    trackerKey: "anonymous-tracker",
    externalRecordId: recordId,
    sourceVersion,
    decision,
    ...(decision === "link" ? { taskId } : {}),
    occurredAt: "2026-07-19T08:00:00.000Z",
    occurredTimeZone: "Asia/Shanghai",
    occurredUtcOffsetMinutes: 480,
  } as ExternalRecordAssociationCommandInput;
}

function createStore() {
  const events = new Map<string, TrackerEvent>();
  let association:
    PreparedExternalRecordAssociationCommand["association"] | null = null;
  const store: ExternalRecordAssociationCommandStore = {
    findRecord: vi.fn(async (trackerKey, requestedRecordId) =>
      trackerKey === "anonymous-tracker" && requestedRecordId === recordId
        ? {
            id: recordId,
            trackerId,
            trackerKey,
            localDate: "2026-07-19",
            planningTimeZone: "Asia/Shanghai",
            provider: "xunji" as const,
            sourceVersion: 2,
          }
        : null,
    ),
    findTaskForRecord: vi.fn(async (_record, taskId) =>
      taskId === firstTaskId || taskId === secondTaskId ? { id: taskId } : null,
    ),
    findEventByCommandId: vi.fn(
      async (commandId) => events.get(commandId) ?? null,
    ),
    commitAtomically: vi.fn(async (prepared) => {
      association = prepared.association;
      events.set(prepared.event.idempotencyKey, prepared.event);
    }),
  };
  return {
    store,
    association: () => association,
  };
}

describe("external record association command", () => {
  it("atomically confirms a task association without preparing any task status update", async () => {
    const { store, association } = createStore();
    const result = await executeExternalRecordAssociationCommand(
      store,
      command("019c0000-0000-7000-8000-000000000010"),
      new Date("2026-07-19T08:00:01.000Z"),
    );

    expect(result).toMatchObject({
      replayed: false,
      recordId,
      association: {
        status: "confirmed",
        taskId: firstTaskId,
        sourceVersion: 2,
        needsReview: false,
      },
    });
    expect(association()).toMatchObject({
      externalRecordId: recordId,
      status: "confirmed",
      taskId: firstTaskId,
    });
    const prepared = vi.mocked(store.commitAtomically).mock.calls[0]?.[0];
    expect(prepared).not.toHaveProperty("taskUpdate");
    expect(prepared?.event.kind).toBe("external_record_link_decision");
    expect(prepared?.outbox.aggregateId).toBe(prepared?.event.id);
  });

  it("replays the same command once and rejects conflicting command reuse", async () => {
    const { store } = createStore();
    const input = command("019c0000-0000-7000-8000-000000000011");
    await executeExternalRecordAssociationCommand(store, input);
    await expect(
      executeExternalRecordAssociationCommand(store, input),
    ).resolves.toMatchObject({ replayed: true });
    expect(store.commitAtomically).toHaveBeenCalledOnce();

    await expect(
      executeExternalRecordAssociationCommand(
        store,
        command("019c0000-0000-7000-8000-000000000011", "link", secondTaskId),
      ),
    ).rejects.toBeInstanceOf(AssociationCommandConflictError);
  });

  it("supports replacing the task and then marking the record unrelated", async () => {
    const { store, association } = createStore();
    await executeExternalRecordAssociationCommand(
      store,
      command("019c0000-0000-7000-8000-000000000012"),
    );
    await executeExternalRecordAssociationCommand(
      store,
      command("019c0000-0000-7000-8000-000000000013", "link", secondTaskId),
    );
    expect(association()).toMatchObject({
      status: "confirmed",
      taskId: secondTaskId,
    });

    await executeExternalRecordAssociationCommand(
      store,
      command("019c0000-0000-7000-8000-000000000014", "unrelated"),
    );
    expect(association()).toMatchObject({
      status: "unrelated",
      taskId: null,
    });
  });

  it("rejects a stale source version before changing the association", async () => {
    const { store } = createStore();
    await expect(
      executeExternalRecordAssociationCommand(
        store,
        command("019c0000-0000-7000-8000-000000000015", "link", firstTaskId, 1),
      ),
    ).rejects.toBeInstanceOf(AssociationSourceVersionConflictError);
    expect(store.commitAtomically).not.toHaveBeenCalled();
  });

  it("rejects cross-tracker records and cross-date or invalid task targets", async () => {
    const { store } = createStore();
    await expect(
      executeExternalRecordAssociationCommand(store, {
        ...command("019c0000-0000-7000-8000-000000000016"),
        trackerKey: "other-tracker",
      }),
    ).rejects.toBeInstanceOf(ExternalRecordNotFoundError);

    await expect(
      executeExternalRecordAssociationCommand(
        store,
        command(
          "019c0000-0000-7000-8000-000000000017",
          "link",
          "019c0000-0000-7000-8000-000000000099",
        ),
      ),
    ).rejects.toBeInstanceOf(AssociationTargetInvalidError);
    expect(store.commitAtomically).not.toHaveBeenCalled();
  });
});
