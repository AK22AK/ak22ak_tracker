import { describe, expect, it } from "vitest";

import { taskActualSchema } from "@/domain/schemas";

describe("task actual data", () => {
  it("records individual exercises without requiring the planned dose", () => {
    const actual = taskActualSchema.parse({
      kind: "exercise_list",
      exercises: [
        {
          name: "示例动作",
          completed: true,
          actual: "20 kg，2×10",
        },
      ],
    });

    expect(actual.exercises[0]).toMatchObject({
      completed: true,
      actual: "20 kg，2×10",
    });
    expect(actual.durationMinutes).toBeNull();
  });

  it("records endurance duration and distance", () => {
    expect(
      taskActualSchema.parse({
        kind: "endurance",
        durationMinutes: 24,
        distanceKm: 2.8,
        summary: "跑走交替",
      }),
    ).toMatchObject({ durationMinutes: 24, distanceKm: 2.8 });
  });
});
