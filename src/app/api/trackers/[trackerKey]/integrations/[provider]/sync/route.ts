import { ZodError, z } from "zod";

import { garminActivitySyncResponseSchema } from "@/domain/garmin";
import { integrationCatchUpResultSchema } from "@/domain/integrations";
import { localDateSchema } from "@/domain/schemas";
import { getAuthorizedSession } from "@/server/auth/session";
import {
  IntegrationCredentialNotFoundError,
  IntegrationTrackerNotFoundError,
} from "@/server/integrations/credentials/repository";
import { isSupportedIntegrationProvider } from "@/server/integrations/providers";
import { GarminProviderError } from "@/server/integrations/garmin/errors";
import {
  createDefaultGarminRuntime,
  GarminPreviewDateOutOfRangeError,
} from "@/server/integrations/garmin/runtime";
import { syncXunjiCatchUpBatch } from "@/server/integrations/xunji/runtime";

const garminSyncInputSchema = z.object({ date: localDateSchema }).strict();

function garminFailure(error: GarminProviderError) {
  const status =
    error.code === "rate_limited"
      ? 429
      : error.code === "timeout"
        ? 504
        : error.code === "provider_unavailable"
          ? 503
          : error.code === "invalid_response"
            ? 502
            : 422;
  return Response.json(
    { error: error.code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

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
    if (route.provider === "xunji") {
      return Response.json(
        integrationCatchUpResultSchema.parse(
          await syncXunjiCatchUpBatch({ trackerKey: route.trackerKey }),
        ),
      );
    }
    if (route.provider === "garmin") {
      const contentLength = Number(request.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > 1_024) {
        return Response.json({ error: "invalid_request" }, { status: 400 });
      }
      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > 1_024) {
        return Response.json({ error: "invalid_request" }, { status: 400 });
      }
      if (!text.trim()) {
        return Response.json(
          integrationCatchUpResultSchema.parse(
            await createDefaultGarminRuntime().syncActivityHistory({
              trackerKey: route.trackerKey,
            }),
          ),
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      const { date } = garminSyncInputSchema.parse(JSON.parse(text));
      return Response.json(
        garminActivitySyncResponseSchema.parse(
          await createDefaultGarminRuntime().syncActivities({
            trackerKey: route.trackerKey,
            date,
          }),
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      { error: "integration_not_supported" },
      { status: 404 },
    );
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (error instanceof GarminPreviewDateOutOfRangeError) {
      return Response.json(
        { error: "future_date_not_allowed" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof IntegrationCredentialNotFoundError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof IntegrationTrackerNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof GarminProviderError) return garminFailure(error);
    throw error;
  }
}
