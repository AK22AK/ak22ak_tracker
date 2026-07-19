import "server-only";

import type { XunjiTrainingDetails } from "@/domain/external-training";

export type TrainingLinkCandidateTask = {
  id: string;
  title: string;
  category: string;
  scheduledOn: string;
  prescription: Record<string, unknown>;
};

type TrainingRecordForSuggestion = {
  localDate: string;
  details: XunjiTrainingDetails;
};

function normalizedName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]/gu, "");
}

function plannedExerciseNames(prescription: Record<string, unknown>) {
  if (!Array.isArray(prescription.exercises)) return [];
  return prescription.exercises.flatMap((value) => {
    if (typeof value !== "object" || value === null) return [];
    const name = (value as Record<string, unknown>).name;
    return typeof name === "string" && name.trim() ? [name.trim()] : [];
  });
}

function nameMatchScore(source: string, planned: string) {
  const left = normalizedName(source);
  const right = normalizedName(planned);
  if (!left || !right) return 0;
  if (left === right) return 3;
  if (
    Math.min(left.length, right.length) >= 4 &&
    (left.includes(right) || right.includes(left))
  ) {
    return 2;
  }
  return 0;
}

export function suggestTrainingTask(
  record: TrainingRecordForSuggestion,
  tasks: TrainingLinkCandidateTask[],
): { taskId: string; reason: string } | null {
  const candidates = tasks
    .filter((task) => task.scheduledOn === record.localDate)
    .flatMap((task) => {
      let best:
        { score: number; sourceName: string; plannedName: string } | undefined;
      for (const movement of record.details.movements) {
        for (const plannedName of plannedExerciseNames(task.prescription)) {
          const score = nameMatchScore(movement.name, plannedName);
          if (!best || score > best.score) {
            best = { score, sourceName: movement.name, plannedName };
          }
        }
      }
      if (!best || best.score === 0) return [];
      const categoryBonus = /strength|力量|康复/i.test(task.category) ? 1 : 0;
      return [{ task, match: best, score: best.score + categoryBonus }];
    })
    .filter((candidate) => candidate.score >= 3)
    .sort((left, right) => right.score - left.score);

  const [best, runnerUp] = candidates;
  if (!best || runnerUp?.score === best.score) return null;
  const relation = best.match.score === 3 ? "一致" : "相近";
  return {
    taskId: best.task.id,
    reason: `训记动作“${best.match.sourceName}”与计划动作${relation}`,
  };
}
