import { ZodError } from "zod";

import {
  providerHistoryScopeSchema,
  providerHistorySyncInputSchema,
  providerHistorySyncResultSchema,
} from "@/domain/integrations";
import { getAuthorizedSession } from "@/server/auth/session";
import {
  IntegrationCredentialNotFoundError,
  IntegrationTrackerNotFoundError,
} from "@/server/integrations/credentials/repository";
import { IntegrationOperationInterruptedError } from "@/server/integrations/credentials/operation-errors";
import { GarminProviderError } from "@/server/integrations/garmin/errors";
import { createDefaultGarminRuntime } from "@/server/integrations/garmin/runtime";
import { syncXunjiBoundedHistory } from "@/server/integrations/xunji/runtime";

const maxBodyBytes = 1_024;

function statusForProviderError(code: string) {
  if (code === "rate_limited") return 429;
  if (code === "timeout") return 504;
  if (code === "provider_unavailable") return 503;
  if (code === "invalid_response") return 502;
  return 422;
}

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ trackerKey: string; scope: string }>;
  },
) {
  if (!(await getAuthorizedSession())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const { trackerKey, scope: scopeInput } = await params;
    const scope = providerHistoryScopeSchema.parse(scopeInput);
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const { days } = providerHistorySyncInputSchema.parse(JSON.parse(text));
    const result =
      scope === "xunji_training_history"
        ? await syncXunjiBoundedHistory({ trackerKey, days })
        : await createDefaultGarminRuntime().syncBoundedHistory({
            trackerKey,
            scope,
            days,
          });
    return Response.json(providerHistorySyncResultSchema.parse(result), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (error instanceof IntegrationOperationInterruptedError) {
      return Response.json(
        { error: "sync_in_progress" },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof IntegrationCredentialNotFoundError) {
      return Response.json({ error: "credential_not_found" }, { status: 409 });
    }
    if (error instanceof IntegrationTrackerNotFoundError) {
      return Response.json({ error: "tracker_not_found" }, { status: 404 });
    }
    if (error instanceof GarminProviderError) {
      return Response.json(
        { error: error.code },
        { status: statusForProviderError(error.code) },
      );
    }
    return Response.json(
      { error: "sync_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
