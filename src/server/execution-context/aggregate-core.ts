import {
  executionAlternativeDtoSchema,
  executionContextTodaySchema,
  type ExecutionAlternativeDocument,
  type ExecutionDayConditions,
} from "@/domain/execution-context";

export type ExecutionContextAggregateRow = {
  id: string;
  kind: "travel" | "equipment_limited";
  startDate: string;
  endDate: string;
};

export type ExecutionDayDecisionAggregateRow = {
  localDate: string;
  conditions: ExecutionDayConditions;
  selection: { optionId: string; optionVersion: number } | null;
  safetyDisposition: "normal" | "stop_reassess";
};

export type ExecutionContextAggregateStore = {
  findPendingResumption?(): Promise<{
    id: string;
    triggerType: "execution_context" | "pause";
    recommendedEffectiveFrom: string;
    basePlanVersion: { id: string; version: number };
    status: "pending";
  } | null>;
  findRelevantPause(targetDate: string): Promise<{
    id: string;
    reason: "illness" | "acute_symptom" | "red_feedback" | "other";
    note: string | null;
    startedOn: string;
    endedOn: string | null;
  } | null>;
  findRelevantContext(
    targetDate: string,
  ): Promise<ExecutionContextAggregateRow | null>;
  findDayDecision(
    contextId: string,
    targetDate: string,
  ): Promise<ExecutionDayDecisionAggregateRow | null>;
  findEffectiveAlternatives(
    targetDate: string,
  ): Promise<ExecutionAlternativeDocument[]>;
};

export async function getExecutionContextToday(
  store: ExecutionContextAggregateStore,
  targetDate: string,
  hasRedFeedback: boolean | Promise<boolean>,
) {
  const [pause, context, resumption] = await Promise.all([
    store.findRelevantPause(targetDate),
    store.findRelevantContext(targetDate),
    store.findPendingResumption?.() ?? Promise.resolve(null),
  ]);
  if (!context) {
    return executionContextTodaySchema.parse({
      pause: pause
        ? {
            ...pause,
            status: pause.endedOn ? "pending_resume_assessment" : "active",
          }
        : null,
      context: null,
      day: null,
      alternatives: [],
      resumption,
      safety: resumption
        ? { blocked: true, reason: "resumption" }
        : pause
          ? { blocked: true, reason: "pause" }
          : { blocked: false, reason: null },
    });
  }

  const status = targetDate < context.startDate ? "upcoming" : "active";
  if (status === "upcoming") {
    return executionContextTodaySchema.parse({
      pause: pause
        ? {
            ...pause,
            status: pause.endedOn ? "pending_resume_assessment" : "active",
          }
        : null,
      context: { ...context, status },
      day: null,
      alternatives: [],
      resumption,
      safety: resumption
        ? { blocked: true, reason: "resumption" }
        : pause
          ? { blocked: true, reason: "pause" }
          : { blocked: false, reason: null },
    });
  }

  const day = await store.findDayDecision(context.id, targetDate);
  const resolvedHasRedFeedback = await hasRedFeedback;
  const conditionReason =
    day?.conditions.healthStatus === "illness"
      ? "illness"
      : day?.conditions.healthStatus === "acute_symptom"
        ? "acute_symptom"
        : null;
  const reason = resumption
    ? "resumption"
    : pause
      ? "pause"
      : resolvedHasRedFeedback
        ? "red_feedback"
        : conditionReason;
  const blocked = reason !== null;
  const alternatives = blocked
    ? []
    : (await store.findEffectiveAlternatives(targetDate)).map((document) =>
        executionAlternativeDtoSchema.parse({
          id: document.id,
          optionKey: document.optionKey,
          version: document.version,
          kind: document.kind,
          title: document.title,
          summary: document.summary,
          estimatedMinutes: document.estimatedMinutes,
          steps: document.steps,
        }),
      );

  return executionContextTodaySchema.parse({
    pause: pause
      ? {
          ...pause,
          status: pause.endedOn ? "pending_resume_assessment" : "active",
        }
      : null,
    context: { ...context, status },
    day,
    alternatives,
    resumption,
    safety: { blocked, reason },
  });
}
