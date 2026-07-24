import "server-only";

import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type { PlanVersionRollbackCommand } from "@/domain/ai-analysis";
import { localDateInTimeZone } from "@/domain/planning-time";
import {
  type PlanVersion,
  planVersionSchema,
  schemaVersion,
  trackerEventSchema,
  type TrackerEvent,
} from "@/domain/schemas";
import { eventMirrorPath, planVersionMirrorPath } from "@/server/mirror/path";

export type PlanVersionRollbackSource = {
  trackerId: string;
  trackerKey: string;
  planningTimeZone: string;
  proposalId: string;
  decisionId: string;
  decision: "accepted" | "rejected";
  targetBasePlan: PlanVersion;
  sourceAppliedPlan: PlanVersion | null;
  timelineHeadPlan: PlanVersion;
};

export type PlanVersionRollbackRecord = {
  id: string;
  trackerId: string;
  trackerKey: string;
  proposalId: string;
  sourceDecisionId: string;
  sourceAppliedPlanVersionId: string;
  targetBasePlanVersionId: string;
  newPlanVersion: PlanVersion;
  effectiveFrom: string;
  decidedAt: Date;
  event: TrackerEvent;
};

type PreparedOutbox = {
  aggregateType: "event" | "plan_version";
  aggregateId: string;
  targetPath: string;
  payload: Record<string, unknown>;
};

export type PreparedPlanVersionRollback = {
  trackerId: string;
  proposalId: string;
  rollback: Omit<
    PlanVersionRollbackRecord,
    "trackerKey" | "newPlanVersion" | "event"
  > & {
    newPlanVersionId: string;
  };
  expectedTimelineHeadPlanVersionId: string;
  plan: PlanVersion;
  taskInstances: Array<{
    taskDefinitionId: string;
    scheduledOn: string;
  }>;
  event: TrackerEvent;
  outboxes: PreparedOutbox[];
};

export type PlanVersionRollbackStore = {
  findSource(
    trackerKey: string,
    proposalId: string,
  ): Promise<PlanVersionRollbackSource | null>;
  findRollbackByCommandId(
    commandId: string,
  ): Promise<PlanVersionRollbackRecord | null>;
  findRollbackByAppliedPlanVersionId(
    planVersionId: string,
  ): Promise<PlanVersionRollbackRecord | null>;
  commitAtomically(command: PreparedPlanVersionRollback): Promise<void>;
};

export class PlanVersionRollbackNotFoundError extends Error {
  constructor() {
    super("plan_version_rollback_source_not_found");
    this.name = "PlanVersionRollbackNotFoundError";
  }
}

export class PlanVersionRollbackNotApplicableError extends Error {
  constructor(message = "plan_version_rollback_not_applicable") {
    super(message);
    this.name = "PlanVersionRollbackNotApplicableError";
  }
}

export class PlanVersionRollbackConflictError extends Error {
  constructor(message = "plan_version_rollback_conflict") {
    super(message);
    this.name = "PlanVersionRollbackConflictError";
  }
}

function nextLocalDate(localDate: string) {
  const value = new Date(`${localDate}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function stableRollbackPlanVersionId(commandId: string) {
  const bytes = createHash("sha256")
    .update(`ak-tracker:plan-version-rollback:${commandId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function rollbackAffectedDates(
  source: PlanVersion,
  target: PlanVersion,
  effectiveFrom: string,
) {
  const dates = new Set(
    [...source.tasks, ...target.tasks]
      .map((task) => task.scheduledDate)
      .filter((date) => date >= effectiveFrom),
  );
  const tasksOn = (plan: PlanVersion, date: string) =>
    plan.tasks
      .filter((task) => task.scheduledDate === date)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  return [...dates]
    .filter(
      (date) =>
        !isDeepStrictEqual(tasksOn(source, date), tasksOn(target, date)),
    )
    .sort();
}

function resultFromRollback(
  record: PlanVersionRollbackRecord,
  sourceAppliedPlan: PlanVersion,
  replayed: boolean,
  conflict: boolean,
) {
  return {
    commandId: record.id,
    proposalId: record.proposalId,
    replayed,
    conflict,
    status: "rolled_back" as const,
    blockedReason: null,
    newPlanVersion: {
      id: record.newPlanVersion.id,
      version: record.newPlanVersion.version,
      effectiveFrom: record.newPlanVersion.effectiveFrom,
    },
    affectedDates: rollbackAffectedDates(
      sourceAppliedPlan,
      record.newPlanVersion,
      record.effectiveFrom,
    ),
  };
}

function commandMatches(
  record: PlanVersionRollbackRecord,
  input: PlanVersionRollbackCommand,
) {
  return (
    record.id === input.commandId &&
    record.proposalId === input.proposalId &&
    record.event.idempotencyKey === input.commandId &&
    record.event.occurredAt === input.occurredAt &&
    record.event.occurredTimeZone === input.occurredTimeZone &&
    record.event.occurredUtcOffsetMinutes === input.occurredUtcOffsetMinutes
  );
}

function postgresField(
  error: unknown,
  field: "code" | "constraint",
): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record[field] === "string") return record[field];
  return postgresField(record.cause, field);
}

function isRollbackConcurrencyError(error: unknown) {
  if (postgresField(error, "code") === "40001") return true;
  if (postgresField(error, "code") !== "23505") return false;
  return [
    "plan_version_rollbacks_pkey",
    "plan_version_rollbacks_source_applied_unique",
  ].includes(postgresField(error, "constraint") ?? "");
}

export async function executePlanVersionRollback(
  store: PlanVersionRollbackStore,
  input: PlanVersionRollbackCommand & { trackerKey: string },
  now = new Date(),
) {
  const existingCommand = await store.findRollbackByCommandId(input.commandId);
  if (existingCommand) {
    if (!commandMatches(existingCommand, input)) {
      throw new PlanVersionRollbackConflictError("idempotency_conflict");
    }
    const source = await store.findSource(input.trackerKey, input.proposalId);
    if (!source?.sourceAppliedPlan)
      throw new PlanVersionRollbackNotFoundError();
    return resultFromRollback(
      existingCommand,
      source.sourceAppliedPlan,
      true,
      false,
    );
  }

  const source = await store.findSource(input.trackerKey, input.proposalId);
  if (!source) throw new PlanVersionRollbackNotFoundError();
  if (source.decision !== "accepted" || !source.sourceAppliedPlan) {
    throw new PlanVersionRollbackNotApplicableError();
  }
  const existingSource = await store.findRollbackByAppliedPlanVersionId(
    source.sourceAppliedPlan.id,
  );
  if (existingSource) {
    return resultFromRollback(
      existingSource,
      source.sourceAppliedPlan,
      true,
      true,
    );
  }
  if (source.timelineHeadPlan.id !== source.sourceAppliedPlan.id) {
    return {
      commandId: input.commandId,
      proposalId: input.proposalId,
      replayed: false,
      conflict: false,
      status: "blocked" as const,
      blockedReason: "later_plan_version" as const,
      newPlanVersion: null,
      affectedDates: [],
    };
  }

  const planDate = localDateInTimeZone(
    now.toISOString(),
    source.planningTimeZone,
  );
  const effectiveFrom = nextLocalDate(planDate);
  const plan = planVersionSchema.parse({
    ...source.targetBasePlan,
    id: stableRollbackPlanVersionId(input.commandId),
    version: source.timelineHeadPlan.version + 1,
    effectiveFrom,
    createdAt: now.toISOString(),
    createdBy: "user",
    source: undefined,
  });
  const event = trackerEventSchema.parse({
    schemaVersion,
    id: input.commandId,
    trackerKey: source.trackerKey,
    kind: "plan_version_rollback",
    occurredAt: input.occurredAt,
    recordedAt: now.toISOString(),
    occurredTimeZone: input.occurredTimeZone,
    occurredUtcOffsetMinutes: input.occurredUtcOffsetMinutes,
    localDate: localDateInTimeZone(input.occurredAt, source.planningTimeZone),
    idempotencyKey: input.commandId,
    payload: {
      proposalId: source.proposalId,
      sourceAppliedPlanVersionId: source.sourceAppliedPlan.id,
      targetBasePlanVersionId: source.targetBasePlan.id,
      newPlanVersionId: plan.id,
      effectiveFrom,
    },
    provenance: { source: "user" },
  });
  const prepared: PreparedPlanVersionRollback = {
    trackerId: source.trackerId,
    proposalId: source.proposalId,
    expectedTimelineHeadPlanVersionId: source.sourceAppliedPlan.id,
    rollback: {
      id: input.commandId,
      trackerId: source.trackerId,
      proposalId: source.proposalId,
      sourceDecisionId: source.decisionId,
      sourceAppliedPlanVersionId: source.sourceAppliedPlan.id,
      targetBasePlanVersionId: source.targetBasePlan.id,
      newPlanVersionId: plan.id,
      effectiveFrom,
      decidedAt: now,
    },
    plan,
    taskInstances: plan.tasks
      .filter((task) => task.scheduledDate >= effectiveFrom)
      .map((task) => ({
        taskDefinitionId: task.id,
        scheduledOn: task.scheduledDate,
      })),
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
  };

  try {
    await store.commitAtomically(prepared);
  } catch (error) {
    if (!isRollbackConcurrencyError(error)) throw error;
    const concurrent =
      (await store.findRollbackByCommandId(input.commandId)) ??
      (await store.findRollbackByAppliedPlanVersionId(
        source.sourceAppliedPlan.id,
      ));
    if (concurrent) {
      if (
        concurrent.id === input.commandId &&
        !commandMatches(concurrent, input)
      ) {
        throw new PlanVersionRollbackConflictError("idempotency_conflict");
      }
      return resultFromRollback(
        concurrent,
        source.sourceAppliedPlan,
        true,
        concurrent.id !== input.commandId,
      );
    }
    return {
      commandId: input.commandId,
      proposalId: input.proposalId,
      replayed: false,
      conflict: false,
      status: "blocked" as const,
      blockedReason: "later_plan_version" as const,
      newPlanVersion: null,
      affectedDates: [],
    };
  }

  const saved = await store.findRollbackByCommandId(input.commandId);
  if (!saved) throw new Error("plan_version_rollback_not_persisted");
  return resultFromRollback(saved, source.sourceAppliedPlan, false, false);
}
