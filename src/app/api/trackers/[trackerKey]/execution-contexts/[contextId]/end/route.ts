import { ZodError } from "zod";

import { endExecutionContextCommandSchema } from "@/domain/execution-context";
import { getAuthorizedSession } from "@/server/auth/session";
import { createNeonExecutionContextCommandStore } from "@/server/commands/execution-context";
import {
  ExecutionContextCommandConflictError,
  ExecutionContextNotFoundError,
  ExecutionTrackerNotFoundError,
  executeEndExecutionContextCommand,
} from "@/server/commands/execution-context-core";
import { scheduleGitHubMirrorAfterResponse } from "@/server/mirror/after-response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ trackerKey: string; contextId: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const routeParams = await params;
    const input = endExecutionContextCommandSchema.parse({
      ...(await request.json()),
      contextId: routeParams.contextId,
    });
    const result = await executeEndExecutionContextCommand(
      createNeonExecutionContextCommandStore(),
      { ...input, trackerKey: routeParams.trackerKey },
    );
    scheduleGitHubMirrorAfterResponse();
    return Response.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (
      error instanceof ExecutionContextNotFoundError ||
      error instanceof ExecutionTrackerNotFoundError
    ) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ExecutionContextCommandConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
