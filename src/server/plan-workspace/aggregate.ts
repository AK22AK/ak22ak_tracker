import "server-only";

import { and, asc, count, desc, eq, gte } from "drizzle-orm";

import {
  planWorkspaceSchema,
  type PlanWorkspace,
} from "@/domain/plan-workspace";
import { planVersionSchema } from "@/domain/schemas";
import { localDateInTimeZone } from "@/domain/planning-time";
import { getTrackerAndEffectivePlanDashboardContext } from "@/server/dashboard";
import { getDatabase } from "@/server/db/client";
import {
  assistantMemories,
  planChangeProposals,
  rehabProfiles,
  taskInstances,
} from "@/server/db/schema";
import { rehabProfileDocumentSchema } from "@/domain/rehab-assistant";

export class PlanWorkspaceTrackerNotFoundError extends Error {
  constructor() {
    super("tracker_not_found");
    this.name = "PlanWorkspaceTrackerNotFoundError";
  }
}

function daysBetween(from: string, through: string) {
  return Math.floor(
    (new Date(`${through}T00:00:00.000Z`).valueOf() -
      new Date(`${from}T00:00:00.000Z`).valueOf()) /
      86_400_000,
  );
}

export async function getPlanWorkspace({
  trackerKey,
  now = new Date(),
}: {
  trackerKey: string;
  now?: Date;
}): Promise<PlanWorkspace> {
  // Resolve the tracker first so "today" always follows its fixed plan zone.
  const preliminary = await getTrackerAndEffectivePlanDashboardContext(
    trackerKey,
    "9999-12-31",
  );
  if (!preliminary) throw new PlanWorkspaceTrackerNotFoundError();
  const localDate = localDateInTimeZone(
    now,
    preliminary.tracker.planningTimeZone,
  );
  const context = await getTrackerAndEffectivePlanDashboardContext(
    trackerKey,
    localDate,
  );
  if (!context) throw new PlanWorkspaceTrackerNotFoundError();
  const database = getDatabase();
  const plan = context.plan
    ? planVersionSchema.parse(context.plan.document)
    : null;

  const [nextRows, pendingRows, profileRows, memoryRows] = await Promise.all([
    context.plan
      ? database
          .select({
            scheduledOn: taskInstances.scheduledOn,
            definitionId: taskInstances.taskDefinitionId,
          })
          .from(taskInstances)
          .where(
            and(
              eq(taskInstances.trackerId, context.tracker.id),
              eq(taskInstances.planVersionId, context.plan.id),
              gte(taskInstances.scheduledOn, localDate),
            ),
          )
          .orderBy(asc(taskInstances.scheduledOn))
      : Promise.resolve([]),
    database
      .select({ value: count() })
      .from(planChangeProposals)
      .where(
        and(
          eq(planChangeProposals.trackerId, context.tracker.id),
          eq(planChangeProposals.status, "proposed"),
        ),
      ),
    database
      .select({
        version: rehabProfiles.version,
        document: rehabProfiles.document,
      })
      .from(rehabProfiles)
      .where(
        and(
          eq(rehabProfiles.trackerId, context.tracker.id),
          eq(rehabProfiles.status, "active"),
        ),
      )
      .orderBy(desc(rehabProfiles.version))
      .limit(1),
    database
      .select({ value: count() })
      .from(assistantMemories)
      .where(
        and(
          eq(assistantMemories.trackerId, context.tracker.id),
          eq(assistantMemories.status, "active"),
        ),
      ),
  ]);
  const nextDate = nextRows[0]?.scheduledOn ?? null;
  const nextTasks = nextDate
    ? nextRows.filter((row) => row.scheduledOn === nextDate)
    : [];
  const taskById = new Map(plan?.tasks.map((task) => [task.id, task]) ?? []);
  const titles = nextTasks
    .map((row) => taskById.get(row.definitionId)?.title)
    .filter((value): value is string => Boolean(value));

  return planWorkspaceSchema.parse({
    schemaVersion: "1.0.0",
    trackerKey,
    localDate,
    calendarWeek:
      localDate < context.tracker.startedOn
        ? null
        : Math.floor(daysBetween(context.tracker.startedOn, localDate) / 7) + 1,
    plan: context.plan
      ? {
          id: context.plan.id,
          version: context.plan.version,
          effectiveFrom: context.plan.effectiveFrom,
        }
      : null,
    goals: profileRows[0]
      ? rehabProfileDocumentSchema.parse(profileRows[0].document).goals
      : [],
    nextTraining: nextDate
      ? {
          localDate: nextDate,
          taskCount: nextTasks.length,
          titles,
        }
      : null,
    pendingAdviceCount: pendingRows[0]?.value ?? 0,
    profileVersion: profileRows[0]?.version ?? null,
    activeMemoryCount: memoryRows[0]?.value ?? 0,
  });
}
