import { describe, expect, it, vi } from "vitest";

import type { TaskActual } from "@/domain/schemas";
import {
  CommandConflictError,
  executeTaskCommand,
  type PreparedTaskCommand,
  type TaskCommandStore,
} from "@/server/commands/task-command-core";

const taskActual: TaskActual = {
  kind: "general",
  exercises: [],
  durationMinutes: null,
  distanceKm: null,
  summary: "anonymous training",
};

function input(status: "planned" | "completed" | "skipped" = "completed") {
  return {
    commandId: "019c0000-0000-7000-8000-000000000001",
    taskId: "019c0000-0000-7000-8000-000000000002",
    status,
    actual: taskActual,
    note: "anonymous note",
    occurredAt: "2026-07-18T16:00:00.000Z",
    occurredTimeZone: "America/Los_Angeles",
    occurredUtcOffsetMinutes: -420,
  } as const;
}

function createStore() {
  let committed: PreparedTaskCommand | null = null;
  const store: TaskCommandStore = {
    findTask: vi.fn(async () => ({
      id: input().taskId,
      trackerId: "019c0000-0000-7000-8000-000000000003",
      trackerKey: "example-tracker",
      planningTimeZone: "Asia/Shanghai",
    })),
    findEventByCommandId: vi.fn(async () => committed?.event ?? null),
    commitAtomically: vi.fn(async (command) => {
      committed = command;
    }),
  };
  return store;
}

describe("task command boundary (P0-02/P0-03)", () => {
  it("prepares task projection, event and outbox as one atomic commit", async () => {
    const store = createStore();
    const result = await executeTaskCommand(store, input());

    expect(store.commitAtomically).toHaveBeenCalledOnce();
    const prepared = vi.mocked(store.commitAtomically).mock.calls[0]?.[0];
    expect(prepared?.taskUpdate.status).toBe("completed");
    expect(prepared?.event.localDate).toBe("2026-07-19");
    expect(prepared?.event.occurredTimeZone).toBe("America/Los_Angeles");
    expect(prepared?.outbox.targetPath).toContain(prepared?.event.id);
    expect(result).toMatchObject({ status: "completed", replayed: false });
  });

  it("returns the canonical result without committing a duplicate command", async () => {
    const store = createStore();
    await executeTaskCommand(store, input());
    await executeTaskCommand(store, input());
    expect(store.commitAtomically).toHaveBeenCalledOnce();
  });

  it("rejects reuse of the same command id with different content", async () => {
    const store = createStore();
    await executeTaskCommand(store, input());
    await expect(
      executeTaskCommand(store, input("skipped")),
    ).rejects.toBeInstanceOf(CommandConflictError);
  });
});
