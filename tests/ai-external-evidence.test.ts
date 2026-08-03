import { describe, expect, it } from "vitest";

import { projectObservedTrainingEvidence } from "@/server/integrations/ai/external-evidence";

describe("AI external training evidence", () => {
  it("projects strict Garmin and completed Xunji facts without identifiers, raw data or notes", () => {
    const evidence = projectObservedTrainingEvidence([
      {
        id: "garmin-private-id",
        provider: "garmin",
        kind: "activity",
        localDate: "2026-08-01",
        occurredAt: new Date("2026-08-01T10:00:00.000Z"),
        sourceVersion: 2,
        document: {
          payload: {
            activityType: "strength_training",
            startedAt: "2026-08-01T10:00:00.000Z",
            durationSeconds: 3600,
            distanceMeters: null,
            averagePaceSecondsPerKilometer: null,
            averageHeartRateBpm: 120,
            raw: "must-not-leak",
          },
        },
        linkStatus: "confirmed",
        linkSourceVersion: 2,
        linkNeedsReview: false,
        taskDefinitionId: "lower-a",
      },
      {
        id: "xunji-private-id",
        provider: "xunji",
        kind: "strength_training",
        localDate: "2026-08-01",
        occurredAt: new Date("2026-08-01T10:05:00.000Z"),
        sourceVersion: 1,
        document: {
          payload: {
            datestr: "2026-08-01",
            localid: "private-local-id",
            start: Date.parse("2026-08-01T10:05:00.000Z"),
            end: Date.parse("2026-08-01T10:55:00.000Z"),
            movements: [
              {
                name: "匿名动作",
                note: { text: "private movement note" },
                sets: [
                  { done: false, weight: 99, unit: "kg", reps: 1 },
                  {
                    done: true,
                    weight: 10,
                    unit: "kg",
                    reps: 8,
                    rpe: "6",
                    note: "private set note",
                  },
                ],
              },
            ],
            note: { text: "private training note", internal: "secret" },
          },
        },
        linkStatus: "confirmed",
        linkSourceVersion: 1,
        linkNeedsReview: false,
        taskDefinitionId: "lower-a",
      },
    ]);

    expect(evidence).toHaveLength(2);
    expect(evidence[0]).toMatchObject({
      provider: "garmin",
      relation: { status: "confirmed_link", taskDefinitionId: "lower-a" },
      overlap: { status: "confirmed_same_session", group: "overlap-1" },
    });
    expect(evidence[1]).toMatchObject({
      provider: "xunji",
      movements: [
        {
          name: "匿名动作",
          sets: [{ weight: 10, unit: "kg", reps: 8, rpe: 6 }],
        },
      ],
      overlap: { status: "confirmed_same_session", group: "overlap-1" },
    });
    const serialized = JSON.stringify(evidence);
    for (const forbidden of [
      "garmin-private-id",
      "xunji-private-id",
      "private-local-id",
      "private training note",
      "private movement note",
      "private set note",
      "must-not-leak",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("marks overlapping unconfirmed strength sources without treating them as confirmed completion", () => {
    const evidence = projectObservedTrainingEvidence([
      {
        id: "g",
        provider: "garmin",
        kind: "activity",
        localDate: "2026-08-01",
        occurredAt: new Date("2026-08-01T10:00:00.000Z"),
        sourceVersion: 1,
        document: {
          payload: {
            activityType: "strength_training",
            startedAt: "2026-08-01T10:00:00.000Z",
            durationSeconds: 3600,
            distanceMeters: null,
            averagePaceSecondsPerKilometer: null,
            averageHeartRateBpm: null,
          },
        },
        linkStatus: null,
        linkSourceVersion: null,
        linkNeedsReview: null,
        taskDefinitionId: null,
      },
      {
        id: "x",
        provider: "xunji",
        kind: "strength_training",
        localDate: "2026-08-01",
        occurredAt: new Date("2026-08-01T10:30:00.000Z"),
        sourceVersion: 1,
        document: {
          payload: {
            datestr: "2026-08-01",
            localid: "anonymous",
            start: Date.parse("2026-08-01T10:30:00.000Z"),
            end: Date.parse("2026-08-01T11:00:00.000Z"),
            movements: [],
          },
        },
        linkStatus: null,
        linkSourceVersion: null,
        linkNeedsReview: null,
        taskDefinitionId: null,
      },
    ]);

    expect(evidence.map((item) => item.relation.status)).toEqual([
      "observed_unconfirmed",
      "observed_unconfirmed",
    ]);
    expect(evidence.map((item) => item.overlap.status)).toEqual([
      "possible_same_session",
      "possible_same_session",
    ]);
    expect(JSON.stringify(evidence)).not.toContain("completed");
  });
});
