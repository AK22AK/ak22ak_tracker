import { ZodError } from "zod";

import { createAssistantTurnCommandSchema } from "@/domain/rehab-assistant";
import { getAuthorizedSession } from "@/server/auth/session";
import { AssistantFutureDateError } from "@/server/integrations/assistant/context";
import { assistantRuntime } from "@/server/integrations/assistant/runtime";
import {
  AssistantCommandConflictError,
  AssistantTrackerNotFoundError,
} from "@/server/integrations/assistant/repository";

function knownError(error: unknown) {
  if (error instanceof AssistantTrackerNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof AssistantFutureDateError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof AssistantCommandConflictError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ZodError) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  return Response.json({ error: "assistant_unavailable" }, { status: 503 });
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
      await assistantRuntime.load((await params).trackerKey),
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
    const input = createAssistantTurnCommandSchema.parse(await request.json());
    return Response.json(
      await assistantRuntime.request((await params).trackerKey, input),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return knownError(error);
  }
}
