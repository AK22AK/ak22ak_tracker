import { describe, expect, it, vi } from "vitest";

import type { TrackerEvent } from "@/domain/schemas";
import {
  ExecutionAlternativeVersionConflictError,
  ExecutionContextOverlapError,
  ExecutionContextSafetyBlockedError,
  executeCreateExecutionContextCommand,
  executeEndExecutionContextCommand,
  executeSetExecutionDayCommand,
  type ExecutionContextCommandStore,
  type PreparedExecutionContextCommand,
} from "@/server/commands/execution-context-core";

const trackerId = "019c0000-0000-7000-8000-000000000001";
const contextId = "019c0000-0000-7000-8000-000000000002";
const optionAId = "019c0000-0000-7000-8000-000000000003";
const optionDId = "019c0000-0000-7000-8000-000000000004";

function metadata(commandId: string, occurredAt = "2026-07-19T16:30:00.000Z") {
  return {
    commandId,
    occurredAt,
    occurredTimeZone: "Europe/Paris",
    occurredUtcOffsetMinutes: 120,
  };
}

function createMemoryStore() {
  const events = new Map<string, TrackerEvent>();
  const contexts = new Map<
    string,
    {
      id: string;
      trackerId: string;
      trackerKey: string;
      planningTimeZone: string;
      kind: "travel" | "equipment_limited";
      startDate: string;
      endDate: string;
      endedOn: string | null;
    }
  >();
  const alternatives = new Map([
    [optionAId, { id: optionAId, version: 1, effectiveFrom: "2026-07-01" }],
    [optionDId, { id: optionDId, version: 2, effectiveFrom: "2026-07-01" }],
  ]);
  const decisions = new Map<string, PreparedExecutionContextCommand>();
  let redDate: string | null = null;

  const store: ExecutionContextCommandStore = {
    findTracker: vi.fn(async (key) =>
      key === "anonymous-tracker"
        ? {
            id: trackerId,
            key,
            planningTimeZone: "Asia/Shanghai",
          }
        : null,
    ),
    findEventByCommandId: vi.fn(
      async (commandId) => events.get(commandId) ?? null,
    ),
    findContext: vi.fn(
      async (_trackerId, requestedId) => contexts.get(requestedId) ?? null,
    ),
    findOverlappingContext: vi.fn(
      async (_trackerId, startDate, endDate) =>
        [...contexts.values()].find(
          (context) =>
            context.endedOn === null &&
            context.startDate <= endDate &&
            context.endDate >= startDate,
        ) ?? null,
    ),
    findAlternative: vi.fn(async (_trackerId, optionId, targetDate) => {
      const option = alternatives.get(optionId);
      return option && option.effectiveFrom <= targetDate ? option : null;
    }),
    hasRedSafetySignal: vi.fn(
      async (_trackerId, localDate) => redDate === localDate,
    ),
    commitAtomically: vi.fn(async (prepared) => {
      if (prepared.type === "create") {
        contexts.set(prepared.context.id, prepared.context);
      } else if (prepared.type === "end") {
        const current = contexts.get(prepared.contextId);
        if (current)
          contexts.set(prepared.contextId, {
            ...current,
            endedOn: prepared.endedOn,
          });
      } else {
        decisions.set(`${prepared.contextId}:${prepared.localDate}`, prepared);
      }
      events.set(prepared.event.idempotencyKey, prepared.event);
    }),
  };

  return {
    store,
    contexts,
    decisions,
    setRedDate(value: string | null) {
      redDate = value;
    },
  };
}

describe("execution context commands", () => {
  it("creates a dated context atomically and replays the same command without touching a plan", async () => {
    const { store, contexts } = createMemoryStore();
    const input = {
      ...metadata("019c0000-0000-7000-8000-000000000010"),
      trackerKey: "anonymous-tracker",
      contextId,
      kind: "travel" as const,
      startDate: "2026-07-20",
      endDate: "2026-07-24",
    };

    const first = await executeCreateExecutionContextCommand(store, input);
    const replay = await executeCreateExecutionContextCommand(store, input);

    expect(first).toMatchObject({
      replayed: false,
      context: { id: contextId },
    });
    expect(replay).toMatchObject({
      replayed: true,
      context: { id: contextId },
    });
    expect(contexts.get(contextId)).toMatchObject({
      startDate: "2026-07-20",
      endDate: "2026-07-24",
      endedOn: null,
    });
    expect(store.commitAtomically).toHaveBeenCalledOnce();
    const prepared = vi.mocked(store.commitAtomically).mock.calls[0]?.[0];
    expect(prepared).not.toHaveProperty("planVersion");
    expect(prepared?.event.kind).toBe("execution_context_started");
    expect(prepared?.outbox.aggregateId).toBe(prepared?.event.id);
  });

  it("rejects overlapping open contexts", async () => {
    const { store } = createMemoryStore();
    await executeCreateExecutionContextCommand(store, {
      ...metadata("019c0000-0000-7000-8000-000000000011"),
      trackerKey: "anonymous-tracker",
      contextId,
      kind: "travel",
      startDate: "2026-07-20",
      endDate: "2026-07-24",
    });

    await expect(
      executeCreateExecutionContextCommand(store, {
        ...metadata("019c0000-0000-7000-8000-000000000012"),
        trackerKey: "anonymous-tracker",
        contextId: "019c0000-0000-7000-8000-000000000099",
        kind: "equipment_limited",
        startDate: "2026-07-24",
        endDate: "2026-07-25",
      }),
    ).rejects.toBeInstanceOf(ExecutionContextOverlapError);
  });

  it("stores different private alternatives for different plan dates while keeping Shanghai as the plan date", async () => {
    const { store, decisions } = createMemoryStore();
    await executeCreateExecutionContextCommand(store, {
      ...metadata("019c0000-0000-7000-8000-000000000013"),
      trackerKey: "anonymous-tracker",
      contextId,
      kind: "travel",
      startDate: "2026-07-20",
      endDate: "2026-07-24",
    });

    await executeSetExecutionDayCommand(store, {
      ...metadata(
        "019c0000-0000-7000-8000-000000000014",
        "2026-07-19T16:30:00.000Z",
      ),
      trackerKey: "anonymous-tracker",
      contextId,
      localDate: "2026-07-20",
      conditions: {
        availableMinutes: 35,
        venue: "hotel_gym",
        equipment: ["machines"],
        healthStatus: "normal",
      },
      selection: { optionId: optionAId, optionVersion: 1 },
    });
    await executeSetExecutionDayCommand(store, {
      ...metadata(
        "019c0000-0000-7000-8000-000000000015",
        "2026-07-20T16:30:00.000Z",
      ),
      trackerKey: "anonymous-tracker",
      contextId,
      localDate: "2026-07-21",
      conditions: {
        availableMinutes: 8,
        venue: "none",
        equipment: ["none"],
        healthStatus: "normal",
      },
      selection: { optionId: optionDId, optionVersion: 2 },
    });

    expect(decisions.get(`${contextId}:2026-07-20`)).toMatchObject({
      selection: { optionId: optionAId, optionVersion: 1 },
      safetyDisposition: "normal",
      event: { localDate: "2026-07-20" },
    });
    expect(decisions.get(`${contextId}:2026-07-21`)).toMatchObject({
      selection: { optionId: optionDId, optionVersion: 2 },
      event: { localDate: "2026-07-21" },
    });
  });

  it("replays a saved day canonically even if a red signal appears later, and rejects a device-derived wrong plan date", async () => {
    const { store, setRedDate } = createMemoryStore();
    await executeCreateExecutionContextCommand(store, {
      ...metadata("019c0000-0000-7000-8000-000000000030"),
      trackerKey: "anonymous-tracker",
      contextId,
      kind: "travel",
      startDate: "2026-07-20",
      endDate: "2026-07-24",
    });
    const dayInput = {
      ...metadata(
        "019c0000-0000-7000-8000-000000000031",
        "2026-07-19T16:30:00.000Z",
      ),
      trackerKey: "anonymous-tracker",
      contextId,
      localDate: "2026-07-20",
      conditions: {
        availableMinutes: 20,
        venue: "room" as const,
        equipment: ["chair" as const],
        healthStatus: "normal" as const,
      },
      selection: { optionId: optionAId, optionVersion: 1 },
    };
    await expect(
      executeSetExecutionDayCommand(store, dayInput),
    ).resolves.toMatchObject({
      replayed: false,
    });
    setRedDate("2026-07-20");
    await expect(
      executeSetExecutionDayCommand(store, dayInput),
    ).resolves.toMatchObject({
      replayed: true,
      day: { safetyDisposition: "normal" },
    });

    await expect(
      executeSetExecutionDayCommand(store, {
        ...dayInput,
        commandId: "019c0000-0000-7000-8000-000000000032",
        localDate: "2026-07-19",
      }),
    ).rejects.toThrow("execution_day_not_current_plan_date");
  });

  it("rejects stale alternatives and blocks normal downgrade for red, illness and acute states", async () => {
    const { store, setRedDate } = createMemoryStore();
    await executeCreateExecutionContextCommand(store, {
      ...metadata("019c0000-0000-7000-8000-000000000016"),
      trackerKey: "anonymous-tracker",
      contextId,
      kind: "travel",
      startDate: "2026-07-20",
      endDate: "2026-07-24",
    });
    const base = {
      ...metadata("019c0000-0000-7000-8000-000000000017"),
      trackerKey: "anonymous-tracker",
      contextId,
      localDate: "2026-07-20",
      conditions: {
        availableMinutes: 20,
        venue: "room" as const,
        equipment: ["chair" as const],
        healthStatus: "normal" as const,
      },
      selection: { optionId: optionAId, optionVersion: 999 },
    };

    await expect(
      executeSetExecutionDayCommand(store, base),
    ).rejects.toBeInstanceOf(ExecutionAlternativeVersionConflictError);

    setRedDate("2026-07-20");
    await expect(
      executeSetExecutionDayCommand(store, {
        ...base,
        commandId: "019c0000-0000-7000-8000-000000000018",
        selection: { optionId: optionAId, optionVersion: 1 },
      }),
    ).rejects.toBeInstanceOf(ExecutionContextSafetyBlockedError);

    setRedDate(null);
    await expect(
      executeSetExecutionDayCommand(store, {
        ...base,
        commandId: "019c0000-0000-7000-8000-000000000019",
        conditions: { ...base.conditions, healthStatus: "illness" },
        selection: { optionId: optionAId, optionVersion: 1 },
      }),
    ).rejects.toBeInstanceOf(ExecutionContextSafetyBlockedError);
    await expect(
      executeSetExecutionDayCommand(store, {
        ...base,
        commandId: "019c0000-0000-7000-8000-000000000020",
        conditions: { ...base.conditions, healthStatus: "acute_symptom" },
        selection: { optionId: optionAId, optionVersion: 1 },
      }),
    ).rejects.toBeInstanceOf(ExecutionContextSafetyBlockedError);
  });

  it("ends a context with an auditable idempotent command", async () => {
    const { store, contexts } = createMemoryStore();
    await executeCreateExecutionContextCommand(store, {
      ...metadata("019c0000-0000-7000-8000-000000000021"),
      trackerKey: "anonymous-tracker",
      contextId,
      kind: "travel",
      startDate: "2026-07-20",
      endDate: "2026-07-24",
    });
    const input = {
      ...metadata(
        "019c0000-0000-7000-8000-000000000022",
        "2026-07-21T02:00:00.000Z",
      ),
      trackerKey: "anonymous-tracker",
      contextId,
    };

    const first = await executeEndExecutionContextCommand(store, input);
    const replay = await executeEndExecutionContextCommand(store, input);

    expect(first).toMatchObject({ replayed: false, endedOn: "2026-07-21" });
    expect(replay).toMatchObject({ replayed: true, endedOn: "2026-07-21" });
    expect(contexts.get(contextId)?.endedOn).toBe("2026-07-21");
  });
});
