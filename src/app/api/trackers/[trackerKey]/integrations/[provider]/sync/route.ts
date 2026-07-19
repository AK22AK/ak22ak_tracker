import { integrationCatchUpResultSchema } from "@/domain/integrations";
import { getAuthorizedSession } from "@/server/auth/session";
import {
  IntegrationCredentialNotFoundError,
  IntegrationTrackerNotFoundError,
} from "@/server/integrations/credentials/repository";
import { isSupportedIntegrationProvider } from "@/server/integrations/providers";
import { syncXunjiCatchUpBatch } from "@/server/integrations/xunji/runtime";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ trackerKey: string; provider: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const route = await params;
  if (!isSupportedIntegrationProvider(route.provider)) {
    return Response.json(
      { error: "integration_not_supported" },
      { status: 404 },
    );
  }
  try {
    if (route.provider === "xunji") {
      return Response.json(
        integrationCatchUpResultSchema.parse(
          await syncXunjiCatchUpBatch({ trackerKey: route.trackerKey }),
        ),
      );
    }
    return Response.json(
      { error: "integration_not_supported" },
      { status: 404 },
    );
  } catch (error) {
    if (error instanceof IntegrationCredentialNotFoundError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof IntegrationTrackerNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
