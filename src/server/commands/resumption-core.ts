import { localDateInTimeZone } from "@/domain/planning-time";
import {
  buildShiftedPlanVersion,
  type ResumptionAssessmentSnapshot,
  type ResumptionDecisionCommand,
} from "@/domain/resumption";
import {
  schemaVersion,
  trackerEventSchema,
  type PlanVersion,
  type TrackerEvent,
} from "@/domain/schemas";
import { eventMirrorPath, planVersionMirrorPath } from "@/server/mirror/path";

export type ResumptionAssessmentRecord = {
  snapshot: ResumptionAssessmentSnapshot;
  status: "pending" | "kept_original" | "shifted" | "expired";
  decision: "keep_original" | "shift" | null;
  decidedAt: string | null;
  appliedPlanVersionId: string | null;
};

type PreparedOutbox = {
  aggregateType: "event" | "plan_version";
  aggregateId: string;
  targetPath: string;
  payload: Record<string, unknown>;
};

type PreparedBase = {
  trackerId: string;
  assessmentId: string;
  decidedAt: Date;
  event: TrackerEvent;
  outboxes: PreparedOutbox[];
};

export type PreparedResumptionCommand =
  | (PreparedBase & { type: "keep" })
  | (PreparedBase & {
      type: "shift";
      plan: PlanVersion;
      taskInstances: Array<{
        taskDefinitionId: string;
        scheduledOn: string;
      }>;
    })
  | (PreparedBase & {
      type: "expire";
      replacement: {
        snapshot: ResumptionAssessmentSnapshot;
        event: TrackerEvent;
        outbox: PreparedOutbox;
      };
    });

export type ResumptionDecisionStore = {
  findTracker(key: string): Promise<{
    id: string;
    key: string;
    planningTimeZone: string;
  } | null>;
  findEventByCommandId(commandId: string): Promise<TrackerEvent | null>;
  findAssessment(
    trackerId: string,
    assessmentId: string,
  ): Promise<ResumptionAssessmentRecord | null>;
  findPlanVersion(
    trackerId: string,
    planVersionId: string,
  ): Promise<PlanVersion | null>;
  findEffectivePlanVersion(
    trackerId: string,
    localDate: string,
  ): Promise<PlanVersion | null>;
  findPlanTimelineHead(trackerId: string): Promise<PlanVersion | null>;
  nextPlanVersion(trackerId: string): Promise<number>;
  buildReplacementAssessment(
    existing: ResumptionAssessmentRecord,
    replacementAssessmentId: string,
    createdAt: Date,
  ): Promise<ResumptionAssessmentSnapshot>;
  commitAtomically(command: PreparedResumptionCommand): Promise<void>;
};

export class ResumptionTrackerNotFoundError extends Error {
  constructor() {
    super("tracker_not_found");
    this.name = "ResumptionTrackerNotFoundError";
  }
}

export class ResumptionAssessmentNotFoundError extends Error {
  constructor() {
    super("resumption_assessment_not_found");
    this.name = "ResumptionAssessmentNotFoundError";
  }
}

export class ResumptionAssessmentStateError extends Error {
  constructor(message = "resumption_assessment_not_pending") {
    super(message);
    this.name = "ResumptionAssessmentStateError";
  }
}

function samePlanVersionPointer(
  plan: PlanVersion,
  pointer: ResumptionAssessmentSnapshot["timelineHead"],
) {
  return (
    plan.id === pointer.id &&
    plan.version === pointer.version &&
    plan.effectiveFrom === pointer.effectiveFrom
  );
}

export class ResumptionCommandConflictError extends Error {
  constructor() {
    super("idempotency_conflict");
    this.name = "ResumptionCommandConflictError";
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return postgresErrorCode(error.cause);
  return undefined;
}

function eventFor(
  tracker: { key: string; planningTimeZone: string },
  command: ResumptionDecisionCommand,
  kind: TrackerEvent["kind"],
  payload: Record<string, unknown>,
  now: Date,
  id = command.commandId,
) {
  return trackerEventSchema.parse({
    schemaVersion,
    id,
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
    idempotencyKey: id,
    payload,
    provenance: { source: "user" },
  });
}

function eventOutbox(event: TrackerEvent): PreparedOutbox {
  return {
    aggregateType: "event",
    aggregateId: event.id,
    targetPath: eventMirrorPath(event),
    payload: event,
  };
}

function resultFromEvent(event: TrackerEvent, replayed: boolean) {
  const status = event.payload.status;
  if (
    status !== "kept_original" &&
    status !== "shifted" &&
    status !== "expired"
  ) {
    throw new ResumptionCommandConflictError();
  }
  return {
    commandId: event.idempotencyKey,
    replayed,
    status,
    assessmentId: String(event.payload.assessmentId),
    appliedPlanVersionId:
      typeof event.payload.appliedPlanVersionId === "string"
        ? event.payload.appliedPlanVersionId
        : null,
    replacementAssessmentId:
      typeof event.payload.replacementAssessmentId === "string"
        ? event.payload.replacementAssessmentId
        : null,
  } as const;
}

function commandMatchesEvent(
  event: TrackerEvent,
  command: ResumptionDecisionCommand,
  trackerKey: string,
) {
  return (
    event.id === command.commandId &&
    event.idempotencyKey === command.commandId &&
    event.trackerKey === trackerKey &&
    (event.kind === "resumption_decision" ||
      event.kind === "resumption_assessment_expired") &&
    event.occurredAt === command.occurredAt &&
    event.occurredTimeZone === command.occurredTimeZone &&
    event.occurredUtcOffsetMinutes === command.occurredUtcOffsetMinutes &&
    event.payload.assessmentId === command.assessmentId &&
    event.payload.basePlanVersionId === command.basePlanVersionId &&
    event.payload.decision === command.decision &&
    (command.decision === "keep_original" ||
      (event.payload.effectiveFrom === command.effectiveFrom &&
        event.payload.requestedPlanVersionId === command.newPlanVersionId))
  );
}

async function commitOrReplay(
  store: ResumptionDecisionStore,
  prepared: PreparedResumptionCommand,
  command: ResumptionDecisionCommand,
  trackerKey: string,
) {
  try {
    await store.commitAtomically(prepared);
    return false;
  } catch (error) {
    if (postgresErrorCode(error) !== "23505") throw error;
    const concurrent = await store.findEventByCommandId(command.commandId);
    if (!concurrent || !commandMatchesEvent(concurrent, command, trackerKey)) {
      throw new ResumptionCommandConflictError();
    }
    return true;
  }
}

export async function executeResumptionDecisionCommand(
  store: ResumptionDecisionStore,
  input: ResumptionDecisionCommand & { trackerKey: string },
  now = new Date(),
) {
  const tracker = await store.findTracker(input.trackerKey);
  if (!tracker) throw new ResumptionTrackerNotFoundError();

  const existingEvent = await store.findEventByCommandId(input.commandId);
  if (existingEvent) {
    if (!commandMatchesEvent(existingEvent, input, tracker.key)) {
      throw new ResumptionCommandConflictError();
    }
    return resultFromEvent(existingEvent, true);
  }

  const assessment = await store.findAssessment(tracker.id, input.assessmentId);
  if (!assessment) throw new ResumptionAssessmentNotFoundError();
  if (assessment.status !== "pending") {
    throw new ResumptionAssessmentStateError();
  }
  if (assessment.snapshot.basePlanVersion.id !== input.basePlanVersionId) {
    throw new ResumptionAssessmentStateError("resumption_base_plan_conflict");
  }

  const [effectivePlan, timelineHead] = await Promise.all([
    store.findEffectivePlanVersion(
      tracker.id,
      assessment.snapshot.recommendedEffectiveFrom,
    ),
    store.findPlanTimelineHead(tracker.id),
  ]);
  if (!effectivePlan || !timelineHead) {
    throw new ResumptionAssessmentStateError("resumption_base_plan_not_found");
  }

  if (
    effectivePlan.id !== assessment.snapshot.basePlanVersion.id ||
    !samePlanVersionPointer(timelineHead, assessment.snapshot.timelineHead)
  ) {
    const replacement = await store.buildReplacementAssessment(
      assessment,
      input.replacementAssessmentId,
      now,
    );
    const payload = {
      assessmentId: input.assessmentId,
      basePlanVersionId: input.basePlanVersionId,
      decision: input.decision,
      ...(input.decision === "shift"
        ? {
            effectiveFrom: input.effectiveFrom,
            requestedPlanVersionId: input.newPlanVersionId,
          }
        : {}),
      status: "expired",
      appliedPlanVersionId: null,
      replacementAssessmentId: replacement.id,
    };
    const event = eventFor(
      tracker,
      input,
      "resumption_assessment_expired",
      payload,
      now,
    );
    const replacementEvent = eventFor(
      tracker,
      input,
      "resumption_assessment_created",
      {
        assessmentId: replacement.id,
        triggerType: replacement.trigger.type,
        triggerId: replacement.trigger.id,
        basePlanVersionId: replacement.basePlanVersion.id,
        startDate: replacement.trigger.startDate,
        endDate: replacement.trigger.endDate,
      },
      now,
      replacement.id,
    );
    const prepared: PreparedResumptionCommand = {
      type: "expire",
      trackerId: tracker.id,
      assessmentId: assessment.snapshot.id,
      decidedAt: now,
      event,
      outboxes: [eventOutbox(event)],
      replacement: {
        snapshot: replacement,
        event: replacementEvent,
        outbox: eventOutbox(replacementEvent),
      },
    };
    const replayed = await commitOrReplay(store, prepared, input, tracker.key);
    return resultFromEvent(event, replayed);
  }

  if (input.decision === "keep_original") {
    const payload = {
      assessmentId: input.assessmentId,
      basePlanVersionId: input.basePlanVersionId,
      decision: input.decision,
      status: "kept_original",
      appliedPlanVersionId: null,
      replacementAssessmentId: null,
    };
    const event = eventFor(tracker, input, "resumption_decision", payload, now);
    const prepared: PreparedResumptionCommand = {
      type: "keep",
      trackerId: tracker.id,
      assessmentId: assessment.snapshot.id,
      decidedAt: now,
      event,
      outboxes: [eventOutbox(event)],
    };
    const replayed = await commitOrReplay(store, prepared, input, tracker.key);
    return resultFromEvent(event, replayed);
  }

  if (!assessment.snapshot.shiftAvailability.allowed) {
    throw new ResumptionAssessmentStateError("resumption_shift_not_available");
  }

  if (input.effectiveFrom !== assessment.snapshot.recommendedEffectiveFrom) {
    throw new ResumptionAssessmentStateError(
      "resumption_effective_date_invalid",
    );
  }
  const basePlan = await store.findPlanVersion(
    tracker.id,
    input.basePlanVersionId,
  );
  if (!basePlan) {
    throw new ResumptionAssessmentStateError("resumption_base_plan_not_found");
  }
  const plan = buildShiftedPlanVersion(basePlan, assessment.snapshot, {
    id: input.newPlanVersionId,
    version: await store.nextPlanVersion(tracker.id),
    createdAt: now.toISOString(),
  });
  const payload = {
    assessmentId: input.assessmentId,
    basePlanVersionId: input.basePlanVersionId,
    decision: input.decision,
    effectiveFrom: input.effectiveFrom,
    requestedPlanVersionId: input.newPlanVersionId,
    status: "shifted",
    appliedPlanVersionId: plan.id,
    replacementAssessmentId: null,
  };
  const event = eventFor(tracker, input, "resumption_decision", payload, now);
  const prepared: PreparedResumptionCommand = {
    type: "shift",
    trackerId: tracker.id,
    assessmentId: assessment.snapshot.id,
    decidedAt: now,
    event,
    outboxes: [
      eventOutbox(event),
      {
        aggregateType: "plan_version",
        aggregateId: plan.id,
        targetPath: planVersionMirrorPath(plan),
        payload: plan,
      },
    ],
    plan,
    taskInstances: assessment.snapshot.futureTasks.map((task) => ({
      taskDefinitionId: task.taskDefinitionId,
      scheduledOn:
        assessment.snapshot.shiftPreview.find(
          (preview) => preview.taskDefinitionId === task.taskDefinitionId,
        )?.to ?? task.scheduledOn,
    })),
  };
  const replayed = await commitOrReplay(store, prepared, input, tracker.key);
  return resultFromEvent(event, replayed);
}
