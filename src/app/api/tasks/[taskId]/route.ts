import { ZodError, z } from "zod";

import {
  clientCommandMetadataSchema,
  taskActualSchema,
} from "@/domain/schemas";
import { getAuthorizedSession } from "@/server/auth/session";
import { createNeonTaskCommandStore } from "@/server/commands/task-command";
import {
  CommandConflictError,
  executeTaskCommand,
  TaskNotFoundError,
} from "@/server/commands/task-command-core";

const updateTaskSchema = clientCommandMetadataSchema.extend({
  status: z.enum(["planned", "completed", "skipped"]),
  actual: taskActualSchema.nullable().optional(),
  note: z.string().max(2_000).nullable().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const session = await getAuthorizedSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const input = updateTaskSchema.parse(await request.json());
    const { taskId } = await context.params;
    const result = await executeTaskCommand(createNeonTaskCommandStore(), {
      ...input,
      taskId,
      actual: input.actual ?? null,
      note: input.note ?? null,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (error instanceof TaskNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof CommandConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
