import { isDeepStrictEqual } from "node:util";

import { localDateInTimeZone } from "@/domain/planning-time";
import {
  schemaVersion,
  type TaskActual,
  type TrackerEvent,
  trackerEventSchema,
} from "@/domain/schemas";
import { eventMirrorPath } from "@/server/mirror/path";

export type TaskCommandInput = {
  commandId: string;
  taskId: string;
  status: "planned" | "completed" | "skipped";
  actual: TaskActual | null;
  note: string | null;
  occurredAt: string;
  occurredTimeZone: string;
  occurredUtcOffsetMinutes: number;
};

export type TaskCommandTask = {
  id: string;
  trackerId: string;
  trackerKey: string;
  planningTimeZone: string;
};

export type PreparedTaskCommand = {
  trackerId: string;
  taskUpdate: {
    taskId: string;
    status: TaskCommandInput["status"];
    actual: TaskActual | null;
    note: string | null;
    completedAt: Date | null;
  };
  event: TrackerEvent;
  outbox: {
    aggregateType: "event";
    aggregateId: string;
    targetPath: string;
    payload: Record<string, unknown>;
  };
};

export type TaskCommandStore = {
  findTask(taskId: string): Promise<TaskCommandTask | null>;
  findEventByCommandId(commandId: string): Promise<TrackerEvent | null>;
  commitAtomically(command: PreparedTaskCommand): Promise<void>;
};

export class TaskNotFoundError extends Error {
  constructor() {
    super("task_not_found");
    this.name = "TaskNotFoundError";
  }
}

export class CommandConflictError extends Error {
  constructor() {
    super("idempotency_conflict");
    this.name = "CommandConflictError";
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return postgresErrorCode(error.cause);
  return undefined;
}

function commandMatchesEvent(
  input: TaskCommandInput,
  task: TaskCommandTask,
  event: TrackerEvent,
) {
  return (
    event.id === input.commandId &&
    event.idempotencyKey === input.commandId &&
    event.trackerKey === task.trackerKey &&
    event.kind === "task_completion" &&
    event.occurredAt === input.occurredAt &&
    event.occurredTimeZone === input.occurredTimeZone &&
    event.occurredUtcOffsetMinutes === input.occurredUtcOffsetMinutes &&
    isDeepStrictEqual(event.payload, {
      taskInstanceId: task.id,
      status: input.status,
      actual: input.actual,
      note: input.note,
    })
  );
}

function resultFromEvent(event: TrackerEvent, replayed: boolean) {
  const status = event.payload.status;
  if (status !== "planned" && status !== "completed" && status !== "skipped") {
    throw new CommandConflictError();
  }
  return { commandId: event.idempotencyKey, status, replayed } as const;
}

export async function executeTaskCommand(
  store: TaskCommandStore,
  input: TaskCommandInput,
  now: Date = new Date(),
) {
  const task = await store.findTask(input.taskId);
  if (!task) throw new TaskNotFoundError();

  const existing = await store.findEventByCommandId(input.commandId);
  if (existing) {
    if (!commandMatchesEvent(input, task, existing)) {
      throw new CommandConflictError();
    }
    return resultFromEvent(existing, true);
  }

  const event = trackerEventSchema.parse({
    schemaVersion,
    id: input.commandId,
    trackerKey: task.trackerKey,
    kind: "task_completion",
    occurredAt: input.occurredAt,
    recordedAt: now.toISOString(),
    occurredTimeZone: input.occurredTimeZone,
    occurredUtcOffsetMinutes: input.occurredUtcOffsetMinutes,
    localDate: localDateInTimeZone(input.occurredAt, task.planningTimeZone),
    idempotencyKey: input.commandId,
    payload: {
      taskInstanceId: task.id,
      status: input.status,
      actual: input.actual,
      note: input.note,
    },
    provenance: { source: "user" },
  });
  const command: PreparedTaskCommand = {
    trackerId: task.trackerId,
    taskUpdate: {
      taskId: task.id,
      status: input.status,
      actual: input.actual,
      note: input.note,
      completedAt: input.status === "completed" ? now : null,
    },
    event,
    outbox: {
      aggregateType: "event",
      aggregateId: event.id,
      targetPath: eventMirrorPath(event),
      payload: event,
    },
  };

  try {
    await store.commitAtomically(command);
  } catch (error) {
    if (postgresErrorCode(error) !== "23505") throw error;
    const concurrentExisting = await store.findEventByCommandId(
      input.commandId,
    );
    if (
      !concurrentExisting ||
      !commandMatchesEvent(input, task, concurrentExisting)
    ) {
      throw new CommandConflictError();
    }
    return resultFromEvent(concurrentExisting, true);
  }

  return resultFromEvent(event, false);
}
