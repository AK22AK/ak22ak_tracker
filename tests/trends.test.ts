import { describe, expect, it } from "vitest";

import {
  aggregateEightWeekTrends,
  eightWeekNaturalRange,
  trendsAggregateSchema,
} from "@/domain/trends";

describe("P4a-1 deterministic eight-week trends", () => {
  it("builds eight Monday-first natural weeks across a year boundary", () => {
    expect(eightWeekNaturalRange("2026-01-01")).toEqual({
      start: "2025-11-10",
      end: "2026-01-04",
      currentDate: "2026-01-01",
    });
  });

  it("counts only task instances from the plan version effective on each historical date", () => {
    const result = aggregateEightWeekTrends({
      trackerKey: "knee-rehab",
      trackerStartedOn: "2026-06-01",
      timeZone: "Asia/Shanghai",
      currentDate: "2026-07-22",
      generatedAt: "2026-07-22T04:00:00.000Z",
      planVersions: [
        {
          id: "019c0000-0000-7000-8000-000000000001",
          version: 1,
          effectiveFrom: "2026-06-01",
        },
        {
          id: "019c0000-0000-7000-8000-000000000002",
          version: 2,
          effectiveFrom: "2026-07-15",
        },
      ],
      tasks: [
        {
          id: "historical-completed",
          localDate: "2026-07-13",
          planVersionId: "019c0000-0000-7000-8000-000000000001",
          status: "completed",
          confirmedByUser: true,
          actual: null,
        },
        {
          id: "replaced-completed",
          localDate: "2026-07-16",
          planVersionId: "019c0000-0000-7000-8000-000000000001",
          status: "completed",
          confirmedByUser: true,
          actual: null,
        },
        {
          id: "effective-skipped",
          localDate: "2026-07-16",
          planVersionId: "019c0000-0000-7000-8000-000000000002",
          status: "skipped",
          confirmedByUser: true,
          actual: null,
        },
        {
          id: "current-planned",
          localDate: "2026-07-20",
          planVersionId: "019c0000-0000-7000-8000-000000000002",
          status: "planned",
          confirmedByUser: false,
          actual: null,
        },
      ],
      feedbacks: [],
      externalRecords: [],
    });

    expect(result.weeks.at(-2)?.tasks).toEqual({
      planned: 0,
      completed: 1,
      skipped: 1,
      total: 2,
      completionRate: 0.5,
    });
    expect(result.weeks.at(-1)?.tasks).toEqual({
      planned: 1,
      completed: 0,
      skipped: 0,
      total: 1,
      completionRate: 0,
    });
  });

  it("uses the highest daily bilateral pain and most severe saved safety result", () => {
    const result = aggregateEightWeekTrends({
      trackerKey: "knee-rehab",
      trackerStartedOn: "2026-07-01",
      timeZone: "Asia/Shanghai",
      currentDate: "2026-07-22",
      generatedAt: "2026-07-22T04:00:00.000Z",
      planVersions: [],
      tasks: [],
      feedbacks: [
        {
          localDate: "2026-07-20",
          leftPain: 2,
          rightPain: 5,
          safetyLevel: "green",
        },
        {
          localDate: "2026-07-20",
          leftPain: 7,
          rightPain: 1,
          safetyLevel: "yellow",
        },
        {
          localDate: "2026-07-21",
          leftPain: 1,
          rightPain: 2,
          safetyLevel: "red",
        },
      ],
      externalRecords: [],
    });

    expect(result.weeks.at(-1)?.symptoms).toEqual({
      feedbackDays: 2,
      expectedDays: 3,
      maxPain: 7,
      safetyDays: { green: 0, yellow: 1, red: 1 },
    });
  });

  it("keeps missing feedback distinct from zero pain in a partial current week", () => {
    const result = aggregateEightWeekTrends({
      trackerKey: "knee-rehab",
      trackerStartedOn: "2026-07-21",
      timeZone: "Asia/Shanghai",
      currentDate: "2026-07-22",
      generatedAt: "2026-07-22T04:00:00.000Z",
      planVersions: [],
      tasks: [],
      feedbacks: [],
      externalRecords: [],
    });

    expect(result.weeks.at(-1)).toMatchObject({
      weekStart: "2026-07-20",
      weekEnd: "2026-07-26",
      isCurrentWeek: true,
      symptoms: {
        feedbackDays: 0,
        expectedDays: 2,
        maxPain: null,
        safetyDays: { green: 0, yellow: 0, red: 0 },
      },
    });
    expect(result.weeks).toHaveLength(8);
  });

  it("deduplicates one completed task with manual, Garmin, and Xunji source priority", () => {
    const versionId = "019c0000-0000-7000-8000-000000000001";
    const task = (input: {
      id: string;
      localDate: string;
      actual?: { durationMinutes: number | null; distanceKm: number | null };
    }) => ({
      id: input.id,
      localDate: input.localDate,
      planVersionId: versionId,
      status: "completed" as const,
      confirmedByUser: true,
      actual: input.actual ?? null,
    });
    const record = (input: {
      id: string;
      taskInstanceId: string;
      provider: "garmin" | "xunji";
      localDate: string;
      durationMinutes: number;
      distanceKm?: number | null;
    }) => ({
      ...input,
      distanceKm: input.distanceKm ?? null,
      sourceVersion: 2,
      linkSourceVersion: 2,
      linkStatus: "confirmed" as const,
      needsReview: false,
    });

    const result = aggregateEightWeekTrends({
      trackerKey: "knee-rehab",
      trackerStartedOn: "2026-07-01",
      timeZone: "Asia/Shanghai",
      currentDate: "2026-07-22",
      generatedAt: "2026-07-22T04:00:00.000Z",
      planVersions: [
        { id: versionId, version: 1, effectiveFrom: "2026-07-01" },
      ],
      tasks: [
        task({
          id: "task-manual",
          localDate: "2026-07-20",
          actual: { durationMinutes: 40, distanceKm: 5 },
        }),
        task({ id: "task-garmin", localDate: "2026-07-20" }),
        task({ id: "task-xunji", localDate: "2026-07-21" }),
        task({ id: "task-unmeasured", localDate: "2026-07-21" }),
      ],
      feedbacks: [],
      externalRecords: [
        record({
          id: "manual-garmin",
          taskInstanceId: "task-manual",
          provider: "garmin",
          localDate: "2026-07-20",
          durationMinutes: 99,
          distanceKm: 12,
        }),
        record({
          id: "manual-xunji",
          taskInstanceId: "task-manual",
          provider: "xunji",
          localDate: "2026-07-20",
          durationMinutes: 88,
        }),
        record({
          id: "garmin-a",
          taskInstanceId: "task-garmin",
          provider: "garmin",
          localDate: "2026-07-20",
          durationMinutes: 30,
          distanceKm: 2,
        }),
        record({
          id: "garmin-b",
          taskInstanceId: "task-garmin",
          provider: "garmin",
          localDate: "2026-07-20",
          durationMinutes: 20,
          distanceKm: 3,
        }),
        record({
          id: "garmin-a",
          taskInstanceId: "task-garmin",
          provider: "garmin",
          localDate: "2026-07-20",
          durationMinutes: 30,
          distanceKm: 2,
        }),
        record({
          id: "garmin-xunji",
          taskInstanceId: "task-garmin",
          provider: "xunji",
          localDate: "2026-07-20",
          durationMinutes: 120,
        }),
        record({
          id: "xunji-a",
          taskInstanceId: "task-xunji",
          provider: "xunji",
          localDate: "2026-07-21",
          durationMinutes: 45,
        }),
      ],
    });

    expect(result.weeks.at(-1)?.load).toEqual({
      completedTrainingDays: 2,
      measuredDurationMinutes: 135,
      durationCoveredTasks: 3,
      completedTasks: 4,
      measuredDistanceKm: 10,
      distanceCoveredTasks: 2,
      sourceCoverage: {
        manual: 1,
        garmin: 1,
        xunji: 1,
        fallbackUnmeasured: 1,
      },
    });
  });

  it("excludes unfinished tasks and stale, unrelated, cross-date external records", () => {
    const versionId = "019c0000-0000-7000-8000-000000000001";
    const result = aggregateEightWeekTrends({
      trackerKey: "knee-rehab",
      trackerStartedOn: "2026-07-01",
      timeZone: "Asia/Shanghai",
      currentDate: "2026-07-22",
      generatedAt: "2026-07-22T04:00:00.000Z",
      planVersions: [
        { id: versionId, version: 1, effectiveFrom: "2026-07-01" },
      ],
      tasks: [
        {
          id: "completed",
          localDate: "2026-07-20",
          planVersionId: versionId,
          status: "completed",
          confirmedByUser: true,
          actual: null,
        },
        {
          id: "unconfirmed",
          localDate: "2026-07-20",
          planVersionId: versionId,
          status: "completed",
          confirmedByUser: false,
          actual: { durationMinutes: 10, distanceKm: null },
        },
        {
          id: "planned",
          localDate: "2026-07-20",
          planVersionId: versionId,
          status: "planned",
          confirmedByUser: false,
          actual: { durationMinutes: 10, distanceKm: null },
        },
        {
          id: "skipped",
          localDate: "2026-07-20",
          planVersionId: versionId,
          status: "skipped",
          confirmedByUser: true,
          actual: { durationMinutes: 10, distanceKm: null },
        },
        {
          id: "future-completed",
          localDate: "2026-07-23",
          planVersionId: versionId,
          status: "completed",
          confirmedByUser: true,
          actual: { durationMinutes: 10, distanceKm: null },
        },
      ],
      feedbacks: [],
      externalRecords: [
        {
          id: "suggested",
          taskInstanceId: "completed",
          provider: "garmin",
          localDate: "2026-07-20",
          sourceVersion: 1,
          linkSourceVersion: 1,
          linkStatus: "suggested",
          needsReview: false,
          durationMinutes: 10,
          distanceKm: 1,
        },
        {
          id: "review",
          taskInstanceId: "completed",
          provider: "garmin",
          localDate: "2026-07-20",
          sourceVersion: 1,
          linkSourceVersion: 1,
          linkStatus: "confirmed",
          needsReview: true,
          durationMinutes: 10,
          distanceKm: 1,
        },
        {
          id: "stale",
          taskInstanceId: "completed",
          provider: "garmin",
          localDate: "2026-07-20",
          sourceVersion: 2,
          linkSourceVersion: 1,
          linkStatus: "confirmed",
          needsReview: false,
          durationMinutes: 10,
          distanceKm: 1,
        },
        {
          id: "cross-date",
          taskInstanceId: "completed",
          provider: "xunji",
          localDate: "2026-07-21",
          sourceVersion: 1,
          linkSourceVersion: 1,
          linkStatus: "confirmed",
          needsReview: false,
          durationMinutes: 10,
          distanceKm: null,
        },
      ],
    });

    expect(result.weeks.at(-1)?.load).toEqual({
      completedTrainingDays: 1,
      measuredDurationMinutes: null,
      durationCoveredTasks: 0,
      completedTasks: 1,
      measuredDistanceKm: null,
      distanceCoveredTasks: 0,
      sourceCoverage: {
        manual: 0,
        garmin: 0,
        xunji: 0,
        fallbackUnmeasured: 1,
      },
    });
  });

  it("rejects private or raw fields from the public aggregate DTO", () => {
    const base = aggregateEightWeekTrends({
      trackerKey: "knee-rehab",
      trackerStartedOn: "2026-07-01",
      timeZone: "Asia/Shanghai",
      currentDate: "2026-07-22",
      generatedAt: "2026-07-22T04:00:00.000Z",
      planVersions: [],
      tasks: [],
      feedbacks: [],
      externalRecords: [],
    });

    expect(
      trendsAggregateSchema.safeParse({
        ...base,
        note: "must not be returned",
        providerRecordId: "must-not-leak",
      }).success,
    ).toBe(false);
  });
});
