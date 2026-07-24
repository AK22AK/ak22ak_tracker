import { garminActivityRecoveryResponseSchema } from "@/domain/garmin";
import { getAuthorizedSession } from "@/server/auth/session";
import { IntegrationTrackerNotFoundError } from "@/server/integrations/credentials/repository";
import { createDefaultGarminRuntime } from "@/server/integrations/garmin/runtime";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ trackerKey: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { trackerKey } = await params;
    const result = await createDefaultGarminRuntime().recoverActivityHistory({
      trackerKey,
    });
    return Response.json(garminActivityRecoveryResponseSchema.parse(result), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof IntegrationTrackerNotFoundError) {
      return Response.json({ error: "tracker_not_found" }, { status: 404 });
    }
    return Response.json(
      { error: "recovery_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
