import { describe, expect, it } from "vitest";

import { buildRecoveryEvidence } from "@/domain/ai-recovery";

describe("P5a-2c AI recovery evidence", () => {
  it("builds a complete 14-day window while preserving missing, zero, and partial steps", () => {
    const evidence = buildRecoveryEvidence({
      from: "2026-07-11",
      through: "2026-07-24",
      records: [
        {
          localDate: "2026-07-11",
          sleepStatus: "available",
          sleepTotalSeconds: 25_200,
          sleepScore: 78,
          stepsStatus: "missing",
          totalSteps: null,
        },
        {
          localDate: "2026-07-23",
          sleepStatus: "missing",
          sleepTotalSeconds: null,
          sleepScore: null,
          stepsStatus: "available",
          totalSteps: 0,
        },
        {
          localDate: "2026-07-24",
          sleepStatus: "missing",
          sleepTotalSeconds: null,
          sleepScore: null,
          stepsStatus: "available",
          totalSteps: 1_200,
        },
      ],
    });

    expect(evidence).toHaveLength(14);
    expect(evidence[0]).toEqual({
      localDate: "2026-07-11",
      sleepStatus: "available",
      sleepTotalSeconds: 25_200,
      sleepScore: 78,
      stepsStatus: "missing",
      totalSteps: null,
      stepsPartial: false,
    });
    expect(evidence[1]).toEqual({
      localDate: "2026-07-12",
      sleepStatus: "missing",
      sleepTotalSeconds: null,
      sleepScore: null,
      stepsStatus: "missing",
      totalSteps: null,
      stepsPartial: false,
    });
    expect(evidence.at(-2)).toMatchObject({
      localDate: "2026-07-23",
      stepsStatus: "available",
      totalSteps: 0,
      stepsPartial: false,
    });
    expect(evidence.at(-1)).toMatchObject({
      localDate: "2026-07-24",
      stepsStatus: "available",
      totalSteps: 1_200,
      stepsPartial: true,
    });
  });

  it("keeps analysis available when the entire recovery window is missing", () => {
    const evidence = buildRecoveryEvidence({
      from: "2026-07-11",
      through: "2026-07-24",
      records: [],
    });

    expect(evidence).toHaveLength(14);
    expect(
      evidence.every(
        (day) =>
          day.sleepStatus === "missing" &&
          day.sleepTotalSeconds === null &&
          day.sleepScore === null &&
          day.stepsStatus === "missing" &&
          day.totalSteps === null,
      ),
    ).toBe(true);
    expect(evidence.at(-1)?.stepsPartial).toBe(true);
  });
});
