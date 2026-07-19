import "server-only";

import { and, desc, eq, gte, lt, lte } from "drizzle-orm";

import {
  inclusiveLocalDateCount,
  resumptionAssessmentSnapshotSchema,
  shiftLocalDate,
  type ResumptionAssessmentSnapshot,
} from "@/domain/resumption";
import { planVersionSchema, schemaVersion } from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import { planVersions, taskInstances, trackers } from "@/server/db/schema";

type Database = ReturnType<typeof getDatabase>;

export type ResumptionTriggerInput = {
  id: string;
  trackerId: string;
  trackerKey: string;
  planningTimeZone: string;
  triggerType: "execution_context" | "pause";
  triggerId: string;
  startDate: string;
  endDate: string;
  createdAt: Date;
};

export async function buildResumptionAssessmentSnapshot(
  input: ResumptionTriggerInput,
  database: Database = getDatabase(),
): Promise<ResumptionAssessmentSnapshot> {
  const recommendedEffectiveFrom = shiftLocalDate(input.endDate, 1);
  const [planRow] = await database
    .select({
      id: planVersions.id,
      version: planVersions.version,
      effectiveFrom: planVersions.effectiveFrom,
      document: planVersions.document,
    })
    .from(planVersions)
    .where(
      and(
        eq(planVersions.trackerId, input.trackerId),
        lte(planVersions.effectiveFrom, recommendedEffectiveFrom),
      ),
    )
    .orderBy(desc(planVersions.effectiveFrom), desc(planVersions.version))
    .limit(1);
  if (!planRow) throw new Error("resumption_base_plan_not_found");
  const plan = planVersionSchema.parse(planRow.document);
  const taskByDefinition = new Map(plan.tasks.map((task) => [task.id, task]));

  const [lastConfirmedRows, futureRows] = await Promise.all([
    database
      .select({
        id: taskInstances.id,
        taskDefinitionId: taskInstances.taskDefinitionId,
        scheduledOn: taskInstances.scheduledOn,
        status: taskInstances.status,
      })
      .from(taskInstances)
      .where(
        and(
          eq(taskInstances.trackerId, input.trackerId),
          eq(taskInstances.planVersionId, planRow.id),
          eq(taskInstances.confirmedByUser, true),
          eq(taskInstances.status, "completed"),
          lt(taskInstances.scheduledOn, input.startDate),
        ),
      )
      .orderBy(desc(taskInstances.scheduledOn))
      .limit(1),
    database
      .select({
        id: taskInstances.id,
        taskDefinitionId: taskInstances.taskDefinitionId,
        scheduledOn: taskInstances.scheduledOn,
        status: taskInstances.status,
      })
      .from(taskInstances)
      .where(
        and(
          eq(taskInstances.trackerId, input.trackerId),
          eq(taskInstances.planVersionId, planRow.id),
          eq(taskInstances.status, "planned"),
          gte(taskInstances.scheduledOn, recommendedEffectiveFrom),
        ),
      )
      .orderBy(taskInstances.scheduledOn),
  ]);

  const projectTask = (row: (typeof futureRows)[number]) => {
    const task = taskByDefinition.get(row.taskDefinitionId);
    if (!task) throw new Error("resumption_task_definition_not_found");
    return {
      taskInstanceId: row.id,
      taskDefinitionId: row.taskDefinitionId,
      title: task.title,
      category: task.category,
      scheduledOn: row.scheduledOn,
      status: row.status,
    } as const;
  };
  const lastConfirmed = lastConfirmedRows[0]
    ? projectTask(lastConfirmedRows[0])
    : null;
  const futureTasks = futureRows.map(projectTask);
  const interruptionDays = inclusiveLocalDateCount(
    input.startDate,
    input.endDate,
  );

  return resumptionAssessmentSnapshotSchema.parse({
    schemaVersion,
    id: input.id,
    trackerKey: input.trackerKey,
    trigger: {
      type: input.triggerType,
      id: input.triggerId,
      startDate: input.startDate,
      endDate: input.endDate,
      interruptionDays,
      pausedDays: input.triggerType === "pause" ? interruptionDays : 0,
      restrictedDays:
        input.triggerType === "execution_context" ? interruptionDays : 0,
    },
    basePlanVersion: {
      id: planRow.id,
      version: planRow.version,
      effectiveFrom: planRow.effectiveFrom,
    },
    planningTimeZone: input.planningTimeZone,
    createdAt: input.createdAt.toISOString(),
    recommendedEffectiveFrom,
    shiftDays: interruptionDays,
    lastConfirmedTraining: lastConfirmed,
    futureTasks,
    shiftPreview: futureTasks.map((task) => ({
      taskDefinitionId: task.taskDefinitionId,
      title: task.title,
      from: task.scheduledOn,
      to: shiftLocalDate(task.scheduledOn, interruptionDays),
    })),
  });
}

export async function findTrackerForResumption(
  trackerKey: string,
  database: Database = getDatabase(),
) {
  const [tracker] = await database
    .select({
      id: trackers.id,
      key: trackers.key,
      planningTimeZone: trackers.planningTimeZone,
    })
    .from(trackers)
    .where(and(eq(trackers.key, trackerKey), eq(trackers.active, true)))
    .limit(1);
  return tracker ?? null;
}
