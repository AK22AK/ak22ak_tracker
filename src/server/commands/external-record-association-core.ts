import { isDeepStrictEqual } from "node:util";

import type { ExternalRecordAssociation } from "@/domain/external-training";
import { localDateInTimeZone } from "@/domain/planning-time";
import {
  schemaVersion,
  type ExternalRecord,
  type TrackerEvent,
  trackerEventSchema,
} from "@/domain/schemas";
import { eventMirrorPath } from "@/server/mirror/path";

export type ExternalRecordAssociationCommandInput = {
  commandId: string;
  trackerKey: string;
  externalRecordId: string;
  sourceVersion: number;
  occurredAt: string;
  occurredTimeZone: string;
  occurredUtcOffsetMinutes: number;
} & (
  | { decision: "link"; taskId: string }
  | { decision: "unrelated"; taskId?: never }
);

export type ExternalRecordAssociationRecord = {
  id: string;
  trackerId: string;
  trackerKey: string;
  planningTimeZone: string;
  localDate: string;
  provider: ExternalRecord["provider"];
  sourceVersion: number;
};

export type PreparedExternalRecordAssociationCommand = {
  trackerId: string;
  association: {
    externalRecordId: string;
    taskId: string | null;
    status: "confirmed" | "unrelated";
    sourceVersion: number;
    needsReview: false;
    confirmedAt: Date;
  };
  event: TrackerEvent;
  outbox: {
    aggregateType: "event";
    aggregateId: string;
    targetPath: string;
    payload: Record<string, unknown>;
  };
};

export type ExternalRecordAssociationCommandStore = {
  findRecord(
    trackerKey: string,
    externalRecordId: string,
  ): Promise<ExternalRecordAssociationRecord | null>;
  findTaskForRecord(
    record: ExternalRecordAssociationRecord,
    taskId: string,
  ): Promise<{ id: string } | null>;
  findEventByCommandId(commandId: string): Promise<TrackerEvent | null>;
  commitAtomically(
    command: PreparedExternalRecordAssociationCommand,
  ): Promise<void>;
};

export class ExternalRecordNotFoundError extends Error {
  constructor() {
    super("external_record_not_found");
    this.name = "ExternalRecordNotFoundError";
  }
}

export class AssociationTargetInvalidError extends Error {
  constructor() {
    super("association_target_invalid");
    this.name = "AssociationTargetInvalidError";
  }
}

export class AssociationSourceVersionConflictError extends Error {
  constructor() {
    super("association_source_version_conflict");
    this.name = "AssociationSourceVersionConflictError";
  }
}

export class AssociationCommandConflictError extends Error {
  constructor() {
    super("idempotency_conflict");
    this.name = "AssociationCommandConflictError";
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return postgresErrorCode(error.cause);
  return undefined;
}

function expectedPayload(
  input: ExternalRecordAssociationCommandInput,
  record: ExternalRecordAssociationRecord,
) {
  return {
    externalRecordId: record.id,
    provider: record.provider,
    decision: input.decision,
    taskInstanceId: input.decision === "link" ? input.taskId : null,
    sourceVersion: input.sourceVersion,
  };
}

function commandMatchesEvent(
  input: ExternalRecordAssociationCommandInput,
  record: ExternalRecordAssociationRecord,
  event: TrackerEvent,
) {
  return (
    event.id === input.commandId &&
    event.idempotencyKey === input.commandId &&
    event.trackerKey === record.trackerKey &&
    event.kind === "external_record_link_decision" &&
    event.occurredAt === input.occurredAt &&
    event.occurredTimeZone === input.occurredTimeZone &&
    event.occurredUtcOffsetMinutes === input.occurredUtcOffsetMinutes &&
    isDeepStrictEqual(event.payload, expectedPayload(input, record))
  );
}

function associationFromEvent(event: TrackerEvent): ExternalRecordAssociation {
  const payload = event.payload;
  if (
    (payload.decision !== "link" && payload.decision !== "unrelated") ||
    typeof payload.externalRecordId !== "string" ||
    typeof payload.sourceVersion !== "number"
  ) {
    throw new AssociationCommandConflictError();
  }
  if (
    payload.decision === "link" &&
    typeof payload.taskInstanceId !== "string"
  ) {
    throw new AssociationCommandConflictError();
  }
  return {
    status: payload.decision === "link" ? "confirmed" : "unrelated",
    taskId: payload.decision === "link" ? String(payload.taskInstanceId) : null,
    sourceVersion: payload.sourceVersion,
    needsReview: false,
  };
}

function resultFromEvent(event: TrackerEvent, replayed: boolean) {
  const externalRecordId = event.payload.externalRecordId;
  if (typeof externalRecordId !== "string") {
    throw new AssociationCommandConflictError();
  }
  return {
    commandId: event.idempotencyKey,
    replayed,
    recordId: externalRecordId,
    association: associationFromEvent(event),
  } as const;
}

export async function executeExternalRecordAssociationCommand(
  store: ExternalRecordAssociationCommandStore,
  input: ExternalRecordAssociationCommandInput,
  now: Date = new Date(),
) {
  const record = await store.findRecord(
    input.trackerKey,
    input.externalRecordId,
  );
  if (!record) throw new ExternalRecordNotFoundError();

  const existing = await store.findEventByCommandId(input.commandId);
  if (existing) {
    if (!commandMatchesEvent(input, record, existing)) {
      throw new AssociationCommandConflictError();
    }
    return resultFromEvent(existing, true);
  }

  if (record.sourceVersion !== input.sourceVersion) {
    throw new AssociationSourceVersionConflictError();
  }
  if (
    input.decision === "link" &&
    !(await store.findTaskForRecord(record, input.taskId))
  ) {
    throw new AssociationTargetInvalidError();
  }

  const event = trackerEventSchema.parse({
    schemaVersion,
    id: input.commandId,
    trackerKey: record.trackerKey,
    kind: "external_record_link_decision",
    occurredAt: input.occurredAt,
    recordedAt: now.toISOString(),
    occurredTimeZone: input.occurredTimeZone,
    occurredUtcOffsetMinutes: input.occurredUtcOffsetMinutes,
    localDate: localDateInTimeZone(input.occurredAt, record.planningTimeZone),
    idempotencyKey: input.commandId,
    payload: expectedPayload(input, record),
    provenance: { source: "user" },
  });
  const association = {
    externalRecordId: record.id,
    taskId: input.decision === "link" ? input.taskId : null,
    status: input.decision === "link" ? "confirmed" : "unrelated",
    sourceVersion: input.sourceVersion,
    needsReview: false as const,
    confirmedAt: new Date(input.occurredAt),
  } as const;
  const prepared: PreparedExternalRecordAssociationCommand = {
    trackerId: record.trackerId,
    association,
    event,
    outbox: {
      aggregateType: "event",
      aggregateId: event.id,
      targetPath: eventMirrorPath(event),
      payload: event,
    },
  };

  try {
    await store.commitAtomically(prepared);
  } catch (error) {
    if (postgresErrorCode(error) !== "23505") throw error;
    const concurrent = await store.findEventByCommandId(input.commandId);
    if (!concurrent || !commandMatchesEvent(input, record, concurrent)) {
      throw new AssociationCommandConflictError();
    }
    return resultFromEvent(concurrent, true);
  }

  return resultFromEvent(event, false);
}
