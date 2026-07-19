import { ZodError, z } from "zod";

import { localDateSchema } from "@/domain/schemas";
import { getAuthorizedSession } from "@/server/auth/session";
import {
  IntegrationCredentialNotFoundError,
  IntegrationTrackerNotFoundError,
} from "@/server/integrations/credentials/repository";
import { isSupportedIntegrationProvider } from "@/server/integrations/providers";
import { XunjiProviderError } from "@/server/integrations/xunji/adapter";
import { syncXunjiDate } from "@/server/integrations/xunji/runtime";

const syncInputSchema = z.object({ date: localDateSchema });

export async function POST(
  request: Request,
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
    const { date } = syncInputSchema.parse(await request.json());
    if (route.provider === "xunji") {
      return Response.json(
        await syncXunjiDate({ trackerKey: route.trackerKey, date }),
      );
    }
    return Response.json(
      { error: "integration_not_supported" },
      { status: 404 },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (error instanceof IntegrationCredentialNotFoundError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof IntegrationTrackerNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof XunjiProviderError) {
      const status =
        error.code === "authentication"
          ? 401
          : error.code === "rate_limited"
            ? 429
            : 502;
      return Response.json({ error: error.code }, { status });
    }
    throw error;
  }
}
