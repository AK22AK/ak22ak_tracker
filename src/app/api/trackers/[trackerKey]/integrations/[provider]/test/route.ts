import { getAuthorizedSession } from "@/server/auth/session";
import { deepSeekCredentialRuntime } from "@/server/integrations/ai/credential-runtime";
import { PlanAdvisorError } from "@/server/integrations/ai/errors";
import { IntegrationTrackerNotFoundError } from "@/server/integrations/credentials/repository";

function safeFailure(error: PlanAdvisorError) {
  const status =
    error.code === "authentication"
      ? 401
      : error.code === "rate_limited"
        ? 429
        : 502;
  return Response.json({ error: error.code }, { status });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ trackerKey: string; provider: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { trackerKey, provider } = await params;
  if (provider !== "deepseek") {
    return Response.json(
      { error: "integration_not_supported" },
      { status: 404 },
    );
  }
  try {
    return Response.json(await deepSeekCredentialRuntime.test(trackerKey), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof PlanAdvisorError) return safeFailure(error);
    if (error instanceof IntegrationTrackerNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return Response.json({ error: "provider_unavailable" }, { status: 502 });
  }
}
