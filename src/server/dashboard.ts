import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";

import { monthBounds } from "@/domain/calendar";
import { resolveEffectivePlanVersion } from "@/domain/plan-timeline";
import { planVersionSchema, type TaskActual } from "@/domain/schemas";
import type { ExternalTrainingRecord } from "@/domain/external-training";
import { kneeCheckInEventPayloadSchema } from "@/modules/knee-rehab/check-in";

import { getDatabase } from "./db/client";
import {
  events,
  executionPauses,
  planVersions,
  taskInstances,
  trackers,
} from "./db/schema";

export type DashboardTask = {
  id: string;
  title: string;
  description?: string;
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
  safetyPolicy?: {
    policyId: string;
    version: number;
    hash: string;
  };
  note: string;
};

export type CalendarDaySummary = {
  date: string;
  taskCount: number;
  completedCount: number;
  skippedCount: number;
  feedbackCount: number;
  paused?: boolean;
};

export type TodayDashboard = {
  state: "missing" | "not_started" | "ready";
  trackerName: string;
  startDate: string | null;
  planVersion: number | null;
  tasks: DashboardTask[];
  feedbackCount: number;
  feedbacks: DashboardFeedback[];
  externalTrainingRecords: ExternalTrainingRecord[];
};

export type TrackerDashboardContext = {
  id: string;
  key: string;
  name: string;
  startedOn: string;
  planningTimeZone: string;
};

export type EffectivePlanDashboardContext = {
  id: string;
  version: number;
  effectiveFrom: string;
  document: unknown;
};

export async function getTrackerDashboardContext(
  trackerKey: string,
): Promise<TrackerDashboardContext | null> {
  const [tracker] = await getDatabase()
    .select({
      id: trackers.id,
      key: trackers.key,
      name: trackers.name,
      startedOn: trackers.startedOn,
      planningTimeZone: trackers.planningTimeZone,
    })
    .from(trackers)
    .where(and(eq(trackers.key, trackerKey), eq(trackers.active, true)))
    .limit(1);
  return tracker ?? null;
}

export async function getEffectivePlanDashboardContext(
  trackerId: string,
  localDate: string,
): Promise<EffectivePlanDashboardContext | null> {
  const [plan] = await getDatabase()
    .select({
      id: planVersions.id,
      version: planVersions.version,
      effectiveFrom: planVersions.effectiveFrom,
      document: planVersions.document,
    })
    .from(planVersions)
    .where(
      and(
        eq(planVersions.trackerId, trackerId),
        lte(planVersions.effectiveFrom, localDate),
      ),
    )
    .orderBy(desc(planVersions.effectiveFrom), desc(planVersions.version))
    .limit(1);
  return plan ?? null;
}

export async function getTodayDashboard(
  trackerKey: string,
  localDate: string,
): Promise<TodayDashboard> {
  const tracker = await getTrackerDashboardContext(trackerKey);
  const plan = tracker
    ? await getEffectivePlanDashboardContext(tracker.id, localDate)
    : null;
  return getTodayDashboardForTracker(tracker, plan, trackerKey, localDate);
}

export async function getTodayDashboardForTracker(
  tracker: TrackerDashboardContext | null,
  planRow: EffectivePlanDashboardContext | null,
  trackerKey: string,
  localDate: string,
): Promise<TodayDashboard> {
  const database = getDatabase();

  if (!tracker) {
    return {
      state: "missing",
      trackerName: trackerKey,
      startDate: null,
      planVersion: null,
      tasks: [],
      feedbackCount: 0,
      feedbacks: [],
      externalTrainingRecords: [],
    };
  }

  if (!planRow) {
    return {
      state: localDate < tracker.startedOn ? "not_started" : "missing",
      trackerName: tracker.name,
      startDate: tracker.startedOn,
      planVersion: null,
      tasks: [],
      feedbackCount: 0,
      feedbacks: [],
      externalTrainingRecords: [],
    };
  }

  const plan = planVersionSchema.parse(planRow.document);
  const definitions = new Map(plan.tasks.map((task) => [task.id, task]));
  const [instances, feedbackRows] = await Promise.all([
    database
      .select()
      .from(taskInstances)
      .where(
        and(
          eq(taskInstances.trackerId, tracker.id),
          eq(taskInstances.planVersionId, planRow.id),
          eq(taskInstances.scheduledOn, localDate),
        ),
      ),
    database
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
      .orderBy(asc(events.occurredAt)),
  ]);

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

  const tasks = instances.flatMap((instance): DashboardTask[] => {
    const definition = definitions.get(instance.taskDefinitionId);
    if (!definition) return [];

    return [
      {
        id: instance.id,
        title: definition.title,
        description: definition.description,
        category: definition.category,
        prescription: definition.prescription,
        status: instance.status,
        actual: instance.actualData,
        subjectiveNote: instance.subjectiveNote,
      } satisfies DashboardTask,
    ];
  });

  return {
    state: localDate < tracker.startedOn ? "not_started" : "ready",
    trackerName: tracker.name,
    startDate: tracker.startedOn,
    planVersion: plan.version,
    tasks,
    feedbackCount: feedbacks.length,
    feedbacks,
    externalTrainingRecords: [],
  };
}

export async function getCalendarMonth(
  trackerKey: string,
  month: string,
): Promise<CalendarDaySummary[]> {
  const tracker = await getTrackerDashboardContext(trackerKey);
  return getCalendarMonthForTracker(tracker, month);
}

export async function getCalendarMonthForTracker(
  tracker: TrackerDashboardContext | null,
  month: string,
): Promise<CalendarDaySummary[]> {
  const { start, end } = monthBounds(month);
  const database = getDatabase();

  if (!tracker) return [];

  const planRows = await database
    .select({
      id: planVersions.id,
      version: planVersions.version,
      effectiveFrom: planVersions.effectiveFrom,
    })
    .from(planVersions)
    .where(
      and(
        eq(planVersions.trackerId, tracker.id),
        lte(planVersions.effectiveFrom, end),
      ),
    )
    .orderBy(asc(planVersions.effectiveFrom), asc(planVersions.version));

  const taskRows = planRows.length
    ? await database
        .select({
          date: taskInstances.scheduledOn,
          status: taskInstances.status,
          planVersionId: taskInstances.planVersionId,
        })
        .from(taskInstances)
        .where(
          and(
            eq(taskInstances.trackerId, tracker.id),
            inArray(
              taskInstances.planVersionId,
              planRows.map((version) => version.id),
            ),
            gte(taskInstances.scheduledOn, start),
            lte(taskInstances.scheduledOn, end),
          ),
        )
    : [];
  const [feedbackRows, pauseRows] = await Promise.all([
    database
      .select({ date: events.localDate })
      .from(events)
      .where(
        and(
          eq(events.trackerId, tracker.id),
          eq(events.kind, "symptom_check_in"),
          gte(events.localDate, start),
          lte(events.localDate, end),
        ),
      ),
    database
      .select({
        startedOn: executionPauses.startedOn,
        endedOn: executionPauses.endedOn,
      })
      .from(executionPauses)
      .where(
        and(
          eq(executionPauses.trackerId, tracker.id),
          lte(executionPauses.startedOn, end),
          or(
            isNull(executionPauses.endedOn),
            gte(executionPauses.endedOn, start),
          ),
        ),
      ),
  ]);
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
      paused: false,
    };
    summaries.set(date, created);
    return created;
  };

  for (const task of taskRows) {
    const effectiveVersion = resolveEffectivePlanVersion(planRows, task.date);
    if (effectiveVersion?.id !== task.planVersionId) continue;
    const summary = summaryFor(task.date);
    summary.taskCount += 1;
    if (task.status === "completed") summary.completedCount += 1;
    if (task.status === "skipped") summary.skippedCount += 1;
  }
  for (const feedback of feedbackRows) {
    summaryFor(feedback.date).feedbackCount += 1;
  }
  for (const pause of pauseRows) {
    const first = pause.startedOn > start ? pause.startedOn : start;
    const last = pause.endedOn && pause.endedOn < end ? pause.endedOn : end;
    const cursor = new Date(`${first}T00:00:00Z`);
    while (cursor.toISOString().slice(0, 10) <= last) {
      summaryFor(cursor.toISOString().slice(0, 10)).paused = true;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return [...summaries.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}

export async function getTrackerPlanningTimeZone(trackerKey: string) {
  const tracker = await getTrackerDashboardContext(trackerKey);
  return tracker?.planningTimeZone ?? null;
}
