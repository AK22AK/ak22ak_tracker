import { ZodError } from "zod";

import { getAuthorizedSession } from "@/server/auth/session";
import { getResumptionAssessment } from "@/server/resumption/repository";

export async function GET(
  _request: Request,
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
    const { trackerKey, assessmentId } = await params;
    const assessment = await getResumptionAssessment(trackerKey, assessmentId);
    return assessment
      ? Response.json(assessment)
      : Response.json(
          { error: "resumption_assessment_not_found" },
          { status: 404 },
        );
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "invalid_assessment" }, { status: 500 });
    }
    throw error;
  }
}
