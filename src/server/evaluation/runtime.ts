import "server-only";

import {
  buildEvaluationDecisionDocument,
  buildEvaluationEvidenceSnapshot,
  buildEvaluationResultDocument,
  evaluationDecisionDocumentSchema,
  evaluationDecisionInputSchema,
  evaluationDecisionSafety,
  deriveEvaluationTargetDate,
  evaluationPageDtoSchema,
  evaluationResultAnswersSchema,
  evaluationResultDocumentSchema,
  evaluationSessionSnapshotSchema,
  type CreateEvaluationSessionCommand,
  type CreateEvaluationDecisionCommand,
  type CreateEvaluationResultCommand,
  type EvaluationDecisionDocument,
  type EvaluationPageDto,
  type EvaluationResultDocument,
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
    aiContextRevision: number;
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

export type PreparedEvaluationResult = {
  trackerId: string;
  expectedContextRevision: number;
  result: EvaluationResultDocument;
  event: TrackerEvent;
  outbox: {
    aggregateType: "event";
    aggregateId: string;
    targetPath: string;
    payload: Record<string, unknown>;
  };
};

export type PreparedEvaluationDecision = {
  trackerId: string;
  expectedContextRevision: number;
  decision: EvaluationDecisionDocument;
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
  findResultBySessionId(
    trackerId: string,
    sessionId: string,
  ): Promise<EvaluationResultDocument | null>;
  findDecisionBySessionId(
    trackerId: string,
    sessionId: string,
  ): Promise<EvaluationDecisionDocument | null>;
  hasRedSafetySignal(trackerId: string, localDate: string): Promise<boolean>;
  expireSession(sessionId: string): Promise<boolean>;
  commitAtomically(prepared: PreparedEvaluationSession): Promise<void>;
  commitResultAtomically(prepared: PreparedEvaluationResult): Promise<void>;
  commitDecisionAtomically(prepared: PreparedEvaluationDecision): Promise<void>;
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

export class EvaluationResultNotEligibleError extends Error {
  constructor(message = "evaluation_result_not_eligible") {
    super(message);
    this.name = "EvaluationResultNotEligibleError";
  }
}

export class EvaluationDecisionNotEligibleError extends Error {
  constructor(message = "evaluation_decision_not_eligible") {
    super(message);
    this.name = "EvaluationDecisionNotEligibleError";
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

function resultFromEvent(
  event: TrackerEvent,
  trackerKey: string,
  command: CreateEvaluationResultCommand,
) {
  const parsed = evaluationResultDocumentSchema.safeParse(event.payload.result);
  if (
    event.kind !== "evaluation_result_recorded" ||
    event.trackerKey !== trackerKey ||
    event.idempotencyKey !== command.commandId ||
    event.occurredAt !== command.occurredAt ||
    event.occurredTimeZone !== command.occurredTimeZone ||
    event.occurredUtcOffsetMinutes !== command.occurredUtcOffsetMinutes ||
    !parsed.success ||
    parsed.data.id !== command.commandId ||
    parsed.data.sessionId !== command.sessionId ||
    JSON.stringify(evaluationResultAnswersSchema.parse(command.answers)) !==
      JSON.stringify(
        evaluationResultAnswersSchema.parse({
          goalCompletion: parsed.data.goalCompletion,
          sides: parsed.data.sides,
          nextStageIntent: parsed.data.nextStageIntent,
          ...(parsed.data.note === undefined ? {} : { note: parsed.data.note }),
        }),
      )
  ) {
    throw new EvaluationCommandConflictError();
  }
  return parsed.data;
}

function decisionFromEvent(
  event: TrackerEvent,
  trackerKey: string,
  command: CreateEvaluationDecisionCommand,
) {
  const parsed = evaluationDecisionDocumentSchema.safeParse(
    event.payload.decision,
  );
  if (
    event.kind !== "evaluation_decision_recorded" ||
    event.trackerKey !== trackerKey ||
    event.idempotencyKey !== command.commandId ||
    event.occurredAt !== command.occurredAt ||
    event.occurredTimeZone !== command.occurredTimeZone ||
    event.occurredUtcOffsetMinutes !== command.occurredUtcOffsetMinutes ||
    !parsed.success ||
    parsed.data.id !== command.commandId ||
    parsed.data.sessionId !== command.sessionId ||
    JSON.stringify(evaluationDecisionInputSchema.parse(command.decision)) !==
      JSON.stringify(
        evaluationDecisionInputSchema.parse({
          weeklyConfirmations: parsed.data.weeklyConfirmations,
          branch: parsed.data.branch,
          ...(parsed.data.note === undefined ? {} : { note: parsed.data.note }),
        }),
      )
  ) {
    throw new EvaluationCommandConflictError();
  }
  return parsed.data;
}

function pageState(input: {
  context: EvaluationContext;
  currentDate: string;
  session: EvaluationSessionRecord | null;
  result: EvaluationResultDocument | null;
  decision: EvaluationDecisionDocument | null;
  hasRedSafetySignal: boolean;
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
      result: input.result,
      decision: input.decision,
    });
  }
  if (input.session) {
    const safety = evaluationDecisionSafety(
      input.session.snapshot,
      input.hasRedSafetySignal,
    );
    return evaluationPageDtoSchema.parse({
      ...common,
      state: "opened",
      session: { ...input.session.snapshot, status: "open" },
      result: input.result,
      decision: input.decision,
      resultSubmission: {
        allowed: input.result === null && !input.hasRedSafetySignal,
        blockedReason:
          input.result !== null
            ? "already_recorded"
            : input.hasRedSafetySignal
              ? "red_safety"
              : null,
      },
      decisionSubmission: {
        allowed: input.result !== null && input.decision === null,
        blockedReason:
          input.result === null
            ? "result_required"
            : input.decision !== null
              ? "already_recorded"
              : null,
        allowedBranches: safety.allowedBranches,
        progressBlockedReason: safety.progressBlockedReason,
      },
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
    const [result, decision, hasRedSafetySignal] = session
      ? await Promise.all([
          store.findResultBySessionId(context.tracker.id, session.snapshot.id),
          store.findDecisionBySessionId(
            context.tracker.id,
            session.snapshot.id,
          ),
          store.hasRedSafetySignal(context.tracker.id, currentDate),
        ])
      : [null, null, false];
    return {
      context,
      currentDate,
      session,
      result,
      decision,
      hasRedSafetySignal,
    };
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
        result: null,
        decision: null,
        hasRedSafetySignal: false,
      });
    },

    async submitResult(
      trackerKey: string,
      command: CreateEvaluationResultCommand,
    ) {
      const existingEvent = await store.findEventByCommandId(command.commandId);
      if (existingEvent) {
        resultFromEvent(existingEvent, trackerKey, command);
        return pageState(await current(trackerKey));
      }
      const state = await current(trackerKey);
      if (
        !state.session ||
        state.session.status !== "open" ||
        state.session.snapshot.id !== command.sessionId
      ) {
        throw new EvaluationResultNotEligibleError();
      }
      if (state.result) return pageState(state);
      if (state.hasRedSafetySignal) {
        throw new EvaluationResultNotEligibleError("red_safety");
      }
      const submittedAt = now();
      const result = buildEvaluationResultDocument({
        id: command.commandId,
        sessionId: command.sessionId,
        trackerKey,
        kind: state.session.snapshot.kind,
        submittedAt: submittedAt.toISOString(),
        submittedLocalDate: state.currentDate,
        basePlanVersionId: state.session.snapshot.basePlanVersion.id,
        timelineHeadPlanVersionId:
          state.session.snapshot.timelineHeadPlanVersion.id,
        answers: command.answers,
      });
      const event = trackerEventSchema.parse({
        schemaVersion,
        id: command.commandId,
        trackerKey,
        kind: "evaluation_result_recorded",
        occurredAt: command.occurredAt,
        recordedAt: submittedAt.toISOString(),
        occurredTimeZone: command.occurredTimeZone,
        occurredUtcOffsetMinutes: command.occurredUtcOffsetMinutes,
        localDate: result.submittedLocalDate,
        idempotencyKey: command.commandId,
        payload: { result },
        provenance: { source: "user" },
      });
      try {
        await store.commitResultAtomically({
          trackerId: state.context.tracker.id,
          expectedContextRevision: state.context.tracker.aiContextRevision,
          result,
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
          throw new EvaluationResultNotEligibleError(
            "evaluation_result_context_changed",
          );
        }
        if (postgresErrorCode(error) !== "23505") throw error;
        const canonical = await store.findResultBySessionId(
          state.context.tracker.id,
          command.sessionId,
        );
        if (!canonical) throw new EvaluationCommandConflictError();
        return pageState({ ...state, result: canonical });
      }
      return pageState({ ...state, result });
    },

    async submitDecision(
      trackerKey: string,
      command: CreateEvaluationDecisionCommand,
    ) {
      const existingEvent = await store.findEventByCommandId(command.commandId);
      if (existingEvent) {
        decisionFromEvent(existingEvent, trackerKey, command);
        return pageState(await current(trackerKey));
      }
      const state = await current(trackerKey);
      if (
        !state.session ||
        state.session.status !== "open" ||
        state.session.snapshot.id !== command.sessionId ||
        !state.result
      ) {
        throw new EvaluationDecisionNotEligibleError();
      }
      if (state.decision) return pageState(state);
      const safety = evaluationDecisionSafety(
        state.session.snapshot,
        state.hasRedSafetySignal,
      );
      if (!safety.allowedBranches.includes(command.decision.branch)) {
        throw new EvaluationDecisionNotEligibleError(
          safety.progressBlockedReason ?? "evaluation_decision_safety_blocked",
        );
      }
      const decidedAt = now();
      let decision: EvaluationDecisionDocument;
      try {
        decision = buildEvaluationDecisionDocument({
          id: command.commandId,
          sessionId: command.sessionId,
          resultId: state.result.id,
          trackerKey,
          decidedAt: decidedAt.toISOString(),
          decidedLocalDate: state.currentDate,
          basePlanVersionId: state.session.snapshot.basePlanVersion.id,
          timelineHeadPlanVersionId:
            state.session.snapshot.timelineHeadPlanVersion.id,
          snapshotWeeks: state.session.snapshot.weeks,
          input: command.decision,
        });
      } catch {
        throw new EvaluationDecisionNotEligibleError(
          "evaluation_weeks_changed",
        );
      }
      const event = trackerEventSchema.parse({
        schemaVersion,
        id: command.commandId,
        trackerKey,
        kind: "evaluation_decision_recorded",
        occurredAt: command.occurredAt,
        recordedAt: decidedAt.toISOString(),
        occurredTimeZone: command.occurredTimeZone,
        occurredUtcOffsetMinutes: command.occurredUtcOffsetMinutes,
        localDate: state.currentDate,
        idempotencyKey: command.commandId,
        payload: { decision },
        provenance: { source: "user" },
      });
      try {
        await store.commitDecisionAtomically({
          trackerId: state.context.tracker.id,
          expectedContextRevision: state.context.tracker.aiContextRevision,
          decision,
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
          throw new EvaluationDecisionNotEligibleError(
            "evaluation_decision_context_changed",
          );
        }
        if (postgresErrorCode(error) !== "23505") throw error;
        const canonical = await store.findDecisionBySessionId(
          state.context.tracker.id,
          command.sessionId,
        );
        if (!canonical) throw new EvaluationCommandConflictError();
        return pageState({ ...state, decision: canonical });
      }
      return pageState({ ...state, decision });
    },
  };
}
