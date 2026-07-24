import { z, ZodError } from "zod";

import { requestPlanAnalysisSchema } from "@/domain/ai-analysis";
import { getAuthorizedSession } from "@/server/auth/session";
import {
  AiAnalysisPlanNotFoundError,
  AiAnalysisTrackerNotFoundError,
} from "@/server/integrations/ai/context";
import { aiAnalysisRuntime } from "@/server/integrations/ai/runtime";

const jobIdSchema = z.uuid();

function knownError(error: unknown) {
  if (error instanceof AiAnalysisTrackerNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof AiAnalysisPlanNotFoundError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ZodError) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  return Response.json({ error: "analysis_unavailable" }, { status: 503 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackerKey: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { trackerKey } = await params;
    const jobInput = new URL(request.url).searchParams.get("job");
    const jobId = jobInput ? jobIdSchema.parse(jobInput) : undefined;
    return Response.json(await aiAnalysisRuntime.load(trackerKey, jobId), {
      headers: { "Cache-Control": "private, no-store" },
    });
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
    const { trackerKey } = await params;
    const input = requestPlanAnalysisSchema.parse(await request.json());
    return Response.json(
      await aiAnalysisRuntime.request({
        trackerKey,
        commandId: input.commandId,
      }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return knownError(error);
  }
}
