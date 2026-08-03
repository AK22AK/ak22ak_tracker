import "server-only";

import { garminActivitySummarySchema } from "@/domain/garmin";
import { projectXunjiTrainingDetails } from "@/server/integrations/xunji/display";

import type {
  PlanAdjustmentEvidenceRelation,
  PlanAdjustmentObservedTraining,
  PlanAdjustmentXunjiSet,
} from "./contracts";

export type AiExternalRecordRow = {
  id: string;
  provider: string;
  kind: string;
  localDate: string;
  occurredAt: Date;
  sourceVersion: number;
  document: { payload?: unknown };
  linkStatus: "suggested" | "confirmed" | "rejected" | null;
  linkSourceVersion: number | null;
  linkNeedsReview: boolean | null;
  taskDefinitionId: string | null;
};

function relation(row: AiExternalRecordRow): PlanAdjustmentEvidenceRelation {
  if (
    row.linkStatus === "confirmed" &&
    row.taskDefinitionId &&
    row.linkNeedsReview === false &&
    row.linkSourceVersion === row.sourceVersion
  ) {
    return { status: "confirmed_link", taskDefinitionId: row.taskDefinitionId };
  }
  if (row.linkStatus === "rejected" && row.linkNeedsReview === false) {
    return { status: "unrelated", taskDefinitionId: null };
  }
  return { status: "observed_unconfirmed", taskDefinitionId: null };
}

function completedSet(input: {
  completed: boolean | null;
  weight: number | string | null;
  unit: string | null;
  reps: number | string | null;
  duration: number | string | null;
  durationUnit: string | null;
  selfWeight: boolean | null;
  rpe: number | null;
  restSeconds: number | null;
}): PlanAdjustmentXunjiSet | null {
  if (input.completed !== true) return null;
  return {
    weight: input.weight,
    unit: input.unit,
    reps: input.reps,
    duration: input.duration,
    durationUnit: input.durationUnit,
    selfWeight: input.selfWeight,
    rpe: input.rpe,
    restSeconds: input.restSeconds,
  };
}

function interval(item: PlanAdjustmentObservedTraining) {
  const start = Date.parse(item.startedAt);
  const end =
    item.provider === "xunji"
      ? Date.parse(item.endedAt)
      : start + item.durationSeconds * 1_000;
  return { start, end };
}

export function projectObservedTrainingEvidence(
  rows: readonly AiExternalRecordRow[],
): PlanAdjustmentObservedTraining[] {
  const internal: Array<{
    sourceId: string;
    taskDefinitionId: string | null;
    value: PlanAdjustmentObservedTraining;
  }> = [];
  for (const row of rows) {
    try {
      const sourceRelation = relation(row);
      if (row.provider === "garmin" && row.kind === "activity") {
        const payload = row.document.payload as Record<string, unknown>;
        const activity = garminActivitySummarySchema.parse({
          activityType: payload.activityType,
          startedAt: payload.startedAt,
          durationSeconds: payload.durationSeconds,
          distanceMeters: payload.distanceMeters,
          averagePaceSecondsPerKilometer:
            payload.averagePaceSecondsPerKilometer,
          averageHeartRateBpm: payload.averageHeartRateBpm,
        });
        internal.push({
          sourceId: row.id,
          taskDefinitionId: sourceRelation.taskDefinitionId,
          value: {
            provider: "garmin" as const,
            kind: "activity" as const,
            localDate: row.localDate,
            startedAt: activity.startedAt,
            activityType: activity.activityType,
            durationSeconds: activity.durationSeconds,
            distanceMeters: activity.distanceMeters,
            averagePaceSecondsPerKilometer:
              activity.averagePaceSecondsPerKilometer,
            averageHeartRateBpm: activity.averageHeartRateBpm,
            relation: sourceRelation,
            overlap: { status: "distinct" as const, group: null },
          },
        });
        continue;
      }
      if (row.provider === "xunji" && row.kind === "strength_training") {
        const training = projectXunjiTrainingDetails(
          row.document.payload as Record<string, unknown>,
        );
        internal.push({
          sourceId: row.id,
          taskDefinitionId: sourceRelation.taskDefinitionId,
          value: {
            provider: "xunji" as const,
            kind: "strength_training" as const,
            localDate: row.localDate,
            startedAt: training.startedAt,
            endedAt: training.endedAt,
            durationSeconds: training.durationSeconds,
            movements: training.movements.flatMap((movement) => {
              const sets = [
                ...movement.sets.flatMap((set) => {
                  const own = completedSet(set);
                  return [
                    ...(own ? [own] : []),
                    ...set.items.flatMap((item) => {
                      const nested = completedSet(item);
                      return nested ? [nested] : [];
                    }),
                  ];
                }),
              ];
              return sets.length ? [{ name: movement.name, sets }] : [];
            }),
            relation: sourceRelation,
            overlap: { status: "distinct" as const, group: null },
          },
        });
        continue;
      }
    } catch {
      continue;
    }
  }

  let overlapIndex = 0;
  const grouped = new Map<string, number[]>();
  for (let index = 0; index < internal.length; index += 1) {
    const item = internal[index]!;
    if (item.taskDefinitionId) {
      const key = `${item.value.localDate}:${item.taskDefinitionId}`;
      grouped.set(key, [...(grouped.get(key) ?? []), index]);
    }
  }
  for (const indexes of grouped.values()) {
    if (indexes.length < 2) continue;
    const group = `overlap-${++overlapIndex}`;
    for (const index of indexes) {
      internal[index]!.value.overlap = {
        status: "confirmed_same_session",
        group,
      };
    }
  }
  for (let left = 0; left < internal.length; left += 1) {
    for (let right = left + 1; right < internal.length; right += 1) {
      const one = internal[left]!;
      const two = internal[right]!;
      if (
        one.value.overlap.status !== "distinct" ||
        two.value.overlap.status !== "distinct" ||
        one.value.localDate !== two.value.localDate ||
        one.value.provider === two.value.provider ||
        (one.value.provider === "garmin" &&
          one.value.activityType !== "strength_training") ||
        (two.value.provider === "garmin" &&
          two.value.activityType !== "strength_training")
      ) {
        continue;
      }
      const a = interval(one.value);
      const b = interval(two.value);
      if (a.start < b.end && b.start < a.end) {
        const group = `overlap-${++overlapIndex}`;
        one.value.overlap = { status: "possible_same_session", group };
        two.value.overlap = { status: "possible_same_session", group };
      }
    }
  }
  return internal.map((item) => item.value);
}
