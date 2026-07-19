import { z, ZodError } from "zod";

import { getAuthorizedSession } from "@/server/auth/session";
import {
  getIntegrationStatus,
  IntegrationTrackerNotFoundError,
} from "@/server/integrations/credentials/repository";
import { isSupportedIntegrationProvider } from "@/server/integrations/providers";
import { XunjiProviderError } from "@/server/integrations/xunji/adapter";
import { validateAndSaveXunjiCredential } from "@/server/integrations/xunji/runtime";

const credentialInputSchema = z.object({
  apiKey: z.string().min(1).max(4_096),
});

function providerFailure(error: XunjiProviderError) {
  const status =
    error.code === "authentication"
      ? 401
      : error.code === "rate_limited"
        ? 429
        : 502;
  return Response.json({ error: error.code }, { status });
}

async function context(
  params: Promise<{ trackerKey: string; provider: string }>,
) {
  const value = await params;
  return isSupportedIntegrationProvider(value.provider) ? value : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ trackerKey: string; provider: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const value = await context(params);
  if (!value) {
    return Response.json(
      { error: "integration_not_supported" },
      { status: 404 },
    );
  }
  try {
    return Response.json(
      await getIntegrationStatus(value.trackerKey, value.provider),
    );
  } catch (error) {
    if (error instanceof IntegrationTrackerNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ trackerKey: string; provider: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const value = await context(params);
  if (!value) {
    return Response.json(
      { error: "integration_not_supported" },
      { status: 404 },
    );
  }
  try {
    const { apiKey } = credentialInputSchema.parse(await request.json());
    if (value.provider === "xunji") {
      await validateAndSaveXunjiCredential({
        trackerKey: value.trackerKey,
        apiKey,
      });
    }
    return Response.json(
      await getIntegrationStatus(value.trackerKey, value.provider),
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (error instanceof XunjiProviderError) return providerFailure(error);
    if (error instanceof IntegrationTrackerNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
