import { isDeepStrictEqual } from "node:util";

import { localDateInTimeZone } from "@/domain/planning-time";
import {
  schemaVersion,
  type TrackerEvent,
  trackerEventSchema,
} from "@/domain/schemas";
import { eventMirrorPath } from "@/server/mirror/path";

export type AppendEventInput = {
  commandId: string;
  trackerKey: string;
  kind: TrackerEvent["kind"];
  payload: Record<string, unknown>;
  occurredAt: string;
  occurredTimeZone: string;
  occurredUtcOffsetMinutes: number;
  payloadMatches?: (existingPayload: Record<string, unknown>) => boolean;
};

export type EventCommandTracker = {
  id: string;
  key: string;
  planningTimeZone: string;
};

export type PreparedAppendEvent = {
  trackerId: string;
  event: TrackerEvent;
  outbox: {
    aggregateType: "event";
    aggregateId: string;
    targetPath: string;
    payload: Record<string, unknown>;
  };
};

export type EventCommandStore = {
  findTracker(key: string): Promise<EventCommandTracker | null>;
  findEventByCommandId(commandId: string): Promise<TrackerEvent | null>;
  commitAtomically(command: PreparedAppendEvent): Promise<void>;
};

export class TrackerNotFoundError extends Error {
  constructor() {
    super("tracker_not_found");
    this.name = "TrackerNotFoundError";
  }
}

export class EventCommandConflictError extends Error {
  constructor() {
    super("idempotency_conflict");
    this.name = "EventCommandConflictError";
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return postgresErrorCode(error.cause);
  return undefined;
}

function commandMatchesEvent(input: AppendEventInput, event: TrackerEvent) {
  return (
    event.id === input.commandId &&
    event.idempotencyKey === input.commandId &&
    event.trackerKey === input.trackerKey &&
    event.kind === input.kind &&
    event.occurredAt === input.occurredAt &&
    event.occurredTimeZone === input.occurredTimeZone &&
    event.occurredUtcOffsetMinutes === input.occurredUtcOffsetMinutes &&
    (input.payloadMatches?.(event.payload) ??
      isDeepStrictEqual(event.payload, input.payload))
  );
}

export async function executeAppendEventCommand(
  store: EventCommandStore,
  input: AppendEventInput,
  now: Date = new Date(),
) {
  const tracker = await store.findTracker(input.trackerKey);
  if (!tracker) throw new TrackerNotFoundError();

  const existing = await store.findEventByCommandId(input.commandId);
  if (existing) {
    if (!commandMatchesEvent(input, existing)) {
      throw new EventCommandConflictError();
    }
    return { event: existing, replayed: true } as const;
  }

  const event = trackerEventSchema.parse({
    schemaVersion,
    id: input.commandId,
    trackerKey: tracker.key,
    kind: input.kind,
    occurredAt: input.occurredAt,
    recordedAt: now.toISOString(),
    occurredTimeZone: input.occurredTimeZone,
    occurredUtcOffsetMinutes: input.occurredUtcOffsetMinutes,
    localDate: localDateInTimeZone(input.occurredAt, tracker.planningTimeZone),
    idempotencyKey: input.commandId,
    payload: input.payload,
    provenance: { source: "user" },
  });
  const command: PreparedAppendEvent = {
    trackerId: tracker.id,
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
      !commandMatchesEvent(input, concurrentExisting)
    ) {
      throw new EventCommandConflictError();
    }
    return { event: concurrentExisting, replayed: true } as const;
  }

  return { event, replayed: false } as const;
}
