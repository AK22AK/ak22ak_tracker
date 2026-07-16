import "server-only";

import { and, count, desc, eq } from "drizzle-orm";

import { planVersionSchema } from "@/domain/schemas";

import { getDatabase } from "./db/client";
import { events, planVersions, taskInstances, trackers } from "./db/schema";

export type DashboardTask = {
  id: string;
  title: string;
  description: string | undefined;
  category: string;
  prescription: Record<string, unknown>;
  status: "planned" | "completed" | "skipped";
  subjectiveNote: string | null;
};

export type TodayDashboard = {
  state: "missing" | "not_started" | "ready";
  trackerName: string;
  startDate: string | null;
  planVersion: number | null;
  tasks: DashboardTask[];
  feedbackCount: number;
};

export async function getTodayDashboard(
  trackerKey: string,
  localDate: string,
): Promise<TodayDashboard> {
  const database = getDatabase();
  const [tracker] = await database
    .select()
    .from(trackers)
    .where(and(eq(trackers.key, trackerKey), eq(trackers.active, true)))
    .limit(1);

  if (!tracker) {
    return {
      state: "missing",
      trackerName: trackerKey,
      startDate: null,
      planVersion: null,
      tasks: [],
      feedbackCount: 0,
    };
  }

  const [planRow] = await database
    .select()
    .from(planVersions)
    .where(eq(planVersions.trackerId, tracker.id))
    .orderBy(desc(planVersions.version))
    .limit(1);

  if (!planRow) {
    return {
      state: "missing",
      trackerName: tracker.name,
      startDate: tracker.startedOn,
      planVersion: null,
      tasks: [],
      feedbackCount: 0,
    };
  }

  const plan = planVersionSchema.parse(planRow.document);
  const definitions = new Map(plan.tasks.map((task) => [task.id, task]));
  const instances = await database
    .select()
    .from(taskInstances)
    .where(
      and(
        eq(taskInstances.trackerId, tracker.id),
        eq(taskInstances.scheduledOn, localDate),
      ),
    );
  const [{ value: feedbackCount }] = await database
    .select({ value: count() })
    .from(events)
    .where(
      and(
        eq(events.trackerId, tracker.id),
        eq(events.localDate, localDate),
        eq(events.kind, "symptom_check_in"),
      ),
    );

  const tasks = instances
    .map((instance) => {
      const definition = definitions.get(instance.taskDefinitionId);
      if (!definition) return null;

      return {
        id: instance.id,
        title: definition.title,
        description: definition.description,
        category: definition.category,
        prescription: definition.prescription,
        status: instance.status,
        subjectiveNote: instance.subjectiveNote,
      } satisfies DashboardTask;
    })
    .filter((task): task is DashboardTask => task !== null);

  return {
    state: localDate < tracker.startedOn ? "not_started" : "ready",
    trackerName: tracker.name,
    startDate: tracker.startedOn,
    planVersion: plan.version,
    tasks,
    feedbackCount,
  };
}
