import { isDeepStrictEqual } from "node:util";

import { localDateInTimeZone } from "@/domain/planning-time";
import {
  schemaVersion,
  type TrackerEvent,
  trackerEventSchema,
} from "@/domain/schemas";
import type {
  CreateExecutionContextCommand,
  EndExecutionContextCommand,
  EndExecutionPauseCommand,
  ExecutionAlternativeReference,
  ExecutionDayConditions,
  SetExecutionDayCommand,
  StartExecutionPauseCommand,
} from "@/domain/execution-context";
import { eventMirrorPath } from "@/server/mirror/path";

export type ExecutionCommandTracker = {
  id: string;
  key: string;
  planningTimeZone: string;
};

export type ExecutionCommandContext = {
  id: string;
  trackerId: string;
  trackerKey: string;
  planningTimeZone: string;
  kind: "travel" | "equipment_limited";
  startDate: string;
  endDate: string;
  endedOn: string | null;
};

export type ExecutionCommandAlternative = {
  id: string;
  version: number;
  effectiveFrom: string;
};

export type ExecutionCommandPause = {
  id: string;
  trackerId: string;
  reason: StartExecutionPauseCommand["reason"];
  note: string | null;
  startedOn: string;
  endedOn: string | null;
};

function pauseProjection(
  pause: ExecutionCommandPause,
  status: "active" | "pending_resume_assessment",
  endedOn = pause.endedOn,
) {
  return {
    id: pause.id,
    reason: pause.reason,
    note: pause.note,
    startedOn: pause.startedOn,
    endedOn,
    status,
  } as const;
}

type PreparedBase = {
  trackerId: string;
  event: TrackerEvent;
  outbox: {
    aggregateType: "event";
    aggregateId: string;
    targetPath: string;
    payload: Record<string, unknown>;
  };
};

export type PreparedExecutionContextCommand =
  | (PreparedBase & {
      type: "create";
      context: ExecutionCommandContext;
    })
  | (PreparedBase & {
      type: "end";
      contextId: string;
      endedOn: string;
      endedAt: Date;
    })
  | (PreparedBase & {
      type: "set_day";
      contextId: string;
      localDate: string;
      conditions: ExecutionDayConditions;
      selection: ExecutionAlternativeReference | null;
      safetyDisposition: "normal" | "stop_reassess";
      decidedAt: Date;
    })
  | (PreparedBase & {
      type: "start_pause";
      pause: ExecutionCommandPause;
    })
  | (PreparedBase & {
      type: "end_pause";
      pauseId: string;
      endedOn: string;
      endedAt: Date;
    });

export type ExecutionContextCommandStore = {
  findTracker(key: string): Promise<ExecutionCommandTracker | null>;
  findEventByCommandId(commandId: string): Promise<TrackerEvent | null>;
  findContext(
    trackerId: string,
    contextId: string,
  ): Promise<ExecutionCommandContext | null>;
  findOverlappingContext(
    trackerId: string,
    startDate: string,
    endDate: string,
  ): Promise<ExecutionCommandContext | null>;
  findAlternative(
    trackerId: string,
    optionId: string,
    targetDate: string,
  ): Promise<ExecutionCommandAlternative | null>;
  hasRedSafetySignal(trackerId: string, localDate: string): Promise<boolean>;
  findActivePause(trackerId: string): Promise<ExecutionCommandPause | null>;
  findPause(
    trackerId: string,
    pauseId: string,
  ): Promise<ExecutionCommandPause | null>;
  hasBlockingPause(trackerId: string, localDate: string): Promise<boolean>;
  commitAtomically(command: PreparedExecutionContextCommand): Promise<void>;
};

export class ExecutionTrackerNotFoundError extends Error {
  constructor() {
    super("tracker_not_found");
    this.name = "ExecutionTrackerNotFoundError";
  }
}

export class ExecutionContextNotFoundError extends Error {
  constructor() {
    super("execution_context_not_found");
    this.name = "ExecutionContextNotFoundError";
  }
}

export class ExecutionContextOverlapError extends Error {
  constructor() {
    super("execution_context_overlap");
    this.name = "ExecutionContextOverlapError";
  }
}

export class ExecutionContextRangeError extends Error {
  constructor(message = "execution_context_range_invalid") {
    super(message);
    this.name = "ExecutionContextRangeError";
  }
}

export class ExecutionAlternativeNotFoundError extends Error {
  constructor() {
    super("execution_alternative_not_found");
    this.name = "ExecutionAlternativeNotFoundError";
  }
}

export class ExecutionAlternativeVersionConflictError extends Error {
  constructor() {
    super("execution_alternative_version_conflict");
    this.name = "ExecutionAlternativeVersionConflictError";
  }
}

export class ExecutionContextSafetyBlockedError extends Error {
  constructor() {
    super("execution_context_safety_blocked");
    this.name = "ExecutionContextSafetyBlockedError";
  }
}

export class ExecutionPauseAlreadyActiveError extends Error {
  constructor() {
    super("execution_pause_already_active");
    this.name = "ExecutionPauseAlreadyActiveError";
  }
}

export class ExecutionPauseNotFoundError extends Error {
  constructor() {
    super("execution_pause_not_found");
    this.name = "ExecutionPauseNotFoundError";
  }
}

export class ExecutionContextCommandConflictError extends Error {
  constructor() {
    super("idempotency_conflict");
    this.name = "ExecutionContextCommandConflictError";
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return postgresErrorCode(error.cause);
  return undefined;
}

function eventFor(
  tracker: ExecutionCommandTracker,
  command: {
    commandId: string;
    occurredAt: string;
    occurredTimeZone: string;
    occurredUtcOffsetMinutes: number;
  },
  kind: TrackerEvent["kind"],
  payload: Record<string, unknown>,
  now: Date,
) {
  return trackerEventSchema.parse({
    schemaVersion,
    id: command.commandId,
    trackerKey: tracker.key,
    kind,
    occurredAt: command.occurredAt,
    recordedAt: now.toISOString(),
    occurredTimeZone: command.occurredTimeZone,
    occurredUtcOffsetMinutes: command.occurredUtcOffsetMinutes,
    localDate: localDateInTimeZone(
      command.occurredAt,
      tracker.planningTimeZone,
    ),
    idempotencyKey: command.commandId,
    payload,
    provenance: { source: "user" },
  });
}

function preparedBase(trackerId: string, event: TrackerEvent): PreparedBase {
  return {
    trackerId,
    event,
    outbox: {
      aggregateType: "event",
      aggregateId: event.id,
      targetPath: eventMirrorPath(event),
      payload: event,
    },
  };
}

function commandMatches(
  event: TrackerEvent,
  input: {
    commandId: string;
    occurredAt: string;
    occurredTimeZone: string;
    occurredUtcOffsetMinutes: number;
  },
  trackerKey: string,
  kind: TrackerEvent["kind"],
  expectedPayload: Record<string, unknown>,
) {
  return (
    event.id === input.commandId &&
    event.idempotencyKey === input.commandId &&
    event.trackerKey === trackerKey &&
    event.kind === kind &&
    event.occurredAt === input.occurredAt &&
    event.occurredTimeZone === input.occurredTimeZone &&
    event.occurredUtcOffsetMinutes === input.occurredUtcOffsetMinutes &&
    isDeepStrictEqual(event.payload, expectedPayload)
  );
}

async function commitOrReplay(
  store: ExecutionContextCommandStore,
  prepared: PreparedExecutionContextCommand,
  matches: (event: TrackerEvent) => boolean,
) {
  try {
    await store.commitAtomically(prepared);
    return false;
  } catch (error) {
    if (postgresErrorCode(error) !== "23505") throw error;
    const concurrent = await store.findEventByCommandId(
      prepared.event.idempotencyKey,
    );
    if (!concurrent || !matches(concurrent)) {
      throw new ExecutionContextCommandConflictError();
    }
    return true;
  }
}

export async function executeCreateExecutionContextCommand(
  store: ExecutionContextCommandStore,
  input: CreateExecutionContextCommand & { trackerKey: string },
  now = new Date(),
) {
  const tracker = await store.findTracker(input.trackerKey);
  if (!tracker) throw new ExecutionTrackerNotFoundError();
  if (input.endDate < input.startDate) throw new ExecutionContextRangeError();
  const payload = {
    contextId: input.contextId,
    kind: input.kind,
    startDate: input.startDate,
    endDate: input.endDate,
  };
  const matches = (event: TrackerEvent) =>
    commandMatches(
      event,
      input,
      tracker.key,
      "execution_context_started",
      payload,
    );
  const existing = await store.findEventByCommandId(input.commandId);
  if (existing) {
    if (!matches(existing)) throw new ExecutionContextCommandConflictError();
    return {
      commandId: input.commandId,
      replayed: true,
      context: {
        id: input.contextId,
        kind: input.kind,
        startDate: input.startDate,
        endDate: input.endDate,
        status: existing.localDate < input.startDate ? "upcoming" : "active",
      },
    } as const;
  }
  const currentPlanDate = localDateInTimeZone(
    now.toISOString(),
    tracker.planningTimeZone,
  );
  if (input.endDate < currentPlanDate) {
    throw new ExecutionContextRangeError("execution_context_fully_past");
  }
  if (
    await store.findOverlappingContext(
      tracker.id,
      input.startDate,
      input.endDate,
    )
  ) {
    throw new ExecutionContextOverlapError();
  }
  const event = eventFor(
    tracker,
    input,
    "execution_context_started",
    payload,
    now,
  );
  const context: ExecutionCommandContext = {
    id: input.contextId,
    trackerId: tracker.id,
    trackerKey: tracker.key,
    planningTimeZone: tracker.planningTimeZone,
    kind: input.kind,
    startDate: input.startDate,
    endDate: input.endDate,
    endedOn: null,
  };
  const prepared: PreparedExecutionContextCommand = {
    ...preparedBase(tracker.id, event),
    type: "create",
    context,
  };
  let replayed: boolean;
  try {
    replayed = await commitOrReplay(store, prepared, matches);
  } catch (error) {
    if (postgresErrorCode(error) === "23P01") {
      throw new ExecutionContextOverlapError();
    }
    throw error;
  }
  return {
    commandId: input.commandId,
    replayed,
    context: {
      id: input.contextId,
      kind: input.kind,
      startDate: input.startDate,
      endDate: input.endDate,
      status: event.localDate < input.startDate ? "upcoming" : "active",
    },
  } as const;
}

export async function executeEndExecutionContextCommand(
  store: ExecutionContextCommandStore,
  input: EndExecutionContextCommand & { trackerKey: string },
  now = new Date(),
) {
  const tracker = await store.findTracker(input.trackerKey);
  if (!tracker) throw new ExecutionTrackerNotFoundError();
  const endedOn = localDateInTimeZone(
    input.occurredAt,
    tracker.planningTimeZone,
  );
  const payload = { contextId: input.contextId, endedOn };
  const matches = (event: TrackerEvent) =>
    commandMatches(
      event,
      input,
      tracker.key,
      "execution_context_ended",
      payload,
    );
  const existing = await store.findEventByCommandId(input.commandId);
  if (existing) {
    if (!matches(existing)) throw new ExecutionContextCommandConflictError();
    return { commandId: input.commandId, replayed: true, endedOn } as const;
  }
  const context = await store.findContext(tracker.id, input.contextId);
  if (!context || context.endedOn !== null) {
    throw new ExecutionContextNotFoundError();
  }
  const event = eventFor(
    tracker,
    input,
    "execution_context_ended",
    payload,
    now,
  );
  const prepared: PreparedExecutionContextCommand = {
    ...preparedBase(tracker.id, event),
    type: "end",
    contextId: context.id,
    endedOn,
    endedAt: new Date(input.occurredAt),
  };
  const replayed = await commitOrReplay(store, prepared, matches);
  return { commandId: input.commandId, replayed, endedOn } as const;
}

export async function executeSetExecutionDayCommand(
  store: ExecutionContextCommandStore,
  input: SetExecutionDayCommand & { trackerKey: string },
  now = new Date(),
) {
  const tracker = await store.findTracker(input.trackerKey);
  if (!tracker) throw new ExecutionTrackerNotFoundError();
  const planDate = localDateInTimeZone(
    input.occurredAt,
    tracker.planningTimeZone,
  );
  if (input.localDate !== planDate) {
    throw new ExecutionContextRangeError("execution_day_not_current_plan_date");
  }
  const existing = await store.findEventByCommandId(input.commandId);
  if (existing) {
    const inputPayload = {
      contextId: input.contextId,
      localDate: input.localDate,
      conditions: input.conditions,
      selection: input.selection,
    };
    const existingInputPayload = {
      contextId: existing.payload.contextId,
      localDate: existing.payload.localDate,
      conditions: existing.payload.conditions,
      selection: existing.payload.selection,
    };
    if (
      existing.id !== input.commandId ||
      existing.idempotencyKey !== input.commandId ||
      existing.trackerKey !== tracker.key ||
      existing.kind !== "execution_day_decision" ||
      existing.occurredAt !== input.occurredAt ||
      existing.occurredTimeZone !== input.occurredTimeZone ||
      existing.occurredUtcOffsetMinutes !== input.occurredUtcOffsetMinutes ||
      !isDeepStrictEqual(existingInputPayload, inputPayload) ||
      (existing.payload.safetyDisposition !== "normal" &&
        existing.payload.safetyDisposition !== "stop_reassess")
    ) {
      throw new ExecutionContextCommandConflictError();
    }
    return {
      commandId: input.commandId,
      replayed: true,
      day: {
        localDate: input.localDate,
        conditions: input.conditions,
        selection: input.selection,
        safetyDisposition: existing.payload.safetyDisposition,
      },
    } as const;
  }
  const context = await store.findContext(tracker.id, input.contextId);
  if (!context || context.endedOn !== null) {
    throw new ExecutionContextNotFoundError();
  }
  if (
    input.localDate < context.startDate ||
    input.localDate > context.endDate
  ) {
    throw new ExecutionContextRangeError();
  }
  if (await store.hasBlockingPause(tracker.id, input.localDate)) {
    throw new ExecutionContextSafetyBlockedError();
  }
  const redSignal = await store.hasRedSafetySignal(tracker.id, input.localDate);
  const safetyDisposition =
    redSignal || input.conditions.healthStatus !== "normal"
      ? "stop_reassess"
      : "normal";
  if (safetyDisposition === "stop_reassess" && input.selection !== null) {
    throw new ExecutionContextSafetyBlockedError();
  }
  if (input.selection) {
    const alternative = await store.findAlternative(
      tracker.id,
      input.selection.optionId,
      input.localDate,
    );
    if (!alternative) throw new ExecutionAlternativeNotFoundError();
    if (alternative.version !== input.selection.optionVersion) {
      throw new ExecutionAlternativeVersionConflictError();
    }
  }
  const payload = {
    contextId: input.contextId,
    localDate: input.localDate,
    conditions: input.conditions,
    selection: input.selection,
    safetyDisposition,
  };
  const matches = (event: TrackerEvent) =>
    commandMatches(
      event,
      input,
      tracker.key,
      "execution_day_decision",
      payload,
    );
  const event = eventFor(
    tracker,
    input,
    "execution_day_decision",
    payload,
    now,
  );
  const prepared: PreparedExecutionContextCommand = {
    ...preparedBase(tracker.id, event),
    type: "set_day",
    contextId: context.id,
    localDate: input.localDate,
    conditions: input.conditions,
    selection: input.selection,
    safetyDisposition,
    decidedAt: new Date(input.occurredAt),
  };
  const replayed = await commitOrReplay(store, prepared, matches);
  return {
    commandId: input.commandId,
    replayed,
    day: {
      localDate: input.localDate,
      conditions: input.conditions,
      selection: input.selection,
      safetyDisposition,
    },
  } as const;
}

export async function executeStartExecutionPauseCommand(
  store: ExecutionContextCommandStore,
  input: StartExecutionPauseCommand & { trackerKey: string },
  now = new Date(),
) {
  const tracker = await store.findTracker(input.trackerKey);
  if (!tracker) throw new ExecutionTrackerNotFoundError();
  const startedOn = localDateInTimeZone(
    input.occurredAt,
    tracker.planningTimeZone,
  );
  const payload = {
    pauseId: input.pauseId,
    reason: input.reason,
    note: input.note ?? null,
    startedOn,
  };
  const matches = (event: TrackerEvent) =>
    commandMatches(
      event,
      input,
      tracker.key,
      "execution_pause_started",
      payload,
    );
  const existing = await store.findEventByCommandId(input.commandId);
  if (existing) {
    if (!matches(existing)) throw new ExecutionContextCommandConflictError();
    return {
      commandId: input.commandId,
      replayed: true,
      pause: {
        id: input.pauseId,
        reason: input.reason,
        note: input.note ?? null,
        startedOn,
        endedOn: null,
        status: "active",
      },
    } as const;
  }
  if (await store.findActivePause(tracker.id)) {
    throw new ExecutionPauseAlreadyActiveError();
  }
  const event = eventFor(
    tracker,
    input,
    "execution_pause_started",
    payload,
    now,
  );
  const pause: ExecutionCommandPause = {
    id: input.pauseId,
    trackerId: tracker.id,
    reason: input.reason,
    note: input.note ?? null,
    startedOn,
    endedOn: null,
  };
  let replayed: boolean;
  try {
    replayed = await commitOrReplay(
      store,
      {
        ...preparedBase(tracker.id, event),
        type: "start_pause",
        pause,
      },
      matches,
    );
  } catch (error) {
    if (
      error instanceof ExecutionContextCommandConflictError &&
      (await store.findActivePause(tracker.id))
    ) {
      throw new ExecutionPauseAlreadyActiveError();
    }
    throw error;
  }
  return {
    commandId: input.commandId,
    replayed,
    pause: pauseProjection(pause, "active"),
  } as const;
}

export async function executeEndExecutionPauseCommand(
  store: ExecutionContextCommandStore,
  input: EndExecutionPauseCommand & { trackerKey: string },
  now = new Date(),
) {
  const tracker = await store.findTracker(input.trackerKey);
  if (!tracker) throw new ExecutionTrackerNotFoundError();
  const endedOn = localDateInTimeZone(
    input.occurredAt,
    tracker.planningTimeZone,
  );
  const payload = { pauseId: input.pauseId, endedOn };
  const matches = (event: TrackerEvent) =>
    commandMatches(event, input, tracker.key, "execution_pause_ended", payload);
  const existing = await store.findEventByCommandId(input.commandId);
  if (existing) {
    if (!matches(existing)) throw new ExecutionContextCommandConflictError();
    const pause = await store.findPause(tracker.id, input.pauseId);
    if (!pause) throw new ExecutionPauseNotFoundError();
    return {
      commandId: input.commandId,
      replayed: true,
      pause: pauseProjection(pause, "pending_resume_assessment", endedOn),
    } as const;
  }
  const pause = await store.findPause(tracker.id, input.pauseId);
  if (!pause || pause.endedOn !== null) throw new ExecutionPauseNotFoundError();
  if (endedOn < pause.startedOn) throw new ExecutionContextRangeError();
  const event = eventFor(tracker, input, "execution_pause_ended", payload, now);
  const replayed = await commitOrReplay(
    store,
    {
      ...preparedBase(tracker.id, event),
      type: "end_pause",
      pauseId: input.pauseId,
      endedOn,
      endedAt: new Date(input.occurredAt),
    },
    matches,
  );
  return {
    commandId: input.commandId,
    replayed,
    pause: pauseProjection(pause, "pending_resume_assessment", endedOn),
  } as const;
}
