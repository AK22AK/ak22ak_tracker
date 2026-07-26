import { describe, expect, it } from "vitest";

import {
  buildEvaluationEvidenceSnapshot,
  deriveEvaluationTargetDate,
  evaluationSessionSnapshotSchema,
} from "@/domain/evaluation";
import { schemaVersion, type PlanVersion } from "@/domain/schemas";

const plan: PlanVersion = {
  schemaVersion,
  id: "019c0000-0000-7000-8000-000000000801",
  trackerKey: "anonymous-tracker",
  version: 2,
  effectiveFrom: "2026-06-01",
  createdAt: "2026-06-01T00:00:00.000Z",
  createdBy: "user",
  tasks: [
    {
      id: "first-task",
      title: "Anonymous first task",
      scheduledDate: "2026-06-01",
      sortOrder: 0,
      category: "general",
      prescription: {},
    },
    {
      id: "last-task",
      title: "Anonymous last task",
      scheduledDate: "2026-06-09",
      sortOrder: 1,
      category: "general",
      prescription: {},
    },
  ],
};

describe("P4c-1 evaluation evidence domain", () => {
  it("derives the auditable final target from the timeline head's last task", () => {
    expect(deriveEvaluationTargetDate(plan)).toBe("2026-06-09");
    expect(deriveEvaluationTargetDate({ ...plan, tasks: [] })).toBeNull();
  });

  it("freezes weekly raw evidence without inventing an effective-week threshold", () => {
    const historicalPlan: PlanVersion = {
      ...plan,
      id: "019c0000-0000-7000-8000-000000000805",
      version: 1,
      effectiveFrom: "2026-05-01",
      createdAt: "2026-05-01T00:00:00.000Z",
    };
    const snapshot = buildEvaluationEvidenceSnapshot({
      id: "019c0000-0000-7000-8000-000000000802",
      trackerKey: "anonymous-tracker",
      kind: "final",
      triggerDate: "2026-06-09",
      trackerStartedOn: "2026-06-01",
      planningTimeZone: "Asia/Shanghai",
      createdAt: "2026-06-09T08:00:00.000Z",
      basePlanVersion: plan,
      timelineHeadPlanVersion: plan,
      planVersions: [historicalPlan, plan],
      tasks: [
        {
          id: "019c0000-0000-7000-8000-000000000806",
          localDate: "2026-06-01",
          planVersionId: historicalPlan.id,
          status: "completed",
          confirmedByUser: true,
          durationMeasured: true,
          distanceMeasured: true,
          sourceMeasured: true,
        },
        {
          id: "019c0000-0000-7000-8000-000000000803",
          localDate: "2026-06-01",
          planVersionId: plan.id,
          status: "completed",
          confirmedByUser: true,
          durationMeasured: true,
          distanceMeasured: false,
          sourceMeasured: false,
        },
        {
          id: "019c0000-0000-7000-8000-000000000804",
          localDate: "2026-06-09",
          planVersionId: plan.id,
          status: "skipped",
          confirmedByUser: true,
          durationMeasured: false,
          distanceMeasured: false,
          sourceMeasured: false,
        },
      ],
      feedbacks: [
        {
          localDate: "2026-06-02",
          leftPain: 2,
          rightPain: 1,
          safetyLevel: "green",
        },
        {
          localDate: "2026-06-02",
          leftPain: 5,
          rightPain: 3,
          safetyLevel: "yellow",
        },
      ],
      pauses: [{ startDate: "2026-06-03", endDate: "2026-06-04" }],
      contexts: [
        {
          kind: "travel",
          startDate: "2026-06-05",
          endDate: "2026-06-06",
        },
        {
          kind: "equipment_limited",
          startDate: "2026-06-08",
          endDate: "2026-06-08",
        },
      ],
      degradedDates: ["2026-06-05"],
    });

    expect(snapshot.targetDate).toBe("2026-06-09");
    expect(snapshot.evidenceRange).toEqual({
      from: "2026-06-01",
      through: "2026-06-09",
    });
    expect(snapshot.effectiveness).toEqual({
      status: "needs_policy",
      policyVersion: null,
    });
    expect(snapshot.weeks).toHaveLength(2);
    expect(snapshot.weeks[0]).toMatchObject({
      weekStart: "2026-06-01",
      weekEnd: "2026-06-07",
      tasks: { total: 1, completed: 1, skipped: 0, planned: 0 },
      feedback: {
        feedbackDays: 1,
        expectedDays: 7,
        maxPain: 5,
        worstSafetyLevel: "yellow",
      },
      execution: {
        pauseDays: 2,
        travelDays: 2,
        equipmentLimitedDays: 0,
        degradedDays: 1,
      },
      loadCoverage: {
        completedTasks: 1,
        durationCoveredTasks: 1,
        distanceCoveredTasks: 0,
        sourceCoveredTasks: 0,
      },
      effectiveness: { status: "needs_policy", policyVersion: null },
    });
    expect(snapshot.weeks[1]).toMatchObject({
      weekStart: "2026-06-08",
      weekEnd: "2026-06-14",
      tasks: { total: 1, completed: 0, skipped: 1, planned: 0 },
      feedback: { expectedDays: 2, maxPain: null },
      execution: { equipmentLimitedDays: 1 },
    });
    expect(
      evaluationSessionSnapshotSchema.safeParse({
        ...snapshot,
        feedbackNote: "must not be mirrored",
      }).success,
    ).toBe(false);
  });
});
