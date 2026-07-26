import { ZodError, z } from "zod";

import {
  garminWellnessProgressSchema,
  garminWellnessSyncResponseSchema,
} from "@/domain/garmin";
import { integrationCatchUpResultSchema } from "@/domain/integrations";
import { localDateSchema } from "@/domain/schemas";
import { getAuthorizedSession } from "@/server/auth/session";
import {
  IntegrationCredentialNotFoundError,
  IntegrationTrackerNotFoundError,
} from "@/server/integrations/credentials/repository";
import { IntegrationOperationInterruptedError } from "@/server/integrations/credentials/operation-errors";
import { GarminProviderError } from "@/server/integrations/garmin/errors";
import {
  createDefaultGarminRuntime,
  GarminPreviewDateOutOfRangeError,
} from "@/server/integrations/garmin/runtime";

const inputSchema = z.object({ date: localDateSchema }).strict();

function providerFailure(error: GarminProviderError) {
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ trackerKey: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { trackerKey } = await params;
    return Response.json(
      garminWellnessProgressSchema.parse(
        await createDefaultGarminRuntime().wellnessProgress({ trackerKey }),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof IntegrationTrackerNotFoundError) {
      return Response.json({ error: "tracker_not_found" }, { status: 404 });
    }
    return Response.json(
      { error: "status_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ trackerKey: string }> },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { trackerKey } = await params;
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
          await createDefaultGarminRuntime().syncWellnessHistory({
            trackerKey,
          }),
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const { date } = inputSchema.parse(JSON.parse(text));
    return Response.json(
      garminWellnessSyncResponseSchema.parse(
        await createDefaultGarminRuntime().syncWellness({ trackerKey, date }),
      ),
      { headers: { "Cache-Control": "no-store" } },
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
      return Response.json({ error: "credential_not_found" }, { status: 409 });
    }
    if (error instanceof IntegrationOperationInterruptedError) {
      return Response.json(
        { error: "sync_in_progress" },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof IntegrationTrackerNotFoundError) {
      return Response.json({ error: "tracker_not_found" }, { status: 404 });
    }
    if (error instanceof GarminProviderError) return providerFailure(error);
    throw error;
  }
}
