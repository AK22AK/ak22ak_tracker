import { ZodError } from "zod";

import { endExecutionPauseCommandSchema } from "@/domain/execution-context";
import { getAuthorizedSession } from "@/server/auth/session";
import { createNeonExecutionContextCommandStore } from "@/server/commands/execution-context";
import {
  ExecutionContextCommandConflictError,
  ExecutionContextRangeError,
  ExecutionPauseNotFoundError,
  ExecutionTrackerNotFoundError,
  executeEndExecutionPauseCommand,
} from "@/server/commands/execution-context-core";
import { scheduleGitHubMirrorAfterResponse } from "@/server/mirror/after-response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ trackerKey: string; pauseId: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const routeParams = await params;
    const input = endExecutionPauseCommandSchema.parse({
      ...(await request.json()),
      pauseId: routeParams.pauseId,
    });
    const result = await executeEndExecutionPauseCommand(
      createNeonExecutionContextCommandStore(),
      { ...input, trackerKey: routeParams.trackerKey },
    );
    scheduleGitHubMirrorAfterResponse();
    return Response.json(result);
  } catch (error) {
    if (
      error instanceof ZodError ||
      error instanceof ExecutionContextRangeError
    ) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (
      error instanceof ExecutionPauseNotFoundError ||
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
