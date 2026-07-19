import { ZodError } from "zod";

import { resumptionDecisionCommandSchema } from "@/domain/resumption";
import { getAuthorizedSession } from "@/server/auth/session";
import { createNeonResumptionDecisionStore } from "@/server/commands/resumption";
import {
  executeResumptionDecisionCommand,
  ResumptionAssessmentNotFoundError,
  ResumptionAssessmentStateError,
  ResumptionCommandConflictError,
  ResumptionTrackerNotFoundError,
} from "@/server/commands/resumption-core";

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ trackerKey: string; assessmentId: string }>;
  },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const route = await params;
    const input = resumptionDecisionCommandSchema.parse({
      ...(await request.json()),
      assessmentId: route.assessmentId,
    });
    return Response.json(
      await executeResumptionDecisionCommand(
        createNeonResumptionDecisionStore(),
        { ...input, trackerKey: route.trackerKey },
      ),
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (
      error instanceof ResumptionAssessmentNotFoundError ||
      error instanceof ResumptionTrackerNotFoundError
    ) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (
      error instanceof ResumptionAssessmentStateError ||
      error instanceof ResumptionCommandConflictError
    ) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
