import "server-only";

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import {
  evaluationDecisionDocumentSchema,
  evaluationResultDocumentSchema,
  evaluationSessionSnapshotSchema,
} from "@/domain/evaluation";
import { garminActivitySummarySchema } from "@/domain/garmin";
import {
  planVersionSchema,
  taskActualSchema,
  trackerEventSchema,
} from "@/domain/schemas";
import { kneeCheckInEventPayloadSchema } from "@/modules/knee-rehab/check-in";
import { getDatabase } from "@/server/db/client";
import {
  evaluationSessions,
  evaluationResults,
  evaluationDecisions,
  events,
  executionContexts,
  executionDayDecisions,
  executionPauses,
  externalRecordLinks,
  externalRecords,
  githubSyncOutbox,
  planVersions,
  taskInstances,
  trackers,
} from "@/server/db/schema";
import { xunjiTrainSchema } from "@/server/integrations/xunji/contracts";

import { createEvaluationRuntime, type EvaluationStore } from "./runtime";

type Database = ReturnType<typeof getDatabase>;

function minDate(left: string, right: string) {
  return left < right ? left : right;
}

export function createNeonEvaluationStore(
  database: Database = getDatabase(),
): EvaluationStore {
  return {
    async loadContext(trackerKey) {
      const [tracker] = await database
        .select({
          id: trackers.id,
          key: trackers.key,
          startedOn: trackers.startedOn,
          planningTimeZone: trackers.planningTimeZone,
          aiContextRevision: trackers.aiContextRevision,
        })
        .from(trackers)
        .where(and(eq(trackers.key, trackerKey), eq(trackers.active, true)))
        .limit(1);
      if (!tracker) return null;

      const versionRows = await database
        .select({
          id: planVersions.id,
          version: planVersions.version,
          effectiveFrom: planVersions.effectiveFrom,
          document: planVersions.document,
        })
        .from(planVersions)
        .where(eq(planVersions.trackerId, tracker.id))
        .orderBy(asc(planVersions.effectiveFrom), asc(planVersions.version));
      const versions = versionRows.map((row) =>
        planVersionSchema.parse(row.document),
      );
      const timelineHead =
        [...versions].sort((left, right) => right.version - left.version)[0] ??
        null;
      const targetDate = timelineHead?.tasks.reduce<string | null>(
        (latest, task) =>
          latest === null || task.scheduledDate > latest
            ? task.scheduledDate
            : latest,
        null,
      );
      if (!timelineHead || !targetDate) {
        return {
          tracker,
          planVersions: versions,
          timelineHeadPlanVersion: timelineHead,
          basePlanVersion: null,
          tasks: [],
          feedbacks: [],
          pauses: [],
          contexts: [],
          degradedDates: [],
        };
      }
      const basePlan =
        [...versions]
          .filter((version) => version.effectiveFrom <= targetDate)
          .sort(
            (left, right) =>
              right.effectiveFrom.localeCompare(left.effectiveFrom) ||
              right.version - left.version,
          )[0] ?? null;

      const [taskRows, feedbackRows, pauseRows, contextRows, dayRows, links] =
        await Promise.all([
          database
            .select({
              id: taskInstances.id,
              localDate: taskInstances.scheduledOn,
              planVersionId: taskInstances.planVersionId,
              status: taskInstances.status,
              confirmedByUser: taskInstances.confirmedByUser,
              actual: taskInstances.actualData,
            })
            .from(taskInstances)
            .where(
              and(
                eq(taskInstances.trackerId, tracker.id),
                gte(taskInstances.scheduledOn, tracker.startedOn),
                lte(taskInstances.scheduledOn, targetDate),
              ),
            ),
          database
            .select({ localDate: events.localDate, document: events.document })
            .from(events)
            .where(
              and(
                eq(events.trackerId, tracker.id),
                eq(events.kind, "symptom_check_in"),
                gte(events.localDate, tracker.startedOn),
                lte(events.localDate, targetDate),
              ),
            ),
          database
            .select({
              startDate: executionPauses.startedOn,
              endedOn: executionPauses.endedOn,
            })
            .from(executionPauses)
            .where(
              and(
                eq(executionPauses.trackerId, tracker.id),
                lte(executionPauses.startedOn, targetDate),
              ),
            ),
          database
            .select({
              kind: executionContexts.kind,
              startDate: executionContexts.startDate,
              endDate: executionContexts.endDate,
              endedOn: executionContexts.endedOn,
            })
            .from(executionContexts)
            .where(
              and(
                eq(executionContexts.trackerId, tracker.id),
                lte(executionContexts.startDate, targetDate),
              ),
            ),
          database
            .select({
              localDate: executionDayDecisions.localDate,
              selectedAlternativeId:
                executionDayDecisions.selectedAlternativeId,
              safetyDisposition: executionDayDecisions.safetyDisposition,
            })
            .from(executionDayDecisions)
            .where(
              and(
                eq(executionDayDecisions.trackerId, tracker.id),
                gte(executionDayDecisions.localDate, tracker.startedOn),
                lte(executionDayDecisions.localDate, targetDate),
              ),
            ),
          database
            .select({
              id: externalRecords.id,
              provider: externalRecords.provider,
              kind: externalRecords.kind,
              localDate: externalRecords.localDate,
              sourceVersion: externalRecords.sourceVersion,
              document: externalRecords.document,
              taskInstanceId: externalRecordLinks.taskInstanceId,
              linkSourceVersion: externalRecordLinks.sourceVersion,
              linkStatus: externalRecordLinks.status,
              needsReview: externalRecordLinks.needsReview,
            })
            .from(externalRecords)
            .innerJoin(
              externalRecordLinks,
              eq(externalRecordLinks.externalRecordId, externalRecords.id),
            )
            .where(
              and(
                eq(externalRecords.trackerId, tracker.id),
                gte(externalRecords.localDate, tracker.startedOn),
                lte(externalRecords.localDate, targetDate),
                inArray(externalRecords.kind, [
                  "activity",
                  "strength_training",
                ]),
              ),
            ),
        ]);

      const taskDates = new Map(
        taskRows.map((task) => [task.id, task.localDate]),
      );
      const sourceByTask = new Map<
        string,
        { duration: boolean; distance: boolean }
      >();
      for (const link of links) {
        const taskId = link.taskInstanceId;
        if (
          !taskId ||
          link.linkStatus !== "confirmed" ||
          link.needsReview ||
          link.sourceVersion !== link.linkSourceVersion ||
          taskDates.get(taskId) !== link.localDate
        ) {
          continue;
        }
        const current = sourceByTask.get(taskId) ?? {
          duration: false,
          distance: false,
        };
        if (link.provider === "garmin" && link.kind === "activity") {
          const activity = garminActivitySummarySchema.safeParse(
            link.document.payload,
          );
          if (activity.success) {
            current.duration = true;
            current.distance ||= activity.data.distanceMeters !== null;
          }
        } else if (
          link.provider === "xunji" &&
          link.kind === "strength_training" &&
          xunjiTrainSchema.safeParse(link.document.payload).success
        ) {
          current.duration = true;
        }
        sourceByTask.set(taskId, current);
      }

      return {
        tracker,
        planVersions: versions,
        timelineHeadPlanVersion: timelineHead,
        basePlanVersion: basePlan,
        tasks: taskRows.map((task) => {
          const actual = taskActualSchema.safeParse(task.actual);
          const source = sourceByTask.get(task.id);
          return {
            id: task.id,
            localDate: task.localDate,
            planVersionId: task.planVersionId,
            status: task.status,
            confirmedByUser: task.confirmedByUser,
            durationMeasured:
              (actual.success && actual.data.durationMinutes !== null) ||
              (source?.duration ?? false),
            distanceMeasured:
              (actual.success && actual.data.distanceKm !== null) ||
              (source?.distance ?? false),
            sourceMeasured:
              source?.duration === true || source?.distance === true,
          };
        }),
        feedbacks: feedbackRows.flatMap((row) => {
          const event = trackerEventSchema.safeParse(row.document);
          const payload = event.success
            ? kneeCheckInEventPayloadSchema.safeParse(event.data.payload)
            : null;
          return payload?.success
            ? [
                {
                  localDate: row.localDate,
                  leftPain: payload.data.leftPain,
                  rightPain: payload.data.rightPain,
                  safetyLevel: payload.data.safetyLevel,
                },
              ]
            : [];
        }),
        pauses: pauseRows.map((pause) => ({
          startDate: pause.startDate,
          endDate: minDate(pause.endedOn ?? targetDate, targetDate),
        })),
        contexts: contextRows.map((context) => ({
          kind: context.kind,
          startDate: context.startDate,
          endDate: minDate(context.endedOn ?? context.endDate, targetDate),
        })),
        degradedDates: dayRows.flatMap((day) =>
          day.selectedAlternativeId !== null ||
          day.safetyDisposition === "stop_reassess"
            ? [day.localDate]
            : [],
        ),
      };
    },

    async findLatestSession(trackerId) {
      const [row] = await database
        .select({
          status: evaluationSessions.status,
          snapshot: evaluationSessions.snapshot,
        })
        .from(evaluationSessions)
        .where(eq(evaluationSessions.trackerId, trackerId))
        .orderBy(desc(evaluationSessions.createdAt))
        .limit(1);
      if (!row) return null;
      if (row.status !== "open" && row.status !== "expired") {
        throw new Error("evaluation_session_status_invalid");
      }
      return {
        status: row.status,
        snapshot: evaluationSessionSnapshotSchema.parse(row.snapshot),
      };
    },

    async findEventByCommandId(commandId) {
      const [row] = await database
        .select({ document: events.document })
        .from(events)
        .where(eq(events.idempotencyKey, commandId))
        .limit(1);
      return row ? trackerEventSchema.parse(row.document) : null;
    },

    async findResultBySessionId(trackerId, sessionId) {
      const [row] = await database
        .select({ document: evaluationResults.document })
        .from(evaluationResults)
        .where(
          and(
            eq(evaluationResults.trackerId, trackerId),
            eq(evaluationResults.sessionId, sessionId),
          ),
        )
        .limit(1);
      return row ? evaluationResultDocumentSchema.parse(row.document) : null;
    },

    async findDecisionBySessionId(trackerId, sessionId) {
      const [row] = await database
        .select({ document: evaluationDecisions.document })
        .from(evaluationDecisions)
        .where(
          and(
            eq(evaluationDecisions.trackerId, trackerId),
            eq(evaluationDecisions.sessionId, sessionId),
          ),
        )
        .limit(1);
      return row ? evaluationDecisionDocumentSchema.parse(row.document) : null;
    },

    async hasRedSafetySignal(trackerId, localDate) {
      const rows = await database
        .select({ document: events.document })
        .from(events)
        .where(
          and(
            eq(events.trackerId, trackerId),
            eq(events.kind, "symptom_check_in"),
            eq(events.localDate, localDate),
          ),
        );
      return rows.some((row) => {
        const parsed = trackerEventSchema.safeParse(row.document);
        return parsed.success && parsed.data.payload.safetyLevel === "red";
      });
    },

    async expireSession(sessionId) {
      const rows = await database
        .update(evaluationSessions)
        .set({ status: "expired", updatedAt: new Date() })
        .where(
          and(
            eq(evaluationSessions.id, sessionId),
            eq(evaluationSessions.status, "open"),
          ),
        )
        .returning({ id: evaluationSessions.id });
      return rows.length === 1;
    },

    async commitAtomically(prepared) {
      await database.batch([
        database.execute(sql`
          select assert_evaluation_session_context(
            ${prepared.trackerId}::uuid,
            ${prepared.snapshot.targetDate}::date,
            ${prepared.snapshot.basePlanVersion.id}::uuid,
            ${prepared.snapshot.timelineHeadPlanVersion.id}::uuid
          )
        `),
        database.insert(evaluationSessions).values({
          id: prepared.snapshot.id,
          trackerId: prepared.trackerId,
          kind: prepared.snapshot.kind,
          status: "open",
          triggerDate: prepared.snapshot.triggerDate,
          targetDate: prepared.snapshot.targetDate,
          basePlanVersionId: prepared.snapshot.basePlanVersion.id,
          timelineHeadPlanVersionId:
            prepared.snapshot.timelineHeadPlanVersion.id,
          planningTimeZone: prepared.snapshot.planningTimeZone,
          calculationVersion: prepared.snapshot.calculationVersion,
          snapshot: prepared.snapshot,
          createdAt: new Date(prepared.snapshot.createdAt),
        }),
        database.insert(events).values({
          id: prepared.event.id,
          trackerId: prepared.trackerId,
          kind: prepared.event.kind,
          localDate: prepared.event.localDate,
          occurredAt: new Date(prepared.event.occurredAt),
          recordedAt: new Date(prepared.event.recordedAt),
          occurredTimeZone: prepared.event.occurredTimeZone,
          occurredUtcOffsetMinutes: prepared.event.occurredUtcOffsetMinutes,
          idempotencyKey: prepared.event.idempotencyKey,
          document: prepared.event,
        }),
        database.insert(githubSyncOutbox).values(prepared.outbox),
      ]);
    },

    async commitResultAtomically(prepared) {
      await database.batch([
        database.execute(sql`
          select assert_evaluation_result_context(
            ${prepared.trackerId}::uuid,
            ${prepared.result.sessionId}::uuid,
            ${prepared.result.basePlanVersionId}::uuid,
            ${prepared.result.timelineHeadPlanVersionId}::uuid,
            ${prepared.expectedContextRevision}::integer,
            ${prepared.result.submittedLocalDate}::date
          )
        `),
        database.insert(evaluationResults).values({
          id: prepared.result.id,
          trackerId: prepared.trackerId,
          sessionId: prepared.result.sessionId,
          basePlanVersionId: prepared.result.basePlanVersionId,
          timelineHeadPlanVersionId: prepared.result.timelineHeadPlanVersionId,
          submittedOn: prepared.result.submittedLocalDate,
          resultVersion: prepared.result.resultVersion,
          document: prepared.result,
          recordedAt: new Date(prepared.result.submittedAt),
        }),
        database.insert(events).values({
          id: prepared.event.id,
          trackerId: prepared.trackerId,
          kind: prepared.event.kind,
          localDate: prepared.event.localDate,
          occurredAt: new Date(prepared.event.occurredAt),
          recordedAt: new Date(prepared.event.recordedAt),
          occurredTimeZone: prepared.event.occurredTimeZone,
          occurredUtcOffsetMinutes: prepared.event.occurredUtcOffsetMinutes,
          idempotencyKey: prepared.event.idempotencyKey,
          document: prepared.event,
        }),
        database.insert(githubSyncOutbox).values(prepared.outbox),
      ]);
    },

    async commitDecisionAtomically(prepared) {
      await database.batch([
        database.execute(sql`
          select assert_evaluation_decision_context(
            ${prepared.trackerId}::uuid,
            ${prepared.decision.sessionId}::uuid,
            ${prepared.decision.resultId}::uuid,
            ${prepared.decision.basePlanVersionId}::uuid,
            ${prepared.decision.timelineHeadPlanVersionId}::uuid,
            ${prepared.expectedContextRevision}::integer,
            ${prepared.decision.decidedLocalDate}::date,
            ${prepared.decision.branch}::text
          )
        `),
        database.insert(evaluationDecisions).values({
          id: prepared.decision.id,
          trackerId: prepared.trackerId,
          sessionId: prepared.decision.sessionId,
          resultId: prepared.decision.resultId,
          basePlanVersionId: prepared.decision.basePlanVersionId,
          timelineHeadPlanVersionId:
            prepared.decision.timelineHeadPlanVersionId,
          decidedOn: prepared.decision.decidedLocalDate,
          decisionVersion: prepared.decision.decisionVersion,
          branch: prepared.decision.branch,
          document: prepared.decision,
          recordedAt: new Date(prepared.decision.decidedAt),
        }),
        database.insert(events).values({
          id: prepared.event.id,
          trackerId: prepared.trackerId,
          kind: prepared.event.kind,
          localDate: prepared.event.localDate,
          occurredAt: new Date(prepared.event.occurredAt),
          recordedAt: new Date(prepared.event.recordedAt),
          occurredTimeZone: prepared.event.occurredTimeZone,
          occurredUtcOffsetMinutes: prepared.event.occurredUtcOffsetMinutes,
          idempotencyKey: prepared.event.idempotencyKey,
          document: prepared.event,
        }),
        database.insert(githubSyncOutbox).values(prepared.outbox),
      ]);
    },
  };
}

const lazyEvaluationStore: EvaluationStore = {
  loadContext: (...arguments_) =>
    createNeonEvaluationStore().loadContext(...arguments_),
  findLatestSession: (...arguments_) =>
    createNeonEvaluationStore().findLatestSession(...arguments_),
  findEventByCommandId: (...arguments_) =>
    createNeonEvaluationStore().findEventByCommandId(...arguments_),
  findResultBySessionId: (...arguments_) =>
    createNeonEvaluationStore().findResultBySessionId(...arguments_),
  findDecisionBySessionId: (...arguments_) =>
    createNeonEvaluationStore().findDecisionBySessionId(...arguments_),
  hasRedSafetySignal: (...arguments_) =>
    createNeonEvaluationStore().hasRedSafetySignal(...arguments_),
  expireSession: (...arguments_) =>
    createNeonEvaluationStore().expireSession(...arguments_),
  commitAtomically: (...arguments_) =>
    createNeonEvaluationStore().commitAtomically(...arguments_),
  commitResultAtomically: (...arguments_) =>
    createNeonEvaluationStore().commitResultAtomically(...arguments_),
  commitDecisionAtomically: (...arguments_) =>
    createNeonEvaluationStore().commitDecisionAtomically(...arguments_),
};

export const evaluationRuntime = createEvaluationRuntime({
  store: lazyEvaluationStore,
});
