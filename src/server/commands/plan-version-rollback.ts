import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { planVersionSchema, trackerEventSchema } from "@/domain/schemas";
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
          decisionId: planChangeDecisions.id,
          decision: planChangeDecisions.decision,
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
        decisionId: row.decisionId,
        decision: decisionType(row.decision),
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
      const statements = [guard, planInsert] as const;
      if (command.taskInstances.length === 0) {
        await database.batch([
          statements[0],
          statements[1],
          rollbackInsert,
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
        eventInsert,
        outboxInsert,
      ]);
    },
  };
}
