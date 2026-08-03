import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import {
  planChangeProposalSchema,
  planVersionSchema,
  trackerEventSchema,
} from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import {
  events,
  githubSyncOutbox,
  planChangeDecisions,
  planChangeProposals,
  planVersionRollbacks,
  planVersions,
  taskInstances,
  trackers,
} from "@/server/db/schema";
import { upsertAiAuditOutbox } from "@/server/mirror/ai-audit";

import type {
  PlanVersionRollbackRecord,
  PlanVersionRollbackStore,
  PreparedPlanVersionRollback,
} from "./plan-version-rollback-core";

type Database = ReturnType<typeof getDatabase>;

function decisionType(value: string): "accepted" | "rejected" {
  if (value === "accepted" || value === "rejected") return value;
  throw new Error("plan_change_decision_invalid");
}

function requiredAuditText(value: string | null, field: string) {
  if (value) return value;
  throw new Error(`plan_change_audit_${field}_missing`);
}

function eventValues(
  trackerId: string,
  event: PreparedPlanVersionRollback["event"],
) {
  return {
    id: event.id,
    trackerId,
    kind: event.kind,
    localDate: event.localDate,
    occurredAt: new Date(event.occurredAt),
    recordedAt: new Date(event.recordedAt),
    occurredTimeZone: event.occurredTimeZone,
    occurredUtcOffsetMinutes: event.occurredUtcOffsetMinutes,
    idempotencyKey: event.idempotencyKey,
    document: event,
  };
}

export function createNeonPlanVersionRollbackStore(
  database: Database = getDatabase(),
): PlanVersionRollbackStore {
  async function findRollback(where: ReturnType<typeof eq>) {
    const [row] = await database
      .select({
        rollback: planVersionRollbacks,
        trackerKey: trackers.key,
        plan: planVersions.document,
        event: events.document,
      })
      .from(planVersionRollbacks)
      .innerJoin(trackers, eq(planVersionRollbacks.trackerId, trackers.id))
      .innerJoin(
        planVersions,
        eq(planVersionRollbacks.newPlanVersionId, planVersions.id),
      )
      .innerJoin(events, eq(planVersionRollbacks.id, events.id))
      .where(where)
      .limit(1);
    if (!row) return null;
    return {
      id: row.rollback.id,
      trackerId: row.rollback.trackerId,
      trackerKey: row.trackerKey,
      proposalId: row.rollback.proposalId,
      sourceDecisionId: row.rollback.sourceDecisionId,
      sourceAppliedPlanVersionId: row.rollback.sourceAppliedPlanVersionId,
      targetBasePlanVersionId: row.rollback.targetBasePlanVersionId,
      newPlanVersion: planVersionSchema.parse(row.plan),
      effectiveFrom: row.rollback.effectiveFrom,
      decidedAt: row.rollback.decidedAt,
      event: trackerEventSchema.parse(row.event),
    } satisfies PlanVersionRollbackRecord;
  }

  return {
    async findSource(trackerKey, proposalId) {
      const [row] = await database
        .select({
          trackerId: trackers.id,
          trackerKey: trackers.key,
          planningTimeZone: trackers.planningTimeZone,
          proposalId: planChangeProposals.id,
          proposalDocument: planChangeProposals.document,
          analysisJobId: planChangeProposals.analysisJobId,
          model: planChangeProposals.model,
          contextVersion: planChangeProposals.contextVersion,
          contextHash: planChangeProposals.contextHash,
          contextRevision: planChangeProposals.contextRevision,
          contextFrom: planChangeProposals.contextFrom,
          contextThrough: planChangeProposals.contextThrough,
          proposalTimelineHeadPlanVersionId:
            planChangeProposals.timelineHeadPlanVersionId,
          decisionId: planChangeDecisions.id,
          decision: planChangeDecisions.decision,
          decisionDecidedAt: planChangeDecisions.decidedAt,
          decisionEffectiveFrom: planChangeDecisions.effectiveFrom,
          basePlanVersionId: planChangeDecisions.basePlanVersionId,
          appliedPlanVersionId: planChangeDecisions.appliedPlanVersionId,
        })
        .from(planChangeProposals)
        .innerJoin(trackers, eq(planChangeProposals.trackerId, trackers.id))
        .innerJoin(
          planChangeDecisions,
          eq(planChangeDecisions.proposalId, planChangeProposals.id),
        )
        .where(
          and(
            eq(trackers.key, trackerKey),
            eq(trackers.active, true),
            eq(planChangeProposals.id, proposalId),
          ),
        )
        .limit(1);
      if (!row) return null;
      const [base, applied, head] = await Promise.all([
        database
          .select({ document: planVersions.document })
          .from(planVersions)
          .where(eq(planVersions.id, row.basePlanVersionId))
          .limit(1),
        row.appliedPlanVersionId
          ? database
              .select({ document: planVersions.document })
              .from(planVersions)
              .where(eq(planVersions.id, row.appliedPlanVersionId))
              .limit(1)
          : Promise.resolve([]),
        database
          .select({ document: planVersions.document })
          .from(planVersions)
          .where(eq(planVersions.trackerId, row.trackerId))
          .orderBy(desc(planVersions.version))
          .limit(1),
      ]);
      if (!base[0] || !head[0])
        throw new Error("plan_version_rollback_plan_missing");
      return {
        trackerId: row.trackerId,
        trackerKey: row.trackerKey,
        planningTimeZone: row.planningTimeZone,
        proposalId: row.proposalId,
        proposal: {
          ...planChangeProposalSchema.parse(row.proposalDocument),
          status: "accepted",
        },
        analysisJobId: requiredAuditText(row.analysisJobId, "analysis_job_id"),
        model: requiredAuditText(row.model, "model"),
        contextVersion:
          row.contextVersion === "1" || row.contextVersion === "2"
            ? row.contextVersion
            : (() => {
                throw new Error("plan_change_context_version_invalid");
              })(),
        contextHash: requiredAuditText(row.contextHash, "context_hash"),
        contextRevision: row.contextRevision,
        contextFrom: requiredAuditText(row.contextFrom, "context_from"),
        contextThrough: requiredAuditText(
          row.contextThrough,
          "context_through",
        ),
        timelineHeadPlanVersionId: requiredAuditText(
          row.proposalTimelineHeadPlanVersionId,
          "timeline_head_plan_version_id",
        ),
        decisionId: row.decisionId,
        decision: decisionType(row.decision),
        decisionDecidedAt: row.decisionDecidedAt,
        decisionEffectiveFrom: row.decisionEffectiveFrom,
        targetBasePlan: planVersionSchema.parse(base[0].document),
        sourceAppliedPlan: applied[0]
          ? planVersionSchema.parse(applied[0].document)
          : null,
        timelineHeadPlan: planVersionSchema.parse(head[0].document),
      };
    },
    findRollbackByCommandId(commandId) {
      return findRollback(eq(planVersionRollbacks.id, commandId));
    },
    findRollbackByAppliedPlanVersionId(planVersionId) {
      return findRollback(
        eq(planVersionRollbacks.sourceAppliedPlanVersionId, planVersionId),
      );
    },
    async commitAtomically(command) {
      const guard = database.execute(sql`
        select assert_plan_version_rollback_context(
          ${command.trackerId}::uuid,
          ${command.proposalId}::uuid,
          ${command.rollback.sourceDecisionId}::uuid,
          ${command.rollback.sourceAppliedPlanVersionId}::uuid,
          ${command.rollback.targetBasePlanVersionId}::uuid,
          ${command.expectedTimelineHeadPlanVersionId}::uuid
        )
      `);
      const planInsert = database.insert(planVersions).values({
        id: command.plan.id,
        trackerId: command.trackerId,
        version: command.plan.version,
        effectiveFrom: command.plan.effectiveFrom,
        document: command.plan,
        createdAt: new Date(command.plan.createdAt),
      });
      const rollbackInsert = database.insert(planVersionRollbacks).values({
        id: command.rollback.id,
        trackerId: command.trackerId,
        proposalId: command.proposalId,
        sourceDecisionId: command.rollback.sourceDecisionId,
        sourceAppliedPlanVersionId: command.rollback.sourceAppliedPlanVersionId,
        targetBasePlanVersionId: command.rollback.targetBasePlanVersionId,
        newPlanVersionId: command.rollback.newPlanVersionId,
        effectiveFrom: command.rollback.effectiveFrom,
        decidedAt: command.rollback.decidedAt,
      });
      const eventInsert = database
        .insert(events)
        .values(eventValues(command.trackerId, command.event));
      const outboxInsert = database
        .insert(githubSyncOutbox)
        .values(command.outboxes);
      const proposalAuditUpsert = upsertAiAuditOutbox(
        database,
        command.proposalAuditOutbox,
        command.rollback.decidedAt,
      );
      const statements = [guard, planInsert] as const;
      if (command.taskInstances.length === 0) {
        await database.batch([
          statements[0],
          statements[1],
          rollbackInsert,
          proposalAuditUpsert,
          eventInsert,
          outboxInsert,
        ]);
        return;
      }
      await database.batch([
        statements[0],
        statements[1],
        database.insert(taskInstances).values(
          command.taskInstances.map((task) => ({
            trackerId: command.trackerId,
            planVersionId: command.plan.id,
            taskDefinitionId: task.taskDefinitionId,
            scheduledOn: task.scheduledOn,
          })),
        ),
        rollbackInsert,
        proposalAuditUpsert,
        eventInsert,
        outboxInsert,
      ]);
    },
  };
}
