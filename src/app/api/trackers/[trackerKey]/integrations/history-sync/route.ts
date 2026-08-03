import { getAuthorizedSession } from "@/server/auth/session";
import { IntegrationTrackerNotFoundError } from "@/server/integrations/credentials/repository";
import { getProviderHistoryOverview } from "@/server/integrations/core/history-sync-overview";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ trackerKey: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const { trackerKey } = await params;
    return Response.json(await getProviderHistoryOverview(trackerKey), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof IntegrationTrackerNotFoundError) {
      return Response.json(
        { error: "tracker_not_found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      { error: "history_sync_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
