import { ZodError } from "zod";

import { deepSeekModelPreferenceInputSchema } from "@/domain/deepseek";
import { getAuthorizedSession } from "@/server/auth/session";
import { deepSeekCredentialRuntime } from "@/server/integrations/ai/credential-runtime";
import { IntegrationTrackerNotFoundError } from "@/server/integrations/credentials/repository";

export async function PUT(
  request: Request,
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
    const input = deepSeekModelPreferenceInputSchema.parse(
      await request.json(),
    );
    return Response.json(
      await deepSeekCredentialRuntime.saveModel({ trackerKey, ...input }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (error instanceof IntegrationTrackerNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return Response.json({ error: "preference_unavailable" }, { status: 503 });
  }
}
