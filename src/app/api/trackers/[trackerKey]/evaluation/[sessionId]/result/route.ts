import { ZodError } from "zod";

import { createEvaluationResultCommandSchema } from "@/domain/evaluation";
import { getAuthorizedSession } from "@/server/auth/session";
import { evaluationRuntime } from "@/server/evaluation/repository";
import {
  EvaluationCommandConflictError,
  EvaluationResultNotEligibleError,
  EvaluationTrackerNotFoundError,
} from "@/server/evaluation/runtime";
import { scheduleGitHubMirrorAfterResponse } from "@/server/mirror/after-response";

function knownError(error: unknown) {
  if (error instanceof ZodError) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  if (error instanceof EvaluationTrackerNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (
    error instanceof EvaluationResultNotEligibleError ||
    error instanceof EvaluationCommandConflictError
  ) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  return Response.json({ error: "evaluation_unavailable" }, { status: 503 });
}

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ trackerKey: string; sessionId: string }>;
  },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const route = await params;
    const command = createEvaluationResultCommandSchema.parse(
      await request.json(),
    );
    if (command.sessionId !== route.sessionId) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const result = await evaluationRuntime.submitResult(
      route.trackerKey,
      command,
    );
    scheduleGitHubMirrorAfterResponse();
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return knownError(error);
  }
}
