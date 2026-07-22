import { ZodError, z } from "zod";

import {
  externalRecordAssociationCommandSchema,
  externalRecordAssociationResultSchema,
} from "@/domain/external-training";
import { getAuthorizedSession } from "@/server/auth/session";
import { createNeonExternalRecordAssociationStore } from "@/server/commands/external-record-association";
import {
  AssociationCommandConflictError,
  AssociationSourceVersionConflictError,
  AssociationTargetInvalidError,
  executeExternalRecordAssociationCommand,
  ExternalRecordNotFoundError,
} from "@/server/commands/external-record-association-core";
import { scheduleGitHubMirrorAfterResponse } from "@/server/mirror/after-response";

const routeParametersSchema = z.object({
  trackerKey: z.string().min(1).max(100),
  recordId: z.uuid(),
});

export async function PUT(
  request: Request,
  context: {
    params: Promise<{ trackerKey: string; recordId: string }>;
  },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { trackerKey, recordId } = routeParametersSchema.parse(
      await context.params,
    );
    const body = externalRecordAssociationCommandSchema.parse({
      ...(await request.json()),
      externalRecordId: recordId,
    });
    const result = await executeExternalRecordAssociationCommand(
      createNeonExternalRecordAssociationStore(),
      { ...body, trackerKey },
    );
    scheduleGitHubMirrorAfterResponse();
    return Response.json(externalRecordAssociationResultSchema.parse(result));
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (error instanceof ExternalRecordNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof AssociationTargetInvalidError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    if (
      error instanceof AssociationSourceVersionConflictError ||
      error instanceof AssociationCommandConflictError
    ) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
