import { ZodError } from "zod";

import { getAuthorizedSession } from "@/server/auth/session";
import {
  getPlanWorkspace,
  PlanWorkspaceTrackerNotFoundError,
} from "@/server/plan-workspace/aggregate";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ trackerKey: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return Response.json(
      await getPlanWorkspace({ trackerKey: (await params).trackerKey }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof PlanWorkspaceTrackerNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ZodError) {
      return Response.json({ error: "invalid_aggregate" }, { status: 500 });
    }
    return Response.json(
      { error: "plan_workspace_unavailable" },
      { status: 503 },
    );
  }
}
