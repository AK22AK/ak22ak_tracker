import {
  type PlanChangeProposal,
  type PlanVersion,
  planVersionSchema,
} from "./schemas";

export function applyAcceptedPlanChange(
  base: PlanVersion,
  proposal: PlanChangeProposal,
  next: Pick<PlanVersion, "id" | "version" | "createdAt" | "effectiveFrom">,
): PlanVersion {
  if (proposal.status !== "accepted") {
    throw new Error("Only an accepted proposal can change a plan");
  }
  if (proposal.basePlanVersionId !== base.id) {
    throw new Error("The proposal targets a different plan version");
  }
  if (proposal.safetyLevel === "red") {
    throw new Error("Red safety proposals cannot be applied automatically");
  }

  let tasks = [...base.tasks];
  let notes = base.notes;

  for (const operation of proposal.operations) {
    switch (operation.type) {
      case "add_task":
        tasks.push(operation.task);
        break;
      case "replace_task":
        tasks = tasks.map((task) =>
          task.id === operation.taskId ? operation.task : task,
        );
        break;
      case "remove_task":
        tasks = tasks.filter((task) => task.id !== operation.taskId);
        break;
      case "set_plan_note":
        notes = operation.note;
        break;
    }
  }

  return planVersionSchema.parse({
    ...base,
    ...next,
    createdBy: "ai_accepted",
    source: undefined,
    tasks: tasks.sort((a, b) => a.sortOrder - b.sortOrder),
    notes,
  });
}
