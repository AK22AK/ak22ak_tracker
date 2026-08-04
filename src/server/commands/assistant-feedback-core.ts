import { isDeepStrictEqual } from "node:util";

import { localDateInTimeZone } from "@/domain/planning-time";
import {
  schemaVersion,
  trackerEventSchema,
  type TrackerEvent,
} from "@/domain/schemas";
import { eventMirrorPath } from "@/server/mirror/path";

export type AssistantFeedbackCommandInput = {
  commandId: string;
  trackerKey: string;
  turnId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  occurredTimeZone: string;
  occurredUtcOffsetMinutes: number;
};

export type PreparedAssistantFeedbackCommand = {
  trackerId: string;
  turnId: string;
  event: TrackerEvent;
  outbox: {
    aggregateType: "event";
    aggregateId: string;
    targetPath: string;
    payload: Record<string, unknown>;
  };
  updatedAt: Date;
};

type AssistantFeedbackTracker = {
  id: string;
  key: string;
  planningTimeZone: string;
};

type AtomicConfirmationResult = {
  canonicalEvent: TrackerEvent | null;
  commandEvent: TrackerEvent | null;
  created: boolean;
};

export type AssistantFeedbackCommandStore = {
  findTracker(key: string): Promise<AssistantFeedbackTracker | null>;
  confirmAtomically(
    command: PreparedAssistantFeedbackCommand,
  ): Promise<AtomicConfirmationResult>;
};

export class AssistantFeedbackCommandConflictError extends Error {
  constructor() {
    super("idempotency_conflict");
    this.name = "AssistantFeedbackCommandConflictError";
  }
}

export class AssistantFeedbackUnavailableError extends Error {
  constructor() {
    super("feedback_not_available");
    this.name = "AssistantFeedbackUnavailableError";
  }
}

export class AssistantFeedbackTrackerNotFoundError extends Error {
  constructor() {
    super("tracker_not_found");
    this.name = "AssistantFeedbackTrackerNotFoundError";
  }
}

function commandMatchesEvent(
  input: AssistantFeedbackCommandInput,
  event: TrackerEvent,
) {
  return (
    event.id === input.commandId &&
    event.idempotencyKey === input.commandId &&
    event.trackerKey === input.trackerKey &&
    event.kind === "symptom_check_in" &&
    event.occurredAt === input.occurredAt &&
    event.occurredTimeZone === input.occurredTimeZone &&
    event.occurredUtcOffsetMinutes === input.occurredUtcOffsetMinutes &&
    isDeepStrictEqual(event.payload, input.payload)
  );
}

export async function executeAssistantFeedbackCommand(
  store: AssistantFeedbackCommandStore,
  input: AssistantFeedbackCommandInput,
  now: Date = new Date(),
) {
  const tracker = await store.findTracker(input.trackerKey);
  if (!tracker) throw new AssistantFeedbackTrackerNotFoundError();
  const event = trackerEventSchema.parse({
    schemaVersion,
    id: input.commandId,
    trackerKey: tracker.key,
    kind: "symptom_check_in",
    occurredAt: input.occurredAt,
    recordedAt: now.toISOString(),
    occurredTimeZone: input.occurredTimeZone,
    occurredUtcOffsetMinutes: input.occurredUtcOffsetMinutes,
    localDate: localDateInTimeZone(input.occurredAt, tracker.planningTimeZone),
    idempotencyKey: input.commandId,
    payload: input.payload,
    provenance: { source: "user" },
  });
  const result = await store.confirmAtomically({
    trackerId: tracker.id,
    turnId: input.turnId,
    event,
    outbox: {
      aggregateType: "event",
      aggregateId: event.id,
      targetPath: eventMirrorPath(event),
      payload: event,
    },
    updatedAt: now,
  });
  if (result.commandEvent && !commandMatchesEvent(input, result.commandEvent)) {
    throw new AssistantFeedbackCommandConflictError();
  }
  if (!result.canonicalEvent) throw new AssistantFeedbackUnavailableError();
  if (
    result.canonicalEvent.id === input.commandId &&
    !commandMatchesEvent(input, result.canonicalEvent)
  ) {
    throw new AssistantFeedbackCommandConflictError();
  }
  return {
    event: result.canonicalEvent,
    replayed: !result.created,
  } as const;
}
