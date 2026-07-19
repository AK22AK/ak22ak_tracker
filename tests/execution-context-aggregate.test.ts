import { describe, expect, it, vi } from "vitest";

import { getExecutionContextToday } from "@/server/execution-context/aggregate-core";

const contextId = "019c0000-0000-7000-8000-000000000001";
const optionId = "019c0000-0000-7000-8000-000000000002";

function store(overrides: Record<string, unknown> = {}) {
  return {
    findRelevantPause: vi.fn(async () => null),
    findRelevantContext: vi.fn(async () => ({
      id: contextId,
      kind: "travel" as const,
      startDate: "2026-07-20",
      endDate: "2026-07-24",
    })),
    findDayDecision: vi.fn(async () => ({
      localDate: "2026-07-20",
      conditions: {
        availableMinutes: 25,
        venue: "room" as const,
        equipment: ["chair" as const],
        healthStatus: "normal" as const,
      },
      selection: { optionId, optionVersion: 1 },
      safetyDisposition: "normal" as const,
    })),
    findEffectiveAlternatives: vi.fn(async () => [
      {
        schemaVersion: "1.0.0" as const,
        id: optionId,
        trackerKey: "anonymous-tracker",
        optionKey: "anonymous-option",
        version: 1,
        effectiveFrom: "2026-07-01",
        createdAt: "2026-07-01T00:00:00.000Z",
        kind: "alternative" as const,
        title: "Anonymous alternative",
        summary: "Anonymous private summary",
        estimatedMinutes: { min: 15, max: 25 },
        steps: ["Anonymous step"],
        internalMetadata: "must not leave the server",
      },
    ]),
    ...overrides,
  };
}

describe("execution context aggregate", () => {
  it("returns an authenticated display projection without leaking private document internals", async () => {
    const result = await getExecutionContextToday(store(), "2026-07-20", false);

    expect(result).toMatchObject({
      context: { id: contextId, status: "active" },
      day: { selection: { optionId, optionVersion: 1 } },
      alternatives: [
        {
          id: optionId,
          title: "Anonymous alternative",
          steps: ["Anonymous step"],
        },
      ],
      safety: { blocked: false, reason: null },
    });
    expect(result.alternatives[0]).not.toHaveProperty("trackerKey");
    expect(result.alternatives[0]).not.toHaveProperty("internalMetadata");
  });

  it("returns an upcoming context without exposing day choices before its date range", async () => {
    const dataStore = store();
    const result = await getExecutionContextToday(
      dataStore,
      "2026-07-19",
      false,
    );

    expect(result).toMatchObject({
      context: { status: "upcoming", startDate: "2026-07-20" },
      day: null,
      alternatives: [],
    });
    expect(dataStore.findDayDecision).not.toHaveBeenCalled();
  });

  it("blocks alternatives when red feedback or a stored illness/acute condition exists", async () => {
    const redResult = await getExecutionContextToday(
      store(),
      "2026-07-20",
      true,
    );
    expect(redResult).toMatchObject({
      alternatives: [],
      safety: { blocked: true, reason: "red_feedback" },
    });

    const illnessResult = await getExecutionContextToday(
      store({
        findDayDecision: vi.fn(async () => ({
          localDate: "2026-07-20",
          conditions: {
            availableMinutes: 0,
            venue: "none",
            equipment: ["none"],
            healthStatus: "illness",
          },
          selection: null,
          safetyDisposition: "stop_reassess",
        })),
      }),
      "2026-07-20",
      false,
    );
    expect(illnessResult).toMatchObject({
      alternatives: [],
      safety: { blocked: true, reason: "illness" },
    });
  });

  it("gives an active pause priority over a travel context and keeps alternatives hidden", async () => {
    const result = await getExecutionContextToday(
      store({
        findRelevantPause: vi.fn(async () => ({
          id: "019c0000-0000-7000-8000-000000000009",
          reason: "illness",
          note: "Anonymous private note",
          startedOn: "2026-07-20",
          endedOn: null,
        })),
      }),
      "2026-07-20",
      false,
    );

    expect(result).toMatchObject({
      pause: { status: "active", reason: "illness" },
      context: { id: contextId, status: "active" },
      alternatives: [],
      safety: { blocked: true, reason: "pause" },
    });
  });
});
