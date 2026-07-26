import "server-only";

import {
  buildEvaluationEvidenceSnapshot,
  deriveEvaluationTargetDate,
  evaluationPageDtoSchema,
  evaluationSessionSnapshotSchema,
  type CreateEvaluationSessionCommand,
  type EvaluationPageDto,
  type EvaluationSessionSnapshot,
} from "@/domain/evaluation";
import { localDateInTimeZone } from "@/domain/planning-time";
import {
  schemaVersion,
  trackerEventSchema,
  type PlanVersion,
  type TrackerEvent,
} from "@/domain/schemas";
import { eventMirrorPath } from "@/server/mirror/path";

export type EvaluationContext = {
  tracker: {
    id: string;
    key: string;
    startedOn: string;
    planningTimeZone: string;
  };
  planVersions: PlanVersion[];
  timelineHeadPlanVersion: PlanVersion | null;
  basePlanVersion: PlanVersion | null;
  tasks: Parameters<typeof buildEvaluationEvidenceSnapshot>[0]["tasks"];
  feedbacks: Parameters<typeof buildEvaluationEvidenceSnapshot>[0]["feedbacks"];
  pauses: Parameters<typeof buildEvaluationEvidenceSnapshot>[0]["pauses"];
  contexts: Parameters<typeof buildEvaluationEvidenceSnapshot>[0]["contexts"];
  degradedDates: string[];
};

export type EvaluationSessionRecord = {
  snapshot: EvaluationSessionSnapshot;
  status: "open" | "expired";
};

export type PreparedEvaluationSession = {
  trackerId: string;
  snapshot: EvaluationSessionSnapshot;
  event: TrackerEvent;
  outbox: {
    aggregateType: "event";
    aggregateId: string;
    targetPath: string;
    payload: Record<string, unknown>;
  };
};

export type EvaluationStore = {
  loadContext(trackerKey: string): Promise<EvaluationContext | null>;
  findLatestSession(trackerId: string): Promise<EvaluationSessionRecord | null>;
  findEventByCommandId(commandId: string): Promise<TrackerEvent | null>;
  expireSession(sessionId: string): Promise<boolean>;
  commitAtomically(prepared: PreparedEvaluationSession): Promise<void>;
};

export class EvaluationTrackerNotFoundError extends Error {
  constructor() {
    super("tracker_not_found");
    this.name = "EvaluationTrackerNotFoundError";
  }
}

export class EvaluationNotEligibleError extends Error {
  constructor(message = "evaluation_not_eligible") {
    super(message);
    this.name = "EvaluationNotEligibleError";
  }
}

export class EvaluationCommandConflictError extends Error {
  constructor() {
    super("idempotency_conflict");
    this.name = "EvaluationCommandConflictError";
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return postgresErrorCode(error.cause);
  return undefined;
}

function snapshotFromEvent(
  event: TrackerEvent,
  trackerKey: string,
  command: CreateEvaluationSessionCommand,
) {
  const parsed = evaluationSessionSnapshotSchema.safeParse(
    event.payload.session,
  );
  if (
    event.kind !== "evaluation_session_created" ||
    event.trackerKey !== trackerKey ||
    event.idempotencyKey !== command.commandId ||
    event.occurredAt !== command.occurredAt ||
    event.occurredTimeZone !== command.occurredTimeZone ||
    event.occurredUtcOffsetMinutes !== command.occurredUtcOffsetMinutes ||
    !parsed.success ||
    parsed.data.id !== command.commandId ||
    parsed.data.kind !== command.kind
  ) {
    throw new EvaluationCommandConflictError();
  }
  return parsed.data;
}

function pageState(input: {
  context: EvaluationContext;
  currentDate: string;
  session: EvaluationSessionRecord | null;
}): EvaluationPageDto {
  if (
    !input.context.timelineHeadPlanVersion ||
    !input.context.basePlanVersion
  ) {
    return evaluationPageDtoSchema.parse({
      state: "unavailable",
      trackerKey: input.context.tracker.key,
      currentDate: input.currentDate,
      planningTimeZone: input.context.tracker.planningTimeZone,
      reason: "plan_not_found",
      session: null,
    });
  }
  const targetDate = deriveEvaluationTargetDate(
    input.context.timelineHeadPlanVersion,
  );
  if (!targetDate) {
    return evaluationPageDtoSchema.parse({
      state: "unavailable",
      trackerKey: input.context.tracker.key,
      currentDate: input.currentDate,
      planningTimeZone: input.context.tracker.planningTimeZone,
      reason: "target_not_defined",
      session: null,
    });
  }
  const common = {
    trackerKey: input.context.tracker.key,
    currentDate: input.currentDate,
    targetDate,
    planningTimeZone: input.context.tracker.planningTimeZone,
  };
  if (input.session?.status === "expired") {
    return evaluationPageDtoSchema.parse({
      ...common,
      state: "expired",
      canOpenReplacement: input.currentDate >= targetDate,
      session: { ...input.session.snapshot, status: "expired" },
    });
  }
  if (input.session) {
    return evaluationPageDtoSchema.parse({
      ...common,
      state: "opened",
      session: { ...input.session.snapshot, status: "open" },
    });
  }
  return evaluationPageDtoSchema.parse({
    ...common,
    state: input.currentDate < targetDate ? "before_target" : "eligible",
    session: null,
  });
}

export function createEvaluationRuntime({
  store,
  now = () => new Date(),
}: {
  store: EvaluationStore;
  now?: () => Date;
}) {
  async function current(trackerKey: string) {
    const context = await store.loadContext(trackerKey);
    if (!context) throw new EvaluationTrackerNotFoundError();
    const currentDate = localDateInTimeZone(
      now().toISOString(),
      context.tracker.planningTimeZone,
    );
    let session = await store.findLatestSession(context.tracker.id);
    if (
      session?.status === "open" &&
      context.timelineHeadPlanVersion !== null &&
      session.snapshot.timelineHeadPlanVersion.id !==
        context.timelineHeadPlanVersion.id
    ) {
      await store.expireSession(session.snapshot.id);
      session = { ...session, status: "expired" };
    }
    return { context, currentDate, session };
  }

  return {
    async load(trackerKey: string) {
      return pageState(await current(trackerKey));
    },

    async create(trackerKey: string, command: CreateEvaluationSessionCommand) {
      const existing = await store.findEventByCommandId(command.commandId);
      if (existing) {
        snapshotFromEvent(existing, trackerKey, command);
        return pageState(await current(trackerKey));
      }
      if (command.kind === "stage") {
        throw new EvaluationNotEligibleError(
          "evaluation_stage_target_not_defined",
        );
      }
      const state = await current(trackerKey);
      if (
        !state.context.timelineHeadPlanVersion ||
        !state.context.basePlanVersion
      ) {
        throw new EvaluationNotEligibleError("evaluation_plan_not_found");
      }
      const targetDate = deriveEvaluationTargetDate(
        state.context.timelineHeadPlanVersion,
      );
      if (!targetDate || state.currentDate < targetDate) {
        throw new EvaluationNotEligibleError();
      }
      if (state.session?.status === "open") {
        return pageState(state);
      }
      const createdAt = now();
      const snapshot = buildEvaluationEvidenceSnapshot({
        id: command.commandId,
        trackerKey,
        kind: command.kind,
        triggerDate: state.currentDate,
        trackerStartedOn: state.context.tracker.startedOn,
        planningTimeZone: state.context.tracker.planningTimeZone,
        createdAt: createdAt.toISOString(),
        basePlanVersion: state.context.basePlanVersion,
        timelineHeadPlanVersion: state.context.timelineHeadPlanVersion,
        planVersions: state.context.planVersions,
        tasks: state.context.tasks,
        feedbacks: state.context.feedbacks,
        pauses: state.context.pauses,
        contexts: state.context.contexts,
        degradedDates: state.context.degradedDates,
      });
      const event = trackerEventSchema.parse({
        schemaVersion,
        id: command.commandId,
        trackerKey,
        kind: "evaluation_session_created",
        occurredAt: command.occurredAt,
        recordedAt: createdAt.toISOString(),
        occurredTimeZone: command.occurredTimeZone,
        occurredUtcOffsetMinutes: command.occurredUtcOffsetMinutes,
        localDate: state.currentDate,
        idempotencyKey: command.commandId,
        payload: { session: snapshot },
        provenance: { source: "user" },
      });
      try {
        await store.commitAtomically({
          trackerId: state.context.tracker.id,
          snapshot,
          event,
          outbox: {
            aggregateType: "event",
            aggregateId: event.id,
            targetPath: eventMirrorPath(event),
            payload: event,
          },
        });
      } catch (error) {
        if (postgresErrorCode(error) === "40001") {
          throw new EvaluationNotEligibleError("evaluation_timeline_changed");
        }
        if (postgresErrorCode(error) !== "23505") throw error;
        const concurrent = await store.findEventByCommandId(command.commandId);
        if (!concurrent) throw new EvaluationCommandConflictError();
        snapshotFromEvent(concurrent, trackerKey, command);
      }
      return pageState({
        ...state,
        session: { snapshot, status: "open" },
      });
    },
  };
}
