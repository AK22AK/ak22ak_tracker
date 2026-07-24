import { z, ZodError } from "zod";

import { localDateSchema } from "@/domain/schemas";
import { getAuthorizedSession } from "@/server/auth/session";
import {
  IntegrationCredentialNotFoundError,
  IntegrationTrackerNotFoundError,
} from "@/server/integrations/credentials/repository";
import { GarminProviderError } from "@/server/integrations/garmin/errors";
import {
  createDefaultGarminRuntime,
  GarminPreviewDateOutOfRangeError,
} from "@/server/integrations/garmin/runtime";

const previewInputSchema = z.object({ date: localDateSchema }).strict();

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
    const { date } = previewInputSchema.parse(await request.json());
    return Response.json(
      await createDefaultGarminRuntime().previewActivities({
        trackerKey,
        date,
      }),
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
    if (error instanceof IntegrationTrackerNotFoundError) {
      return Response.json({ error: "tracker_not_found" }, { status: 404 });
    }
    if (error instanceof GarminProviderError) return providerFailure(error);
    throw error;
  }
}
