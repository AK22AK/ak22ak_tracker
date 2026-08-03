import { ZodError } from "zod";

import { getAuthorizedSession } from "@/server/auth/session";
import {
  AiAnalysisPlanNotFoundError,
  AiAnalysisTrackerNotFoundError,
} from "@/server/integrations/ai/context";
import { aiAnalysisRuntime } from "@/server/integrations/ai/runtime";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ trackerKey: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { trackerKey } = await params;
    return Response.json(await aiAnalysisRuntime.preview(trackerKey), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AiAnalysisTrackerNotFoundError) {
      return Response.json({ error: "tracker_not_found" }, { status: 404 });
    }
    if (error instanceof AiAnalysisPlanNotFoundError) {
      return Response.json({ error: "plan_not_found" }, { status: 409 });
    }
    if (error instanceof ZodError) {
      return Response.json({ error: "invalid_response" }, { status: 503 });
    }
    return Response.json({ error: "preview_unavailable" }, { status: 503 });
  }
}
