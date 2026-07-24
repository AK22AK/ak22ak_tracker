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
          localDate: "2026-07-13",
          planVersionId: "019c0000-0000-7000-8000-000000000001",
          status: "completed",
        },
        {
          localDate: "2026-07-16",
          planVersionId: "019c0000-0000-7000-8000-000000000001",
          status: "completed",
        },
        {
          localDate: "2026-07-16",
          planVersionId: "019c0000-0000-7000-8000-000000000002",
          status: "skipped",
        },
        {
          localDate: "2026-07-20",
          planVersionId: "019c0000-0000-7000-8000-000000000002",
          status: "planned",
        },
      ],
      feedbacks: [],
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
