import { integrationRecoveryResponseSchema } from "@/domain/integrations";
import { getAuthorizedSession } from "@/server/auth/session";
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
      integrationRecoveryResponseSchema.parse(
        await recoverXunjiHistory({ trackerKey }),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return Response.json(
      { error: "recovery_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
