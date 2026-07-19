import { describe, expect, it } from "vitest";

import { suggestTrainingTask } from "@/server/integrations/core/task-link-suggestion";
import { projectXunjiTrainingDetails } from "@/server/integrations/xunji/display";

const startedAt = Date.parse("2026-07-19T10:00:00+08:00");
const endedAt = Date.parse("2026-07-19T11:05:00+08:00");

function anonymousPayload() {
  return {
    datestr: "2026-07-19",
    localid: "anonymous-train-1",
    start: startedAt,
    end: endedAt,
    title: "Anonymous strength session",
    rpe: 7.5,
    rest: 75,
    note: "Anonymous session note",
    movements: [
      {
        name: "Anonymous knee extension",
        rpe: 8,
        restSeconds: 60,
        note: "Anonymous movement note",
        sets: [
          {
            weight: 20,
            reps: 10,
            rpe: 8,
            rest: 60,
            note: "Anonymous set note",
            internalMarker: "must-not-leave-server",
          },
        ],
      },
    ],
    privateExtension: "must-not-leave-server",
  };
}

describe("authenticated Xunji display projection", () => {
  it("projects only whitelisted training details and never returns raw payload fields", () => {
    const details = projectXunjiTrainingDetails(anonymousPayload());

    expect(details).toEqual({
      kind: "strength_training",
      title: "Anonymous strength session",
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationSeconds: 65 * 60,
      rpe: 7.5,
      restSeconds: 75,
      note: "Anonymous session note",
      movements: [
        {
          name: "Anonymous knee extension",
          difficulty: null,
          rpe: 8,
          restSeconds: 60,
          note: "Anonymous movement note",
          sets: [
            {
              index: 1,
              completed: null,
              weight: 20,
              unit: null,
              reps: 10,
              duration: null,
              durationUnit: null,
              selfWeight: null,
              rpe: 8,
              restSeconds: 60,
              note: "Anonymous set note",
              items: [],
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(details)).not.toContain("must-not-leave-server");
    expect(JSON.stringify(details)).not.toContain("anonymous-train-1");
  });

  it("preserves source units, completion and non-weight set details without leaking note metadata", () => {
    const details = projectXunjiTrainingDetails({
      ...anonymousPayload(),
      note: {
        text: "Anonymous object session note",
        internalMetadata: "must-not-leave-server",
      },
      movements: [
        {
          name: "Anonymous compound movement",
          difficulty: "hard",
          sets: [
            {
              weight: 20,
              unit: "kg",
              reps: 10,
              done: true,
              rpe: "8",
              note: { text: "Completed set", hidden: "private-set-data" },
            },
            { weight: 35, unit: "lb", reps: 8, done: false },
            { weight_kg: 12.5, reps: 12, completed: true },
            { duration_s: 45, selfWeight: true, done: true },
            {
              time: "00:30",
              note: { text: "Compound set", hidden: "private-compound-data" },
              items: [
                {
                  name: "Anonymous drop A",
                  weight: 15,
                  unit: "kg",
                  reps: 10,
                  done: true,
                },
                {
                  name: "Anonymous drop B",
                  weight: 10,
                  unit: "lb",
                  reps: 12,
                  done: false,
                  note: { text: "Nested note", hidden: "private-item-data" },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(details.note).toBe("Anonymous object session note");
    expect(details.movements[0]).toMatchObject({
      difficulty: "hard",
      sets: [
        {
          completed: true,
          weight: 20,
          unit: "kg",
          reps: 10,
          rpe: 8,
          note: "Completed set",
        },
        { completed: false, weight: 35, unit: "lb", reps: 8 },
        { completed: true, weight: 12.5, unit: "kg", reps: 12 },
        {
          completed: true,
          duration: 45,
          durationUnit: "s",
          selfWeight: true,
        },
        {
          duration: "00:30",
          durationUnit: null,
          note: "Compound set",
          items: [
            expect.objectContaining({
              name: "Anonymous drop A",
              completed: true,
              weight: 15,
              unit: "kg",
            }),
            expect.objectContaining({
              name: "Anonymous drop B",
              completed: false,
              weight: 10,
              unit: "lb",
              note: "Nested note",
            }),
          ],
        },
      ],
    });
    const serialized = JSON.stringify(details);
    expect(serialized).not.toContain("must-not-leave-server");
    expect(serialized).not.toContain("private-set-data");
    expect(serialized).not.toContain("private-compound-data");
    expect(serialized).not.toContain("private-item-data");
  });
});

describe("conservative same-day task suggestion", () => {
  const record = {
    localDate: "2026-07-19",
    details: projectXunjiTrainingDetails(anonymousPayload()),
  };

  it("suggests a unique same-day task with a matching planned exercise", () => {
    const suggestion = suggestTrainingTask(record, [
      {
        id: "019c0000-0000-7000-8000-000000000001",
        title: "Anonymous lower-body strength",
        category: "strength",
        scheduledOn: "2026-07-19",
        prescription: {
          exercises: [{ name: "Anonymous knee extension", dose: "2 x 10" }],
        },
      },
      {
        id: "019c0000-0000-7000-8000-000000000002",
        title: "Anonymous upper-body session",
        category: "strength",
        scheduledOn: "2026-07-19",
        prescription: {
          exercises: [{ name: "Anonymous row", dose: "2 x 10" }],
        },
      },
    ]);

    expect(suggestion).toEqual({
      taskId: "019c0000-0000-7000-8000-000000000001",
      reason: "训记动作“Anonymous knee extension”与计划动作一致",
    });
  });

  it("does not suggest across dates or from a low-confidence category-only match", () => {
    expect(
      suggestTrainingTask(record, [
        {
          id: "019c0000-0000-7000-8000-000000000003",
          title: "Wrong date",
          category: "strength",
          scheduledOn: "2026-07-20",
          prescription: {
            exercises: [{ name: "Anonymous knee extension", dose: "2 x 10" }],
          },
        },
        {
          id: "019c0000-0000-7000-8000-000000000004",
          title: "Different exercise",
          category: "strength",
          scheduledOn: "2026-07-19",
          prescription: {
            exercises: [{ name: "Anonymous squat", dose: "2 x 10" }],
          },
        },
      ]),
    ).toBeNull();
  });

  it("does not force a suggestion when two tasks match equally", () => {
    expect(
      suggestTrainingTask(record, [
        {
          id: "019c0000-0000-7000-8000-000000000005",
          title: "First matching task",
          category: "strength",
          scheduledOn: "2026-07-19",
          prescription: {
            exercises: [{ name: "Anonymous knee extension", dose: "2 x 10" }],
          },
        },
        {
          id: "019c0000-0000-7000-8000-000000000006",
          title: "Second matching task",
          category: "strength",
          scheduledOn: "2026-07-19",
          prescription: {
            exercises: [{ name: "Anonymous knee extension", dose: "3 x 8" }],
          },
        },
      ]),
    ).toBeNull();
  });
});
