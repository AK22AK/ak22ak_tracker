import "server-only";

import {
  xunjiTrainingDetailsSchema,
  type XunjiTrainingDetails,
} from "@/domain/external-training";

import { xunjiTrainSchema } from "./contracts";

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstValue(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return null;
}

function displayText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function displayMetric(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return displayText(value, 100);
  return null;
}

function displayNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

function projectSet(value: unknown, index: number) {
  const set = objectValue(value) ?? {};
  return {
    index: index + 1,
    weight: displayMetric(firstValue(set, ["weight", "weightKg", "kg"])),
    reps: displayMetric(firstValue(set, ["reps", "repetitions", "times"])),
    rpe: displayNumber(firstValue(set, ["rpe", "RPE"])),
    restSeconds: displayNumber(
      firstValue(set, ["restSeconds", "rest", "rest_time"]),
    ),
    note: displayText(firstValue(set, ["note", "remark", "memo"]), 1_000),
  };
}

function projectMovement(value: unknown, index: number) {
  const movement = objectValue(value) ?? {};
  const sets = firstValue(movement, ["sets", "setList"]);
  return {
    name:
      displayText(
        firstValue(movement, ["name", "movementName", "title"]),
        300,
      ) ?? `动作 ${index + 1}`,
    sets: Array.isArray(sets) ? sets.map(projectSet) : [],
    rpe: displayNumber(firstValue(movement, ["rpe", "RPE"])),
    restSeconds: displayNumber(
      firstValue(movement, ["restSeconds", "rest", "rest_time"]),
    ),
    note: displayText(firstValue(movement, ["note", "remark", "memo"]), 1_000),
  };
}

export function projectXunjiTrainingDetails(
  payload: Record<string, unknown>,
): XunjiTrainingDetails {
  const train = xunjiTrainSchema.parse(payload);
  const startedAt = new Date(train.start);
  const endedAt = new Date(train.end);
  return xunjiTrainingDetailsSchema.parse({
    kind: "strength_training",
    title:
      displayText(firstValue(train, ["title", "name", "trainName"]), 300) ??
      "训记力量训练",
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationSeconds: Math.floor((train.end - train.start) / 1_000),
    movements: train.movements.map(projectMovement),
    rpe: displayNumber(firstValue(train, ["rpe", "RPE"])),
    restSeconds: displayNumber(
      firstValue(train, ["restSeconds", "rest", "rest_time"]),
    ),
    note: displayText(firstValue(train, ["note", "remark", "memo"]), 2_000),
  });
}
