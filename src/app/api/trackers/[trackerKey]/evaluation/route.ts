import { ZodError } from "zod";

import { createEvaluationSessionCommandSchema } from "@/domain/evaluation";
import { getAuthorizedSession } from "@/server/auth/session";
import { evaluationRuntime } from "@/server/evaluation/repository";
import {
  EvaluationCommandConflictError,
  EvaluationNotEligibleError,
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
    error instanceof EvaluationNotEligibleError ||
    error instanceof EvaluationCommandConflictError
  ) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  return Response.json({ error: "evaluation_unavailable" }, { status: 503 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ trackerKey: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return Response.json(
      await evaluationRuntime.load((await params).trackerKey),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return knownError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ trackerKey: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await evaluationRuntime.create(
      (await params).trackerKey,
      createEvaluationSessionCommandSchema.parse(await request.json()),
    );
    scheduleGitHubMirrorAfterResponse();
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return knownError(error);
  }
}
