import {
  type PlanChangeProposal,
  type PlanVersion,
  planVersionSchema,
} from "./schemas";

export class PlanChangeApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanChangeApplicationError";
  }
}

function reject(message: string): never {
  throw new PlanChangeApplicationError(message);
}

export function applyAcceptedPlanChange(
  base: PlanVersion,
  proposal: PlanChangeProposal,
  next: Pick<PlanVersion, "id" | "version" | "createdAt" | "effectiveFrom">,
): PlanVersion {
  if (proposal.status !== "accepted") {
    reject("Only an accepted proposal can change a plan");
  }
  if (proposal.basePlanVersionId !== base.id) {
    reject("The proposal targets a different plan version");
  }
  if (proposal.trackerKey !== base.trackerKey) {
    reject("The proposal targets a different tracker");
  }
  if (proposal.safetyLevel === "red") {
    reject("Red safety proposals cannot be applied automatically");
  }
  if (proposal.operations.length === 0) {
    reject("A proposal without operations cannot change a plan");
  }

  let tasks = [...base.tasks];
  let notes = base.notes;
  const originalById = new Map(base.tasks.map((task) => [task.id, task]));
  if (originalById.size !== base.tasks.length) {
    reject("The base plan contains duplicate task ids");
  }
  const changedTargets = new Set<string>();
  const addedIds = new Set<string>();

  for (const operation of proposal.operations) {
    switch (operation.type) {
      case "add_task": {
        if (operation.task.scheduledDate < next.effectiveFrom) {
          reject("An added task cannot start before the new plan version");
        }
        if (
          originalById.has(operation.task.id) ||
          addedIds.has(operation.task.id)
        ) {
          reject("An added task id must be unique");
        }
        addedIds.add(operation.task.id);
        tasks.push(operation.task);
        break;
      }
      case "replace_task": {
        const existing = originalById.get(operation.taskId);
        if (!existing) reject("A replacement target must exist");
        if (changedTargets.has(operation.taskId)) {
          reject("A task can only be changed once");
        }
        if (existing.scheduledDate < next.effectiveFrom) {
          reject("A historical task cannot be replaced");
        }
        if (operation.task.id !== operation.taskId) {
          reject("A replacement must preserve the task id");
        }
        if (operation.task.scheduledDate < next.effectiveFrom) {
          reject("A replacement cannot start before the new plan version");
        }
        changedTargets.add(operation.taskId);
        tasks = tasks.map((task) =>
          task.id === operation.taskId ? operation.task : task,
        );
        break;
      }
      case "remove_task": {
        const existing = originalById.get(operation.taskId);
        if (!existing) reject("A removal target must exist");
        if (changedTargets.has(operation.taskId)) {
          reject("A task can only be changed once");
        }
        if (existing.scheduledDate < next.effectiveFrom) {
          reject("A historical task cannot be removed");
        }
        changedTargets.add(operation.taskId);
        tasks = tasks.filter((task) => task.id !== operation.taskId);
        break;
      }
      case "set_plan_note": {
        if (changedTargets.has("$plan-note")) {
          reject("The plan note can only be changed once");
        }
        changedTargets.add("$plan-note");
        notes = operation.note;
        break;
      }
    }
  }

  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) {
    reject("The resulting plan contains duplicate task ids");
  }

  return planVersionSchema.parse({
    ...base,
    ...next,
    createdBy: "ai_accepted",
    source: undefined,
    tasks: tasks.sort(
      (a, b) =>
        a.scheduledDate.localeCompare(b.scheduledDate) ||
        a.sortOrder - b.sortOrder ||
        a.id.localeCompare(b.id),
    ),
    notes,
  });
}
