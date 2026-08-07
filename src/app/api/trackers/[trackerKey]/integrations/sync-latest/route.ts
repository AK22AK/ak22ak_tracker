import { getAuthorizedSession } from "@/server/auth/session";
import { createDefaultGarminRuntime } from "@/server/integrations/garmin/runtime";
import { coordinateLatestSync } from "@/server/integrations/today-sync-coordinator";
import { recoverXunjiHistory } from "@/server/integrations/xunji/runtime";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ trackerKey: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { trackerKey } = await params;
    return Response.json(
      await coordinateLatestSync({
        trackerKey,
        garminRuntime: createDefaultGarminRuntime(),
        xunjiRuntime: { recoverHistory: recoverXunjiHistory },
      }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return Response.json(
      { error: "sync_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
