import "server-only";

import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type { PlanChangeDecisionCommand } from "@/domain/ai-analysis";
import { applyAcceptedPlanChange } from "@/domain/plan-change";
import { localDateInTimeZone } from "@/domain/planning-time";
import {
  type PlanChangeProposal,
  type PlanVersion,
  schemaVersion,
  trackerEventSchema,
  type TrackerEvent,
} from "@/domain/schemas";
import type { PreparedAiAnalysisContext } from "@/server/integrations/ai/context";
import { eventMirrorPath, planVersionMirrorPath } from "@/server/mirror/path";

export type PlanChangeDecisionRecord = {
  id: string;
  trackerId: string;
  trackerKey: string;
  proposalId: string;
  decision: "accepted" | "rejected";
  basePlanVersionId: string;
  timelineHeadPlanVersionId: string;
  contextVersion: "1";
  contextHash: string;
  contextRevision: number;
  safetyLevel: "green" | "yellow" | "red";
  effectiveFrom: string | null;
  appliedPlanVersion: PlanVersion | null;
  decidedAt: Date;
  event: TrackerEvent;
};

export type PlanChangeProposalRecord = {
  trackerId: string;
  trackerKey: string;
  planningTimeZone: string;
  proposal: PlanChangeProposal;
  status: PlanChangeProposal["status"];
  contextVersion: "1";
  contextHash: string;
  contextRevision: number;
  basePlanVersionId: string;
  timelineHeadPlanVersionId: string;
  safetyLevel: "green" | "yellow" | "red";
};

type PreparedOutbox = {
  aggregateType: "event" | "plan_version";
  aggregateId: string;
  targetPath: string;
  payload: Record<string, unknown>;
};

export type PreparedPlanChangeDecision = {
  type: "accept" | "reject";
  trackerId: string;
  proposalId: string;
  expectedContextRevision: number;
  decision: Omit<PlanChangeDecisionRecord, "event" | "appliedPlanVersion"> & {
    appliedPlanVersionId: string | null;
  };
  event: TrackerEvent;
  outboxes: PreparedOutbox[];
  plan: PlanVersion | null;
  taskInstances: Array<{
    taskDefinitionId: string;
    scheduledOn: string;
  }>;
};

export type PlanChangeDecisionStore = {
  findProposal(
    trackerKey: string,
    proposalId: string,
  ): Promise<PlanChangeProposalRecord | null>;
  findDecisionByCommandId(
    commandId: string,
  ): Promise<PlanChangeDecisionRecord | null>;
  findDecisionByProposalId(
    proposalId: string,
  ): Promise<PlanChangeDecisionRecord | null>;
  expireProposal(input: {
    trackerId: string;
    proposalId: string;
  }): Promise<boolean>;
  commitAtomically(command: PreparedPlanChangeDecision): Promise<void>;
};

export class PlanChangeDecisionNotFoundError extends Error {
  constructor() {
    super("plan_change_proposal_not_found");
    this.name = "PlanChangeDecisionNotFoundError";
  }
}

export class PlanChangeDecisionConflictError extends Error {
  constructor(message = "plan_change_decision_conflict") {
    super(message);
    this.name = "PlanChangeDecisionConflictError";
  }
}

export class PlanChangeNotApplicableError extends Error {
  constructor(message = "plan_change_not_applicable") {
    super(message);
    this.name = "PlanChangeNotApplicableError";
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return postgresErrorCode(error.cause);
  return undefined;
}

function postgresErrorConstraint(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("constraint" in error && typeof error.constraint === "string") {
    return error.constraint;
  }
  if ("cause" in error) return postgresErrorConstraint(error.cause);
  return undefined;
}

function isDecisionConcurrencyError(error: unknown) {
  const code = postgresErrorCode(error);
  if (code === "40001") return true;
  if (code !== "23505") return false;
  const constraint = postgresErrorConstraint(error);
  return (
    constraint === "plan_change_decisions_pkey" ||
    constraint === "plan_change_decisions_proposal_unique"
  );
}

function nextLocalDate(localDate: string) {
  const value = new Date(`${localDate}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function stablePlanVersionId(commandId: string) {
  const bytes = createHash("sha256")
    .update(`ak-tracker:plan-change:${commandId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function contextMatches(
  record: PlanChangeProposalRecord,
  context: PreparedAiAnalysisContext,
) {
  return (
    record.contextVersion === context.contextVersion &&
    record.contextHash === context.contextHash &&
    record.contextRevision === context.contextRevision &&
    record.basePlanVersionId === context.basePlanVersionId &&
    record.timelineHeadPlanVersionId === context.timelineHeadPlanVersionId &&
    record.safetyLevel === context.safetyLevel
  );
}

function decisionEvent(
  record: PlanChangeProposalRecord,
  input: PlanChangeDecisionCommand,
  now: Date,
  payload: Record<string, unknown>,
) {
  return trackerEventSchema.parse({
    schemaVersion,
    id: input.commandId,
    trackerKey: record.trackerKey,
    kind: "plan_change_decision",
    occurredAt: input.occurredAt,
    recordedAt: now.toISOString(),
    occurredTimeZone: input.occurredTimeZone,
    occurredUtcOffsetMinutes: input.occurredUtcOffsetMinutes,
    localDate: localDateInTimeZone(input.occurredAt, record.planningTimeZone),
    idempotencyKey: input.commandId,
    payload,
    provenance: { source: "user" },
  });
}

function commandMatchesDecision(
  decision: PlanChangeDecisionRecord,
  input: PlanChangeDecisionCommand,
) {
  return (
    decision.id === input.commandId &&
    decision.proposalId === input.proposalId &&
    decision.decision === input.decision &&
    decision.event.idempotencyKey === input.commandId &&
    decision.event.occurredAt === input.occurredAt &&
    decision.event.occurredTimeZone === input.occurredTimeZone &&
    decision.event.occurredUtcOffsetMinutes ===
      input.occurredUtcOffsetMinutes &&
    isDeepStrictEqual(decision.event.payload.decision, input.decision)
  );
}

function resultFromDecision(
  decision: PlanChangeDecisionRecord,
  replayed: boolean,
  conflict: boolean,
) {
  const affectedDates = decision.appliedPlanVersion
    ? [
        ...new Set(
          decision.appliedPlanVersion.tasks
            .filter(
              (task) =>
                decision.effectiveFrom !== null &&
                task.scheduledDate >= decision.effectiveFrom,
            )
            .map((task) => task.scheduledDate),
        ),
      ].sort()
    : [];
  return {
    commandId: decision.id,
    proposalId: decision.proposalId,
    replayed,
    conflict,
    status: decision.decision,
    appliedPlanVersion: decision.appliedPlanVersion
      ? {
          id: decision.appliedPlanVersion.id,
          version: decision.appliedPlanVersion.version,
          effectiveFrom: decision.appliedPlanVersion.effectiveFrom,
        }
      : null,
    affectedDates,
  } as const;
}

async function expiredResult(
  store: PlanChangeDecisionStore,
  record: PlanChangeProposalRecord,
  commandId: string,
) {
  const concurrent = await store.findDecisionByProposalId(record.proposal.id);
  if (concurrent) return resultFromDecision(concurrent, true, true);
  const expired = await store.expireProposal({
    trackerId: record.trackerId,
    proposalId: record.proposal.id,
  });
  if (!expired) {
    const decided = await store.findDecisionByProposalId(record.proposal.id);
    if (decided) return resultFromDecision(decided, true, true);
  }
  return {
    commandId,
    proposalId: record.proposal.id,
    replayed: false,
    conflict: false,
    status: "expired" as const,
    appliedPlanVersion: null,
    affectedDates: [],
  };
}

export async function executePlanChangeDecision(
  store: PlanChangeDecisionStore,
  prepareContext: (
    trackerKey: string,
    now: Date,
  ) => Promise<PreparedAiAnalysisContext>,
  input: PlanChangeDecisionCommand & { trackerKey: string },
  now = new Date(),
) {
  const existingCommand = await store.findDecisionByCommandId(input.commandId);
  if (existingCommand) {
    if (!commandMatchesDecision(existingCommand, input)) {
      throw new PlanChangeDecisionConflictError("idempotency_conflict");
    }
    return resultFromDecision(existingCommand, true, false);
  }

  const record = await store.findProposal(input.trackerKey, input.proposalId);
  if (!record) throw new PlanChangeDecisionNotFoundError();
  const existingProposalDecision = await store.findDecisionByProposalId(
    input.proposalId,
  );
  if (existingProposalDecision) {
    return resultFromDecision(existingProposalDecision, true, true);
  }
  if (record.status === "expired") {
    return expiredResult(store, record, input.commandId);
  }
  if (record.status !== "proposed") {
    throw new PlanChangeDecisionConflictError();
  }

  let context: PreparedAiAnalysisContext;
  try {
    context = await prepareContext(input.trackerKey, now);
  } catch {
    return expiredResult(store, record, input.commandId);
  }
  if (!contextMatches(record, context)) {
    return expiredResult(store, record, input.commandId);
  }

  const baseDecision = {
    id: input.commandId,
    trackerId: record.trackerId,
    trackerKey: record.trackerKey,
    proposalId: record.proposal.id,
    decision: input.decision,
    basePlanVersionId: context.basePlanVersionId,
    timelineHeadPlanVersionId: context.timelineHeadPlanVersionId,
    contextVersion: context.contextVersion,
    contextHash: context.contextHash,
    contextRevision: context.contextRevision,
    safetyLevel: context.safetyLevel,
    decidedAt: now,
  } as const;

  let prepared: PreparedPlanChangeDecision;
  if (input.decision === "rejected") {
    const event = decisionEvent(record, input, now, {
      proposalId: record.proposal.id,
      decision: "rejected",
      basePlanVersionId: context.basePlanVersionId,
      status: "rejected",
      appliedPlanVersionId: null,
      effectiveFrom: null,
    });
    prepared = {
      type: "reject",
      trackerId: record.trackerId,
      proposalId: record.proposal.id,
      expectedContextRevision: context.contextRevision,
      decision: {
        ...baseDecision,
        decision: "rejected",
        effectiveFrom: null,
        appliedPlanVersionId: null,
      },
      event,
      outboxes: [
        {
          aggregateType: "event",
          aggregateId: event.id,
          targetPath: eventMirrorPath(event),
          payload: event,
        },
      ],
      plan: null,
      taskInstances: [],
    };
  } else {
    if (
      context.safetyLevel === "red" ||
      record.proposal.safetyLevel === "red" ||
      record.proposal.operations.length === 0
    ) {
      throw new PlanChangeNotApplicableError();
    }
    if (context.basePlanVersionId !== context.timelineHeadPlanVersionId) {
      throw new PlanChangeNotApplicableError("future_plan_version_exists");
    }
    const effectiveFrom = nextLocalDate(context.contextThrough);
    let plan: PlanVersion;
    try {
      plan = applyAcceptedPlanChange(
        context.basePlan,
        { ...record.proposal, status: "accepted" },
        {
          id: stablePlanVersionId(input.commandId),
          version: context.timelineHeadPlan.version + 1,
          effectiveFrom,
          createdAt: now.toISOString(),
        },
      );
    } catch {
      return expiredResult(store, record, input.commandId);
    }
    const event = decisionEvent(record, input, now, {
      proposalId: record.proposal.id,
      decision: "accepted",
      basePlanVersionId: context.basePlanVersionId,
      status: "accepted",
      appliedPlanVersionId: plan.id,
      effectiveFrom,
    });
    prepared = {
      type: "accept",
      trackerId: record.trackerId,
      proposalId: record.proposal.id,
      expectedContextRevision: context.contextRevision,
      decision: {
        ...baseDecision,
        decision: "accepted",
        effectiveFrom,
        appliedPlanVersionId: plan.id,
      },
      event,
      outboxes: [
        {
          aggregateType: "event",
          aggregateId: event.id,
          targetPath: eventMirrorPath(event),
          payload: event,
        },
        {
          aggregateType: "plan_version",
          aggregateId: plan.id,
          targetPath: planVersionMirrorPath(plan),
          payload: plan,
        },
      ],
      plan,
      taskInstances: plan.tasks
        .filter((task) => task.scheduledDate >= effectiveFrom)
        .map((task) => ({
          taskDefinitionId: task.id,
          scheduledOn: task.scheduledDate,
        })),
    };
  }

  try {
    await store.commitAtomically(prepared);
  } catch (error) {
    if (!isDecisionConcurrencyError(error)) throw error;
    const concurrent =
      (await store.findDecisionByCommandId(input.commandId)) ??
      (await store.findDecisionByProposalId(input.proposalId));
    if (concurrent) {
      if (
        concurrent.id === input.commandId &&
        !commandMatchesDecision(concurrent, input)
      ) {
        throw new PlanChangeDecisionConflictError("idempotency_conflict");
      }
      return resultFromDecision(
        concurrent,
        true,
        concurrent.id !== input.commandId,
      );
    }
    return expiredResult(store, record, input.commandId);
  }

  const saved = await store.findDecisionByCommandId(input.commandId);
  if (!saved) throw new Error("plan_change_decision_not_persisted");
  return resultFromDecision(saved, false, false);
}
