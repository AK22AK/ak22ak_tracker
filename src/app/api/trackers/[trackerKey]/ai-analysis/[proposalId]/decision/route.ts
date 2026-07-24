import { ZodError } from "zod";

import { planChangeDecisionCommandSchema } from "@/domain/ai-analysis";
import { getAuthorizedSession } from "@/server/auth/session";
import {
  PlanChangeDecisionConflictError,
  PlanChangeDecisionNotFoundError,
  PlanChangeNotApplicableError,
} from "@/server/commands/plan-change-decision-core";
import { planChangeDecisionRuntime } from "@/server/integrations/ai/decision-runtime";
import { scheduleGitHubMirrorAfterResponse } from "@/server/mirror/after-response";

function knownError(error: unknown) {
  if (error instanceof PlanChangeDecisionNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (
    error instanceof PlanChangeDecisionConflictError ||
    error instanceof PlanChangeNotApplicableError
  ) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ZodError) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  return Response.json({ error: "decision_unavailable" }, { status: 503 });
}

export async function PUT(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ trackerKey: string; proposalId: string }>;
  },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const [{ trackerKey, proposalId }, body] = await Promise.all([
      params,
      request.json(),
    ]);
    const command = planChangeDecisionCommandSchema.parse({
      ...body,
      proposalId,
    });
    const result = await planChangeDecisionRuntime.decide({
      trackerKey,
      ...command,
    });
    if (result.status !== "expired") scheduleGitHubMirrorAfterResponse();
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return knownError(error);
  }
}
