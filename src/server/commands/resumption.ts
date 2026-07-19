import "server-only";

import { and, desc, eq, lte } from "drizzle-orm";

import {
  resumptionAssessmentSnapshotSchema,
  type ResumptionAssessmentSnapshot,
} from "@/domain/resumption";
import { planVersionSchema, trackerEventSchema } from "@/domain/schemas";
import { getDatabase } from "@/server/db/client";
import {
  events,
  githubSyncOutbox,
  planVersions,
  resumptionAssessments,
  resumptionDecisions,
  taskInstances,
  trackers,
} from "@/server/db/schema";
import { buildResumptionAssessmentSnapshot } from "@/server/resumption/build-assessment";

import type {
  PreparedResumptionCommand,
  ResumptionDecisionStore,
} from "./resumption-core";

type Database = ReturnType<typeof getDatabase>;

function eventValues(
  trackerId: string,
  event: PreparedResumptionCommand["event"],
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

export function createNeonResumptionDecisionStore(
  database: Database = getDatabase(),
): ResumptionDecisionStore {
  return {
    async findTracker(key) {
      const [row] = await database
        .select({
          id: trackers.id,
          key: trackers.key,
          planningTimeZone: trackers.planningTimeZone,
        })
        .from(trackers)
        .where(and(eq(trackers.key, key), eq(trackers.active, true)))
        .limit(1);
      return row ?? null;
    },

    async findEventByCommandId(commandId) {
      const [row] = await database
        .select({ document: events.document })
        .from(events)
        .where(eq(events.idempotencyKey, commandId))
        .limit(1);
      return row ? trackerEventSchema.parse(row.document) : null;
    },

    async findAssessment(trackerId, assessmentId) {
      const [row] = await database
        .select({
          snapshot: resumptionAssessments.snapshot,
          status: resumptionAssessments.status,
          decision: resumptionAssessments.decision,
          decidedAt: resumptionAssessments.decidedAt,
          appliedPlanVersionId: resumptionAssessments.appliedPlanVersionId,
        })
        .from(resumptionAssessments)
        .where(
          and(
            eq(resumptionAssessments.id, assessmentId),
            eq(resumptionAssessments.trackerId, trackerId),
          ),
        )
        .limit(1);
      if (!row) return null;
      const status = row.status;
      if (
        status !== "pending" &&
        status !== "kept_original" &&
        status !== "shifted" &&
        status !== "expired"
      ) {
        throw new Error("resumption_assessment_status_invalid");
      }
      const decision = row.decision;
      if (
        decision !== null &&
        decision !== "keep_original" &&
        decision !== "shift"
      ) {
        throw new Error("resumption_assessment_decision_invalid");
      }
      return {
        snapshot: resumptionAssessmentSnapshotSchema.parse(row.snapshot),
        status,
        decision,
        decidedAt: row.decidedAt?.toISOString() ?? null,
        appliedPlanVersionId: row.appliedPlanVersionId,
      };
    },

    async findPlanVersion(trackerId, planVersionId) {
      const [row] = await database
        .select({ document: planVersions.document })
        .from(planVersions)
        .where(
          and(
            eq(planVersions.id, planVersionId),
            eq(planVersions.trackerId, trackerId),
          ),
        )
        .limit(1);
      return row ? planVersionSchema.parse(row.document) : null;
    },

    async findEffectivePlanVersion(trackerId, localDate) {
      const [row] = await database
        .select({ document: planVersions.document })
        .from(planVersions)
        .where(
          and(
            eq(planVersions.trackerId, trackerId),
            lte(planVersions.effectiveFrom, localDate),
          ),
        )
        .orderBy(desc(planVersions.effectiveFrom), desc(planVersions.version))
        .limit(1);
      return row ? planVersionSchema.parse(row.document) : null;
    },

    async nextPlanVersion(trackerId) {
      const [row] = await database
        .select({ version: planVersions.version })
        .from(planVersions)
        .where(eq(planVersions.trackerId, trackerId))
        .orderBy(desc(planVersions.version))
        .limit(1);
      return (row?.version ?? 0) + 1;
    },

    async buildReplacementAssessment(existing, id, createdAt) {
      return buildResumptionAssessmentSnapshot(
        {
          id,
          trackerId: await trackerIdForSnapshot(existing.snapshot, database),
          trackerKey: existing.snapshot.trackerKey,
          planningTimeZone: existing.snapshot.planningTimeZone,
          triggerType: existing.snapshot.trigger.type,
          triggerId: existing.snapshot.trigger.id,
          startDate: existing.snapshot.trigger.startDate,
          endDate: existing.snapshot.trigger.endDate,
          createdAt,
        },
        database,
      );
    },

    async commitAtomically(command) {
      const eventInsert = database
        .insert(events)
        .values(eventValues(command.trackerId, command.event));
      const outboxValues = command.outboxes.map((outbox) => ({
        ...outbox,
      }));

      if (command.type === "keep") {
        await database.batch([
          database.insert(resumptionDecisions).values({
            id: command.event.idempotencyKey,
            trackerId: command.trackerId,
            assessmentId: command.assessmentId,
            basePlanVersionId: String(command.event.payload.basePlanVersionId),
            decision: "keep_original",
            decidedAt: command.decidedAt,
          }),
          database
            .update(resumptionAssessments)
            .set({
              status: "kept_original",
              decision: "keep_original",
              decidedAt: command.decidedAt,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(resumptionAssessments.id, command.assessmentId),
                eq(resumptionAssessments.status, "pending"),
              ),
            ),
          eventInsert,
          database.insert(githubSyncOutbox).values(outboxValues),
        ]);
        return;
      }

      if (command.type === "shift") {
        const coreStatements = [
          database.insert(planVersions).values({
            id: command.plan.id,
            trackerId: command.trackerId,
            version: command.plan.version,
            effectiveFrom: command.plan.effectiveFrom,
            document: command.plan,
            createdAt: new Date(command.plan.createdAt),
          }),
          database.insert(resumptionDecisions).values({
            id: command.event.idempotencyKey,
            trackerId: command.trackerId,
            assessmentId: command.assessmentId,
            basePlanVersionId: String(command.event.payload.basePlanVersionId),
            decision: "shift",
            appliedPlanVersionId: command.plan.id,
            decidedAt: command.decidedAt,
          }),
          database
            .update(resumptionAssessments)
            .set({
              status: "shifted",
              decision: "shift",
              appliedPlanVersionId: command.plan.id,
              decidedAt: command.decidedAt,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(resumptionAssessments.id, command.assessmentId),
                eq(resumptionAssessments.status, "pending"),
              ),
            ),
          eventInsert,
          database.insert(githubSyncOutbox).values(outboxValues),
        ] as const;
        if (command.taskInstances.length === 0) {
          await database.batch(coreStatements);
          return;
        }
        await database.batch([
          coreStatements[0],
          database.insert(taskInstances).values(
            command.taskInstances.map((task) => ({
              trackerId: command.trackerId,
              planVersionId: command.plan.id,
              taskDefinitionId: task.taskDefinitionId,
              scheduledOn: task.scheduledOn,
            })),
          ),
          coreStatements[2],
          coreStatements[3],
          coreStatements[4],
          coreStatements[1],
        ]);
        return;
      }

      const replacement = command.replacement;
      await database.batch([
        database
          .update(resumptionAssessments)
          .set({ status: "expired", updatedAt: new Date() })
          .where(
            and(
              eq(resumptionAssessments.id, command.assessmentId),
              eq(resumptionAssessments.status, "pending"),
            ),
          ),
        database.insert(resumptionAssessments).values({
          id: replacement.snapshot.id,
          trackerId: command.trackerId,
          triggerType: replacement.snapshot.trigger.type,
          triggerId: replacement.snapshot.trigger.id,
          basePlanVersionId: replacement.snapshot.basePlanVersion.id,
          planningTimeZone: replacement.snapshot.planningTimeZone,
          snapshot: replacement.snapshot,
        }),
        eventInsert,
        database.insert(githubSyncOutbox).values(outboxValues),
        database
          .insert(events)
          .values(eventValues(command.trackerId, replacement.event)),
        database.insert(githubSyncOutbox).values(replacement.outbox),
      ]);
    },
  };
}

async function trackerIdForSnapshot(
  snapshot: ResumptionAssessmentSnapshot,
  database: Database,
) {
  const [row] = await database
    .select({ id: trackers.id })
    .from(trackers)
    .where(
      and(eq(trackers.key, snapshot.trackerKey), eq(trackers.active, true)),
    )
    .limit(1);
  if (!row) throw new Error("tracker_not_found");
  return row.id;
}
