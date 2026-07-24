import "server-only";

import { and, eq, sql } from "drizzle-orm";

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
  planVersions,
  taskInstances,
  trackers,
} from "@/server/db/schema";

import type {
  PlanChangeDecisionRecord,
  PlanChangeDecisionStore,
  PreparedPlanChangeDecision,
} from "./plan-change-decision-core";

type Database = ReturnType<typeof getDatabase>;

function proposalStatus(value: string) {
  if (
    value === "proposed" ||
    value === "accepted" ||
    value === "rejected" ||
    value === "expired"
  ) {
    return value;
  }
  throw new Error("plan_change_proposal_status_invalid");
}

function contextVersion(value: string | null): "1" {
  if (value === "1") return value;
  throw new Error("plan_change_context_version_invalid");
}

function safetyLevel(value: string) {
  if (value === "green" || value === "yellow" || value === "red") {
    return value;
  }
  throw new Error("plan_change_safety_invalid");
}

function decisionType(value: string): "accepted" | "rejected" {
  if (value === "accepted" || value === "rejected") return value;
  throw new Error("plan_change_decision_invalid");
}

function eventValues(
  trackerId: string,
  event: PreparedPlanChangeDecision["event"],
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

export function createNeonPlanChangeDecisionStore(
  database: Database = getDatabase(),
): PlanChangeDecisionStore {
  async function findDecision(where: ReturnType<typeof eq>) {
    const [row] = await database
      .select({
        decision: planChangeDecisions,
        trackerKey: trackers.key,
        event: events.document,
      })
      .from(planChangeDecisions)
      .innerJoin(trackers, eq(planChangeDecisions.trackerId, trackers.id))
      .innerJoin(events, eq(events.id, planChangeDecisions.id))
      .where(where)
      .limit(1);
    if (!row) return null;
    const applied = row.decision.appliedPlanVersionId
      ? await database
          .select({ document: planVersions.document })
          .from(planVersions)
          .where(eq(planVersions.id, row.decision.appliedPlanVersionId))
          .limit(1)
      : [];
    const parsedSafety = safetyLevel(row.decision.safetyLevel);
    if (parsedSafety === "red" && row.decision.decision === "accepted") {
      throw new Error("plan_change_red_acceptance_invalid");
    }
    return {
      id: row.decision.id,
      trackerId: row.decision.trackerId,
      trackerKey: row.trackerKey,
      proposalId: row.decision.proposalId,
      decision: decisionType(row.decision.decision),
      basePlanVersionId: row.decision.basePlanVersionId,
      timelineHeadPlanVersionId: row.decision.timelineHeadPlanVersionId,
      contextVersion: contextVersion(row.decision.contextVersion),
      contextHash: row.decision.contextHash,
      contextRevision: row.decision.contextRevision,
      safetyLevel: parsedSafety,
      effectiveFrom: row.decision.effectiveFrom,
      appliedPlanVersion: applied[0]
        ? planVersionSchema.parse(applied[0].document)
        : null,
      decidedAt: row.decision.decidedAt,
      event: trackerEventSchema.parse(row.event),
    } satisfies PlanChangeDecisionRecord;
  }

  return {
    async findProposal(trackerKey, proposalId) {
      const [row] = await database
        .select({
          trackerId: trackers.id,
          trackerKey: trackers.key,
          planningTimeZone: trackers.planningTimeZone,
          proposal: planChangeProposals,
        })
        .from(planChangeProposals)
        .innerJoin(trackers, eq(planChangeProposals.trackerId, trackers.id))
        .where(
          and(
            eq(trackers.key, trackerKey),
            eq(trackers.active, true),
            eq(planChangeProposals.id, proposalId),
          ),
        )
        .limit(1);
      if (!row) return null;
      const proposal = planChangeProposalSchema.parse(row.proposal.document);
      const parsedStatus = proposalStatus(row.proposal.status);
      return {
        trackerId: row.trackerId,
        trackerKey: row.trackerKey,
        planningTimeZone: row.planningTimeZone,
        proposal: { ...proposal, status: parsedStatus },
        status: parsedStatus,
        contextVersion: contextVersion(row.proposal.contextVersion),
        contextHash: row.proposal.contextHash ?? "",
        contextRevision: row.proposal.contextRevision,
        basePlanVersionId: row.proposal.basePlanVersionId,
        timelineHeadPlanVersionId: row.proposal.timelineHeadPlanVersionId ?? "",
        safetyLevel: safetyLevel(row.proposal.safetyLevel),
      };
    },
    findDecisionByCommandId(commandId) {
      return findDecision(eq(planChangeDecisions.id, commandId));
    },
    findDecisionByProposalId(proposalId) {
      return findDecision(eq(planChangeDecisions.proposalId, proposalId));
    },
    async expireProposal(input) {
      const rows = await database
        .update(planChangeProposals)
        .set({ status: "expired" })
        .where(
          and(
            eq(planChangeProposals.id, input.proposalId),
            eq(planChangeProposals.trackerId, input.trackerId),
            eq(planChangeProposals.status, "proposed"),
          ),
        )
        .returning({ id: planChangeProposals.id });
      return rows.length === 1;
    },
    async commitAtomically(command) {
      const guard = database.execute(sql`
        select assert_plan_change_decision_context(
          ${command.trackerId}::uuid,
          ${command.proposalId}::uuid,
          ${command.decision.contextVersion}::text,
          ${command.decision.contextHash}::text,
          ${command.expectedContextRevision}::integer,
          ${command.decision.basePlanVersionId}::uuid,
          ${command.decision.timelineHeadPlanVersionId}::uuid,
          ${command.decision.safetyLevel}::text
        )
      `);
      const decisionInsert = database.insert(planChangeDecisions).values({
        id: command.decision.id,
        trackerId: command.trackerId,
        proposalId: command.proposalId,
        decision: command.decision.decision,
        basePlanVersionId: command.decision.basePlanVersionId,
        timelineHeadPlanVersionId: command.decision.timelineHeadPlanVersionId,
        contextVersion: command.decision.contextVersion,
        contextHash: command.decision.contextHash,
        contextRevision: command.decision.contextRevision,
        safetyLevel: command.decision.safetyLevel,
        effectiveFrom: command.decision.effectiveFrom,
        appliedPlanVersionId: command.decision.appliedPlanVersionId,
        decidedAt: command.decision.decidedAt,
      });
      const proposalUpdate = database
        .update(planChangeProposals)
        .set({
          status: command.decision.decision,
          decidedAt: command.decision.decidedAt,
          appliedPlanVersionId: command.decision.appliedPlanVersionId,
        })
        .where(
          and(
            eq(planChangeProposals.id, command.proposalId),
            eq(planChangeProposals.trackerId, command.trackerId),
            eq(planChangeProposals.status, "proposed"),
          ),
        );
      const eventInsert = database
        .insert(events)
        .values(eventValues(command.trackerId, command.event));
      const outboxInsert = database
        .insert(githubSyncOutbox)
        .values(command.outboxes);

      if (command.type === "reject" || !command.plan) {
        await database.batch([
          guard,
          decisionInsert,
          proposalUpdate,
          eventInsert,
          outboxInsert,
        ]);
        return;
      }

      const planInsert = database.insert(planVersions).values({
        id: command.plan.id,
        trackerId: command.trackerId,
        version: command.plan.version,
        effectiveFrom: command.plan.effectiveFrom,
        document: command.plan,
        createdAt: new Date(command.plan.createdAt),
      });
      const common = [
        guard,
        planInsert,
        decisionInsert,
        proposalUpdate,
        eventInsert,
        outboxInsert,
      ] as const;
      if (command.taskInstances.length === 0) {
        await database.batch(common);
        return;
      }
      await database.batch([
        common[0],
        common[1],
        database.insert(taskInstances).values(
          command.taskInstances.map((task) => ({
            trackerId: command.trackerId,
            planVersionId: command.plan!.id,
            taskDefinitionId: task.taskDefinitionId,
            scheduledOn: task.scheduledOn,
          })),
        ),
        common[2],
        common[3],
        common[4],
        common[5],
      ]);
    },
  };
}
