import "server-only";

import { and, eq } from "drizzle-orm";

import {
  parseResumptionAssessmentSnapshot,
  resumptionAssessmentDtoSchema,
  type ResumptionAssessmentDto,
} from "@/domain/resumption";
import { getDatabase } from "@/server/db/client";
import { resumptionAssessments, trackers } from "@/server/db/schema";

export async function getResumptionAssessment(
  trackerKey: string,
  assessmentId: string,
): Promise<ResumptionAssessmentDto | null> {
  const [row] = await getDatabase()
    .select({
      snapshot: resumptionAssessments.snapshot,
      status: resumptionAssessments.status,
      decision: resumptionAssessments.decision,
      decidedAt: resumptionAssessments.decidedAt,
      appliedPlanVersionId: resumptionAssessments.appliedPlanVersionId,
    })
    .from(resumptionAssessments)
    .innerJoin(trackers, eq(resumptionAssessments.trackerId, trackers.id))
    .where(
      and(
        eq(trackers.key, trackerKey),
        eq(trackers.active, true),
        eq(resumptionAssessments.id, assessmentId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const snapshot = parseResumptionAssessmentSnapshot(row.snapshot);
  return resumptionAssessmentDtoSchema.parse({
    ...snapshot,
    status: row.status,
    decision: row.decision,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    appliedPlanVersionId: row.appliedPlanVersionId,
  });
}
