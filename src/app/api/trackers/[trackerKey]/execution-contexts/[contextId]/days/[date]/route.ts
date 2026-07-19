import { ZodError } from "zod";

import { setExecutionDayCommandSchema } from "@/domain/execution-context";
import { getAuthorizedSession } from "@/server/auth/session";
import { createNeonExecutionContextCommandStore } from "@/server/commands/execution-context";
import {
  ExecutionAlternativeNotFoundError,
  ExecutionAlternativeVersionConflictError,
  ExecutionContextCommandConflictError,
  ExecutionContextNotFoundError,
  ExecutionContextRangeError,
  ExecutionContextSafetyBlockedError,
  ExecutionTrackerNotFoundError,
  executeSetExecutionDayCommand,
} from "@/server/commands/execution-context-core";

export async function PUT(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ trackerKey: string; contextId: string; date: string }>;
  },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const routeParams = await params;
    const input = setExecutionDayCommandSchema.parse({
      ...(await request.json()),
      contextId: routeParams.contextId,
      localDate: routeParams.date,
    });
    return Response.json(
      await executeSetExecutionDayCommand(
        createNeonExecutionContextCommandStore(),
        { ...input, trackerKey: routeParams.trackerKey },
      ),
    );
  } catch (error) {
    if (
      error instanceof ZodError ||
      error instanceof ExecutionContextRangeError
    ) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (
      error instanceof ExecutionContextNotFoundError ||
      error instanceof ExecutionTrackerNotFoundError ||
      error instanceof ExecutionAlternativeNotFoundError
    ) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (
      error instanceof ExecutionContextCommandConflictError ||
      error instanceof ExecutionAlternativeVersionConflictError
    ) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ExecutionContextSafetyBlockedError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
