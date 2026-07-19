import { ZodError } from "zod";

import { startExecutionPauseCommandSchema } from "@/domain/execution-context";
import { getAuthorizedSession } from "@/server/auth/session";
import { createNeonExecutionContextCommandStore } from "@/server/commands/execution-context";
import {
  ExecutionContextCommandConflictError,
  ExecutionPauseAlreadyActiveError,
  ExecutionTrackerNotFoundError,
  executeStartExecutionPauseCommand,
} from "@/server/commands/execution-context-core";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ trackerKey: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const input = startExecutionPauseCommandSchema.parse(await request.json());
    return Response.json(
      await executeStartExecutionPauseCommand(
        createNeonExecutionContextCommandStore(),
        { ...input, trackerKey: (await params).trackerKey },
      ),
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (error instanceof ExecutionTrackerNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (
      error instanceof ExecutionPauseAlreadyActiveError ||
      error instanceof ExecutionContextCommandConflictError
    ) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
