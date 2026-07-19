import type {
  CalendarAggregate,
  DayAggregate,
  TodayAggregate,
} from "@/domain/api-contracts";
import type { DashboardFeedback, TodayDashboard } from "@/server/dashboard";

import type { PendingCommand } from "./command-contracts";

export type PendingProjectionSummary = {
  localOnly: number;
  syncing: number;
  needsAttention: number;
  unclassifiedFeedback: number;
};

function relevantCommands(
  commands: readonly PendingCommand[],
  trackerKey: string,
  localDate?: string,
) {
  return commands
    .filter(
      (command) =>
        command.trackerKey === trackerKey &&
        (localDate === undefined || command.localDate === localDate),
    )
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
}

export function summarizePendingCommands(
  commands: readonly PendingCommand[],
): PendingProjectionSummary {
  return commands.reduce<PendingProjectionSummary>(
    (summary, command) => {
      if (command.status === "syncing") summary.syncing += 1;
      else if (
        command.status === "needs_attention" ||
        command.status === "waiting_auth"
      ) {
        summary.needsAttention += 1;
      } else {
        summary.localOnly += 1;
      }
      if (
        command.kind === "symptom_check_in" &&
        command.payload.localSafetyLevel === null
      ) {
        summary.unclassifiedFeedback += 1;
      }
      return summary;
    },
    { localOnly: 0, syncing: 0, needsAttention: 0, unclassifiedFeedback: 0 },
  );
}

function projectFeedback(command: PendingCommand): DashboardFeedback | null {
  if (
    command.kind !== "symptom_check_in" ||
    command.payload.localSafetyLevel === null
  ) {
    return null;
  }
  return {
    id: command.id,
    occurredAt: command.occurredAt,
    timing: command.payload.checkIn.timing,
    leftPain: command.payload.checkIn.leftPain,
    rightPain: command.payload.checkIn.rightPain,
    swelling: command.payload.checkIn.swelling,
    safetyLevel: command.payload.localSafetyLevel,
    safetyPolicy: command.payload.clientSafetyPolicy ?? undefined,
    note: command.payload.checkIn.note,
  };
}

function projectDashboard(
  dashboard: TodayDashboard,
  commands: readonly PendingCommand[],
) {
  let tasks = dashboard.tasks.map((task) => ({ ...task }));
  const feedbacks = dashboard.feedbacks.map((feedback) => ({ ...feedback }));
  let feedbackCount = dashboard.feedbackCount;

  for (const command of commands) {
    if (command.kind === "task_update") {
      tasks = tasks.map((task) =>
        task.id === command.payload.taskId
          ? {
              ...task,
              status: command.payload.status,
              actual: command.payload.actual,
              subjectiveNote: command.payload.note,
            }
          : task,
      );
      continue;
    }
    if (feedbacks.some((feedback) => feedback.id === command.id)) continue;
    feedbackCount += 1;
    const feedback = projectFeedback(command);
    if (feedback) feedbacks.push(feedback);
  }

  return { ...dashboard, tasks, feedbackCount, feedbacks };
}

type ProjectableToday = Pick<
  TodayAggregate,
  "tracker" | "targetDate" | "plan" | "day" | "execution"
> & { safetyPolicy: unknown };

export function projectTodayPendingCommands<Aggregate extends ProjectableToday>(
  aggregate: Aggregate,
  commands: readonly PendingCommand[],
) {
  const relevant = relevantCommands(
    commands,
    aggregate.tracker.key,
    aggregate.targetDate,
  );
  const localRed = relevant.some(
    (command) =>
      command.kind === "symptom_check_in" &&
      command.payload.localSafetyLevel === "red",
  );
  return {
    data: {
      ...aggregate,
      day: projectDashboard(aggregate.day, relevant),
      execution: localRed
        ? {
            ...aggregate.execution,
            alternatives: [],
            safety: { blocked: true as const, reason: "red_feedback" as const },
          }
        : aggregate.execution,
    } as Aggregate,
    pending: summarizePendingCommands(relevant),
  };
}

export function projectDayPendingCommands(
  aggregate: DayAggregate,
  commands: readonly PendingCommand[],
) {
  const relevant = relevantCommands(
    commands,
    aggregate.trackerKey,
    aggregate.targetDate,
  );
  return {
    data: { ...aggregate, day: projectDashboard(aggregate.day, relevant) },
    pending: summarizePendingCommands(relevant),
  };
}

export function isCommandCountReflectedInDashboard(
  dashboard: TodayDashboard,
  command: PendingCommand,
) {
  if (command.kind === "symptom_check_in") {
    return dashboard.feedbacks.some((feedback) => feedback.id === command.id);
  }
  if (command.payload.baseStatus === command.payload.status) return true;
  const task = dashboard.tasks.find(
    (candidate) => candidate.id === command.payload.taskId,
  );
  return task ? task.status === command.payload.status : null;
}

function statusCountKey(status: "planned" | "completed" | "skipped") {
  if (status === "completed") return "completedCount" as const;
  if (status === "skipped") return "skippedCount" as const;
  return null;
}

export function projectCalendarCanonicalCommand(
  aggregate: CalendarAggregate,
  command: PendingCommand,
) {
  const days = aggregate.days.map((day) => ({ ...day }));
  let summary = days.find((day) => day.date === command.localDate);
  if (!summary) {
    summary = {
      date: command.localDate,
      taskCount: command.kind === "task_update" ? 1 : 0,
      completedCount: 0,
      skippedCount: 0,
      feedbackCount: 0,
    };
    days.push(summary);
  }
  if (command.kind === "symptom_check_in") {
    summary.feedbackCount += 1;
  } else {
    const previousKey = statusCountKey(command.payload.baseStatus);
    const nextKey = statusCountKey(command.payload.status);
    if (previousKey) {
      summary[previousKey] = Math.max(0, summary[previousKey] - 1);
    }
    if (nextKey) {
      summary[nextKey] = Math.min(summary.taskCount, summary[nextKey] + 1);
    }
  }
  days.sort((left, right) => left.date.localeCompare(right.date));
  return { ...aggregate, days };
}

export function projectCalendarPendingCommands(
  aggregate: CalendarAggregate,
  commands: readonly PendingCommand[],
) {
  const relevant = relevantCommands(commands, aggregate.trackerKey).filter(
    (command) => command.localDate.slice(0, 7) === aggregate.month,
  );
  const days: Array<
    CalendarAggregate["days"][number] & { localPendingCount?: number }
  > = aggregate.days.map((day) => ({ ...day }));
  const summaryFor = (date: string) => {
    const existing = days.find((day) => day.date === date);
    if (existing) return existing;
    const created = {
      date,
      taskCount: 0,
      completedCount: 0,
      skippedCount: 0,
      feedbackCount: 0,
      localPendingCount: 0,
    };
    days.push(created);
    return created;
  };

  for (const command of relevant) {
    const summary = summaryFor(command.localDate);
    summary.localPendingCount = (summary.localPendingCount ?? 0) + 1;
  }

  days.sort((left, right) => left.date.localeCompare(right.date));
  return { ...aggregate, days };
}
