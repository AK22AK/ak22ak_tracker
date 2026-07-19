import "server-only";

import { and, asc, desc, eq, gt, isNull, lte, gte } from "drizzle-orm";

import {
  executionAlternativeDocumentSchema,
  executionDayConditionsSchema,
  type ExecutionAlternativeDocument,
} from "@/domain/execution-context";
import { getDatabase } from "@/server/db/client";
import {
  executionAlternativeVersions,
  executionContexts,
  executionDayDecisions,
  executionPauses,
  resumptionAssessments,
} from "@/server/db/schema";

import type { ExecutionContextAggregateStore } from "./aggregate-core";

type Database = ReturnType<typeof getDatabase>;

export function createNeonExecutionContextAggregateStore(
  trackerId: string,
  database: Database = getDatabase(),
): ExecutionContextAggregateStore {
  const selectContext = {
    id: executionContexts.id,
    kind: executionContexts.kind,
    startDate: executionContexts.startDate,
    endDate: executionContexts.endDate,
  };

  return {
    async findPendingResumption() {
      const [row] = await database
        .select({ snapshot: resumptionAssessments.snapshot })
        .from(resumptionAssessments)
        .where(
          and(
            eq(resumptionAssessments.trackerId, trackerId),
            eq(resumptionAssessments.status, "pending"),
          ),
        )
        .orderBy(desc(resumptionAssessments.createdAt))
        .limit(1);
      if (!row) return null;
      return {
        id: row.snapshot.id,
        triggerType: row.snapshot.trigger.type,
        recommendedEffectiveFrom: row.snapshot.recommendedEffectiveFrom,
        basePlanVersion: {
          id: row.snapshot.basePlanVersion.id,
          version: row.snapshot.basePlanVersion.version,
        },
        status: "pending" as const,
      };
    },
    async findRelevantPause(targetDate) {
      const [row] = await database
        .select({
          id: executionPauses.id,
          reason: executionPauses.reason,
          note: executionPauses.note,
          startedOn: executionPauses.startedOn,
          endedOn: executionPauses.endedOn,
        })
        .from(executionPauses)
        .where(
          and(
            eq(executionPauses.trackerId, trackerId),
            lte(executionPauses.startedOn, targetDate),
            isNull(executionPauses.endedAt),
          ),
        )
        .orderBy(
          desc(executionPauses.startedOn),
          desc(executionPauses.createdAt),
        )
        .limit(1);
      return row ?? null;
    },
    async findRelevantContext(targetDate) {
      const [active] = await database
        .select(selectContext)
        .from(executionContexts)
        .where(
          and(
            eq(executionContexts.trackerId, trackerId),
            isNull(executionContexts.endedAt),
            lte(executionContexts.startDate, targetDate),
            gte(executionContexts.endDate, targetDate),
          ),
        )
        .orderBy(asc(executionContexts.startDate))
        .limit(1);
      if (active) return active;

      const [upcoming] = await database
        .select(selectContext)
        .from(executionContexts)
        .where(
          and(
            eq(executionContexts.trackerId, trackerId),
            isNull(executionContexts.endedAt),
            gt(executionContexts.startDate, targetDate),
          ),
        )
        .orderBy(asc(executionContexts.startDate))
        .limit(1);
      return upcoming ?? null;
    },

    async findDayDecision(contextId, targetDate) {
      const [row] = await database
        .select({
          localDate: executionDayDecisions.localDate,
          conditions: executionDayDecisions.conditions,
          optionId: executionDayDecisions.selectedAlternativeId,
          optionVersion: executionDayDecisions.selectedAlternativeVersion,
          safetyDisposition: executionDayDecisions.safetyDisposition,
        })
        .from(executionDayDecisions)
        .where(
          and(
            eq(executionDayDecisions.contextId, contextId),
            eq(executionDayDecisions.localDate, targetDate),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        localDate: row.localDate,
        conditions: executionDayConditionsSchema.parse(row.conditions),
        selection:
          row.optionId && row.optionVersion
            ? { optionId: row.optionId, optionVersion: row.optionVersion }
            : null,
        safetyDisposition: row.safetyDisposition,
      };
    },

    async findEffectiveAlternatives(targetDate) {
      const rows = await database
        .select({ document: executionAlternativeVersions.document })
        .from(executionAlternativeVersions)
        .where(
          and(
            eq(executionAlternativeVersions.trackerId, trackerId),
            lte(executionAlternativeVersions.effectiveFrom, targetDate),
          ),
        )
        .orderBy(
          asc(executionAlternativeVersions.optionKey),
          desc(executionAlternativeVersions.version),
        );
      const latest = new Map<string, ExecutionAlternativeDocument>();
      for (const row of rows) {
        const document = executionAlternativeDocumentSchema.parse(row.document);
        if (!latest.has(document.optionKey)) {
          latest.set(document.optionKey, document);
        }
      }
      return [...latest.values()];
    },
  };
}
