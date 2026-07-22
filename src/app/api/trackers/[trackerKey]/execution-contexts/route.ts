import { ZodError } from "zod";

import { createExecutionContextCommandSchema } from "@/domain/execution-context";
import { getAuthorizedSession } from "@/server/auth/session";
import { createNeonExecutionContextCommandStore } from "@/server/commands/execution-context";
import {
  ExecutionContextCommandConflictError,
  ExecutionContextOverlapError,
  ExecutionContextRangeError,
  ExecutionTrackerNotFoundError,
  executeCreateExecutionContextCommand,
} from "@/server/commands/execution-context-core";
import { scheduleGitHubMirrorAfterResponse } from "@/server/mirror/after-response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ trackerKey: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const input = createExecutionContextCommandSchema.parse(
      await request.json(),
    );
    const result = await executeCreateExecutionContextCommand(
      createNeonExecutionContextCommandStore(),
      { ...input, trackerKey: (await params).trackerKey },
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
    if (error instanceof ExecutionTrackerNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ExecutionContextOverlapError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ExecutionContextCommandConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
