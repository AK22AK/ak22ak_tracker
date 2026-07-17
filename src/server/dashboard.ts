import "server-only";

import { and, asc, desc, eq, gte, lte } from "drizzle-orm";

import { monthBounds } from "@/domain/calendar";
import { planVersionSchema, type TaskActual } from "@/domain/schemas";
import { kneeCheckInEventPayloadSchema } from "@/modules/knee-rehab/check-in";

import { getDatabase } from "./db/client";
import { events, planVersions, taskInstances, trackers } from "./db/schema";

export type DashboardTask = {
  id: string;
  title: string;
  description: string | undefined;
  category: string;
  prescription: Record<string, unknown>;
  status: "planned" | "completed" | "skipped";
  actual: TaskActual | null;
  subjectiveNote: string | null;
};

export type DashboardFeedback = {
  id: string;
  occurredAt: string;
  timing: "morning" | "post_training" | "next_day" | "incident";
  leftPain: number;
  rightPain: number;
  swelling: "none" | "mild" | "obvious";
  safetyLevel: "green" | "yellow" | "red";
  note: string;
};

export type CalendarDaySummary = {
  date: string;
  taskCount: number;
  completedCount: number;
  skippedCount: number;
  feedbackCount: number;
};

export type TodayDashboard = {
  state: "missing" | "not_started" | "ready";
  trackerName: string;
  startDate: string | null;
  planVersion: number | null;
  tasks: DashboardTask[];
  feedbackCount: number;
  feedbacks: DashboardFeedback[];
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
      feedbacks: [],
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
      feedbacks: [],
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
        eq(taskInstances.planVersionId, planRow.id),
        eq(taskInstances.scheduledOn, localDate),
      ),
    );
  const feedbackRows = await database
    .select({
      id: events.id,
      occurredAt: events.occurredAt,
      document: events.document,
    })
    .from(events)
    .where(
      and(
        eq(events.trackerId, tracker.id),
        eq(events.localDate, localDate),
        eq(events.kind, "symptom_check_in"),
      ),
    )
    .orderBy(asc(events.occurredAt));

  const feedbacks = feedbackRows.flatMap((row) => {
    const payload = kneeCheckInEventPayloadSchema.safeParse(
      row.document.payload,
    );
    return payload.success
      ? [
          {
            id: row.id,
            occurredAt: row.occurredAt.toISOString(),
            ...payload.data,
          } satisfies DashboardFeedback,
        ]
      : [];
  });

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
        actual: instance.actualData,
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
    feedbackCount: feedbacks.length,
    feedbacks,
  };
}

export async function getCalendarMonth(
  trackerKey: string,
  month: string,
): Promise<CalendarDaySummary[]> {
  const { start, end } = monthBounds(month);
  const database = getDatabase();
  const [tracker] = await database
    .select({ id: trackers.id })
    .from(trackers)
    .where(and(eq(trackers.key, trackerKey), eq(trackers.active, true)))
    .limit(1);

  if (!tracker) return [];

  const [planRow] = await database
    .select({ id: planVersions.id })
    .from(planVersions)
    .where(eq(planVersions.trackerId, tracker.id))
    .orderBy(desc(planVersions.version))
    .limit(1);

  const taskRows = planRow
    ? await database
        .select({
          date: taskInstances.scheduledOn,
          status: taskInstances.status,
        })
        .from(taskInstances)
        .where(
          and(
            eq(taskInstances.trackerId, tracker.id),
            eq(taskInstances.planVersionId, planRow.id),
            gte(taskInstances.scheduledOn, start),
            lte(taskInstances.scheduledOn, end),
          ),
        )
    : [];
  const feedbackRows = await database
    .select({ date: events.localDate })
    .from(events)
    .where(
      and(
        eq(events.trackerId, tracker.id),
        eq(events.kind, "symptom_check_in"),
        gte(events.localDate, start),
        lte(events.localDate, end),
      ),
    );
  const summaries = new Map<string, CalendarDaySummary>();
  const summaryFor = (date: string) => {
    const existing = summaries.get(date);
    if (existing) return existing;
    const created: CalendarDaySummary = {
      date,
      taskCount: 0,
      completedCount: 0,
      skippedCount: 0,
      feedbackCount: 0,
    };
    summaries.set(date, created);
    return created;
  };

  for (const task of taskRows) {
    const summary = summaryFor(task.date);
    summary.taskCount += 1;
    if (task.status === "completed") summary.completedCount += 1;
    if (task.status === "skipped") summary.skippedCount += 1;
  }
  for (const feedback of feedbackRows) {
    summaryFor(feedback.date).feedbackCount += 1;
  }

  return [...summaries.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}
