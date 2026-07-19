import { describe, expect, it } from "vitest";

import {
  buildShiftedPlanVersion,
  inclusiveLocalDateCount,
  shiftLocalDate,
  type ResumptionAssessmentSnapshot,
} from "@/domain/resumption";
import { schemaVersion, type PlanVersion } from "@/domain/schemas";

const basePlan: PlanVersion = {
  schemaVersion,
  id: "019c0000-0000-7000-8000-000000000101",
  trackerKey: "anonymous-tracker",
  version: 3,
  effectiveFrom: "2026-07-01",
  createdAt: "2026-07-01T00:00:00.000Z",
  createdBy: "import",
  tasks: [
    {
      id: "historical-task",
      title: "Historical task",
      scheduledDate: "2026-07-19",
      sortOrder: 0,
      category: "general",
      prescription: {},
    },
    {
      id: "future-planned-task",
      title: "Future planned task",
      scheduledDate: "2026-07-23",
      sortOrder: 1,
      category: "general",
      prescription: { anonymous: true },
    },
    {
      id: "future-completed-task",
      title: "Future completed task",
      scheduledDate: "2026-07-24",
      sortOrder: 2,
      category: "general",
      prescription: {},
    },
  ],
};

const snapshot: ResumptionAssessmentSnapshot = {
  schemaVersion,
  id: "019c0000-0000-7000-8000-000000000102",
  trackerKey: "anonymous-tracker",
  trigger: {
    type: "pause",
    id: "019c0000-0000-7000-8000-000000000103",
    startDate: "2026-07-20",
    endDate: "2026-07-22",
    interruptionDays: 3,
    pausedDays: 3,
    restrictedDays: 0,
  },
  basePlanVersion: {
    id: basePlan.id,
    version: basePlan.version,
    effectiveFrom: basePlan.effectiveFrom,
  },
  planningTimeZone: "Asia/Shanghai",
  createdAt: "2026-07-22T08:00:00.000Z",
  recommendedEffectiveFrom: "2026-07-23",
  shiftDays: 3,
  lastConfirmedTraining: null,
  futureTasks: [
    {
      taskInstanceId: "019c0000-0000-7000-8000-000000000104",
      taskDefinitionId: "future-planned-task",
      title: "Future planned task",
      category: "general",
      scheduledOn: "2026-07-23",
      status: "planned",
    },
  ],
  shiftPreview: [
    {
      taskDefinitionId: "future-planned-task",
      title: "Future planned task",
      from: "2026-07-23",
      to: "2026-07-26",
    },
  ],
};

describe("resumption plan helpers", () => {
  it("uses calendar dates without leaking the runtime time zone", () => {
    expect(shiftLocalDate("2026-07-31", 1)).toBe("2026-08-01");
    expect(inclusiveLocalDateCount("2026-07-20", "2026-07-22")).toBe(3);
  });

  it("shifts only the explicitly previewed unfinished tasks", () => {
    const shifted = buildShiftedPlanVersion(basePlan, snapshot, {
      id: "019c0000-0000-7000-8000-000000000105",
      version: 4,
      createdAt: "2026-07-22T08:05:00.000Z",
    });

    expect(shifted).toMatchObject({
      id: "019c0000-0000-7000-8000-000000000105",
      version: 4,
      effectiveFrom: "2026-07-23",
      createdBy: "user",
    });
    expect(shifted.tasks).toEqual([
      expect.objectContaining({
        id: "historical-task",
        scheduledDate: "2026-07-19",
      }),
      expect.objectContaining({
        id: "future-planned-task",
        scheduledDate: "2026-07-26",
        prescription: { anonymous: true },
      }),
      expect.objectContaining({
        id: "future-completed-task",
        scheduledDate: "2026-07-24",
      }),
    ]);
    expect(basePlan.tasks[1]?.scheduledDate).toBe("2026-07-23");
  });
});
