import { describe, expect, it } from "vitest";

import { suggestGarminActivityTask } from "@/server/integrations/core/task-link-suggestion";

const activity = {
  localDate: "2026-07-24",
  activityType: "running",
};

describe("P3b-2b Garmin activity association suggestions", () => {
  it("suggests one unambiguous same-day task", () => {
    expect(
      suggestGarminActivityTask(activity, [
        {
          id: "019c0000-0000-7000-8000-000000000001",
          title: "Easy run",
          category: "running",
          scheduledOn: "2026-07-24",
          prescription: {},
        },
      ]),
    ).toEqual({
      taskId: "019c0000-0000-7000-8000-000000000001",
      reason: "Garmin 活动类型与计划任务一致",
    });
  });

  it("does not suggest across dates or when multiple tasks are plausible", () => {
    const matching = (id: string, scheduledOn = "2026-07-24") => ({
      id,
      title: "Anonymous run",
      category: "running",
      scheduledOn,
      prescription: {},
    });
    expect(
      suggestGarminActivityTask(activity, [
        matching("019c0000-0000-7000-8000-000000000001", "2026-07-23"),
      ]),
    ).toBeNull();
    expect(
      suggestGarminActivityTask(activity, [
        matching("019c0000-0000-7000-8000-000000000001"),
        matching("019c0000-0000-7000-8000-000000000002"),
      ]),
    ).toBeNull();
  });

  it("does not force a suggestion for an unknown activity type", () => {
    expect(
      suggestGarminActivityTask(
        { ...activity, activityType: "anonymous_provider_type" },
        [
          {
            id: "019c0000-0000-7000-8000-000000000001",
            title: "Anonymous task",
            category: "other",
            scheduledOn: "2026-07-24",
            prescription: {},
          },
        ],
      ),
    ).toBeNull();
  });
});
