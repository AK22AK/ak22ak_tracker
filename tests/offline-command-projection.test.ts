import { describe, expect, it } from "vitest";

import type {
  CalendarAggregate,
  DayAggregate,
  TodayAggregate,
} from "@/domain/api-contracts";
import type { PendingCommand } from "@/offline/command-contracts";
import {
  isCommandCountReflectedInDashboard,
  projectCalendarCanonicalCommand,
  projectCalendarPendingCommands,
  projectDayPendingCommands,
  projectTodayPendingCommands,
} from "@/offline/command-projection";

const taskId = "019c0000-0000-7000-8000-000000000311";

function today(): TodayAggregate {
  return {
    tracker: {
      key: "knee-rehab",
      name: "Anonymous Tracker",
      startedOn: "2026-07-01",
      planningTimeZone: "Asia/Shanghai",
    },
    targetDate: "2026-07-20",
    plan: {
      id: "019c0000-0000-7000-8000-000000000312",
      version: 1,
      effectiveFrom: "2026-07-01",
    },
    day: {
      state: "ready",
      trackerName: "Anonymous Tracker",
      startDate: "2026-07-01",
      planVersion: 1,
      tasks: [
        {
          id: taskId,
          title: "Anonymous task",
          category: "general",
          prescription: { main: "Anonymous dose" },
          status: "planned",
          actual: null,
          subjectiveNote: null,
        },
      ],
      feedbackCount: 0,
      feedbacks: [],
      externalTrainingRecords: [],
    },
    safetyPolicy: {
      schemaVersion: "1.0.0",
      policyId: "019c0000-0000-7000-8000-000000000313",
      trackerKey: "knee-rehab",
      version: 1,
      effectiveFrom: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
      createdBy: "import",
      rules: [
        {
          id: "anonymous-rule",
          outcome: "yellow",
          match: "all",
          conditions: [{ operator: "number_gte", field: "leftPain", value: 5 }],
        },
      ],
      hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    execution: {
      context: null,
      day: null,
      alternatives: [],
      safety: { blocked: false, reason: null },
    },
  };
}

function commandBase(id: string, createdAt: string) {
  return {
    id,
    schemaVersion: 1 as const,
    githubUserId: "10001",
    trackerKey: "knee-rehab",
    createdAt,
    occurredAt: createdAt,
    localDate: "2026-07-20",
    occurredTimeZone: "Asia/Shanghai",
    occurredUtcOffsetMinutes: 480,
    attemptCount: 0,
    nextAttemptAt: createdAt,
    lastAttemptAt: null,
    lastErrorCode: null,
    status: "local_only" as const,
    sourceVersion: null,
  };
}

function commands(): PendingCommand[] {
  return [
    {
      ...commandBase(
        "019c0000-0000-7000-8000-000000000314",
        "2026-07-20T10:00:00.000Z",
      ),
      kind: "task_update",
      payload: {
        taskId,
        status: "completed",
        actual: {
          kind: "general",
          exercises: [],
          durationMinutes: null,
          distanceKm: null,
          summary: "Anonymous actual",
        },
        note: "Anonymous note",
        baseStatus: "planned",
        planVersion: 1,
      },
    },
    {
      ...commandBase(
        "019c0000-0000-7000-8000-000000000315",
        "2026-07-20T10:01:00.000Z",
      ),
      kind: "symptom_check_in",
      payload: {
        checkIn: {
          timing: "post_training",
          leftPain: 5,
          rightPain: 0,
          swelling: "none",
          stiffness: false,
          mechanicalSymptoms: false,
          weightBearingIssue: false,
          localizedBonePain: false,
          nightOrRestPain: false,
          note: "Anonymous local feedback",
        },
        clientSafetyPolicy: {
          policyId: "019c0000-0000-7000-8000-000000000313",
          version: 1,
          hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        localSafetyLevel: "yellow",
      },
    },
    {
      ...commandBase(
        "019c0000-0000-7000-8000-000000000316",
        "2026-07-20T10:02:00.000Z",
      ),
      kind: "symptom_check_in",
      payload: {
        checkIn: {
          timing: "incident",
          leftPain: 1,
          rightPain: 1,
          swelling: "none",
          stiffness: false,
          mechanicalSymptoms: false,
          weightBearingIssue: false,
          localizedBonePain: false,
          nightOrRestPain: false,
          note: "Anonymous unclassified feedback",
        },
        clientSafetyPolicy: null,
        localSafetyLevel: null,
      },
    },
  ];
}

describe("P2b-1 deterministic pending command projection", () => {
  it("overlays task and append-only feedback state without mutating the server snapshot", () => {
    const base = today();
    const projected = projectTodayPendingCommands(base, commands());

    expect(base.day.tasks[0]?.status).toBe("planned");
    expect(projected.data.day.tasks[0]).toMatchObject({
      status: "completed",
      subjectiveNote: "Anonymous note",
      actual: { summary: "Anonymous actual" },
    });
    expect(projected.data.day.feedbackCount).toBe(2);
    expect(projected.data.day.feedbacks).toHaveLength(1);
    expect(projected.data.day.feedbacks[0]?.safetyLevel).toBe("yellow");
    expect(projected.pending).toMatchObject({
      localOnly: 3,
      needsAttention: 0,
      unclassifiedFeedback: 1,
    });

    const calendar: CalendarAggregate = {
      trackerKey: "knee-rehab",
      month: "2026-07",
      days: [
        {
          date: "2026-07-20",
          taskCount: 1,
          completedCount: 0,
          skippedCount: 0,
          feedbackCount: 0,
        },
      ],
    };
    expect(
      projectCalendarPendingCommands(calendar, commands()).days[0],
    ).toEqual(
      expect.objectContaining({
        completedCount: 0,
        feedbackCount: 0,
        localPendingCount: 3,
      }),
    );

    const day: DayAggregate = {
      trackerKey: "knee-rehab",
      targetDate: "2026-07-20",
      plan: base.plan,
      day: base.day,
    };
    expect(projectDayPendingCommands(day, commands()).data.day).toEqual(
      projected.data.day,
    );
  });

  it("does not double-count canonical month summaries while a timed-out command remains local", () => {
    const canonical: CalendarAggregate = {
      trackerKey: "knee-rehab",
      month: "2026-07",
      days: [
        {
          date: "2026-07-20",
          taskCount: 1,
          completedCount: 1,
          skippedCount: 0,
          feedbackCount: 1,
        },
      ],
    };

    expect(
      projectCalendarPendingCommands(canonical, commands()).days[0],
    ).toEqual(
      expect.objectContaining({
        completedCount: 1,
        feedbackCount: 1,
        localPendingCount: 3,
      }),
    );

    const taskCommand = commands()[0]!;
    const before = today();
    const after = {
      ...before,
      day: {
        ...before.day,
        tasks: before.day.tasks.map((task) => ({
          ...task,
          status: "completed" as const,
        })),
      },
    };
    expect(isCommandCountReflectedInDashboard(before.day, taskCommand)).toBe(
      false,
    );
    expect(isCommandCountReflectedInDashboard(after.day, taskCommand)).toBe(
      true,
    );
    expect(
      projectCalendarCanonicalCommand(
        {
          ...canonical,
          days: canonical.days.map((day) => ({
            ...day,
            completedCount: 0,
            feedbackCount: 0,
          })),
        },
        taskCommand,
      ).days[0]?.completedCount,
    ).toBe(1);
  });
});
