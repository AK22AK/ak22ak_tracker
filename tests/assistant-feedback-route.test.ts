import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthorizedSession, getAssistantStore, executeAppendEventCommand } =
  vi.hoisted(() => ({
    getAuthorizedSession: vi.fn(),
    getAssistantStore: vi.fn(),
    executeAppendEventCommand: vi.fn(),
  }));

vi.mock("@/server/auth/session", () => ({ getAuthorizedSession }));
vi.mock("@/server/integrations/assistant/repository", () => ({
  getAssistantStore,
}));
vi.mock("@/server/commands/event-command-core", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/commands/event-command-core")
  >()),
  executeAppendEventCommand,
}));
vi.mock("@/server/commands/event-command", () => ({
  createNeonEventCommandStore: vi.fn(),
}));

import { PUT } from "@/app/api/trackers/[trackerKey]/assistant/turns/[turnId]/feedback/route";

const turnId = "019c0000-0000-7000-8000-000000000051";
const commandId = "019c0000-0000-7000-8000-000000000052";

describe("assistant feedback confirmation route", () => {
  beforeEach(() => {
    getAuthorizedSession.mockResolvedValue({ user: { id: "1" } });
    executeAppendEventCommand.mockReset();
    getAssistantStore.mockReturnValue({
      requireTracker: vi.fn(async () => ({
        id: "019c0000-0000-7000-8000-000000000053",
        key: "knee-rehab",
        planningTimeZone: "Asia/Shanghai",
      })),
      findTurn: vi.fn(async () => ({
        id: turnId,
        status: "succeeded",
        response: { feedbackDraft: { localDate: "2099-01-01" } },
      })),
    });
  });

  it("rejects a future date at the authenticated server boundary before creating an event", async () => {
    const response = await PUT(
      new Request("https://anonymous.invalid/feedback", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commandId,
          turnId,
          occurredAt: "2099-01-01T04:00:00.000Z",
          occurredTimeZone: "Asia/Shanghai",
          occurredUtcOffsetMinutes: 480,
          feedback: {
            localDate: "2099-01-01",
            timing: "morning",
            leftPain: 0,
            rightPain: 0,
            swelling: "none",
            stiffness: false,
            mechanicalSymptoms: false,
            weightBearingIssue: false,
            localizedBonePain: false,
            nightOrRestPain: false,
            note: "匿名未来反馈",
          },
        }),
      }),
      { params: Promise.resolve({ trackerKey: "knee-rehab", turnId }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "future_date_not_allowed" });
    expect(executeAppendEventCommand).not.toHaveBeenCalled();
  });
});
