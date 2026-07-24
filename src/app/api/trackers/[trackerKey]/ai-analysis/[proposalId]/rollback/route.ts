import { ZodError } from "zod";

import { planVersionRollbackCommandSchema } from "@/domain/ai-analysis";
import { getAuthorizedSession } from "@/server/auth/session";
import {
  PlanVersionRollbackConflictError,
  PlanVersionRollbackNotApplicableError,
  PlanVersionRollbackNotFoundError,
} from "@/server/commands/plan-version-rollback-core";
import { planVersionRollbackRuntime } from "@/server/integrations/ai/rollback-runtime";
import { scheduleGitHubMirrorAfterResponse } from "@/server/mirror/after-response";

function knownError(error: unknown) {
  if (error instanceof PlanVersionRollbackNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (
    error instanceof PlanVersionRollbackConflictError ||
    error instanceof PlanVersionRollbackNotApplicableError
  ) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ZodError) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  return Response.json({ error: "rollback_unavailable" }, { status: 503 });
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
    const command = planVersionRollbackCommandSchema.parse({
      ...body,
      proposalId,
    });
    const result = await planVersionRollbackRuntime.rollback({
      trackerKey,
      ...command,
    });
    if (result.status === "rolled_back") scheduleGitHubMirrorAfterResponse();
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return knownError(error);
  }
}
