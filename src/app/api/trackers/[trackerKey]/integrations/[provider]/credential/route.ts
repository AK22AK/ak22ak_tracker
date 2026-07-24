import { z, ZodError } from "zod";

import { getAuthorizedSession } from "@/server/auth/session";
import {
  getIntegrationStatus,
  IntegrationTrackerNotFoundError,
} from "@/server/integrations/credentials/repository";
import { isSupportedIntegrationProvider } from "@/server/integrations/providers";
import { createDefaultGarminRuntime } from "@/server/integrations/garmin/runtime";
import { XunjiProviderError } from "@/server/integrations/xunji/adapter";
import { validateAndSaveXunjiCredential } from "@/server/integrations/xunji/runtime";

const xunjiCredentialInputSchema = z
  .object({
    apiKey: z.string().min(1).max(4_096),
  })
  .strict();
const garminCredentialInputSchema = z
  .object({ credential: z.unknown() })
  .strict();
const maxCredentialBodyBytes = 160 * 1024;

class InvalidCredentialRequestError extends Error {}

async function readCredentialInput(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > maxCredentialBodyBytes
  ) {
    throw new InvalidCredentialRequestError();
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxCredentialBodyBytes) {
    throw new InvalidCredentialRequestError();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new InvalidCredentialRequestError(undefined, { cause: error });
  }
}

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
    const status =
      value.provider === "garmin"
        ? await createDefaultGarminRuntime().status(value.trackerKey)
        : await getIntegrationStatus(value.trackerKey, value.provider);
    return Response.json(status, {
      headers: { "Cache-Control": "no-store" },
    });
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
    const body = await readCredentialInput(request);
    if (value.provider === "xunji") {
      const { apiKey } = xunjiCredentialInputSchema.parse(body);
      await validateAndSaveXunjiCredential({
        trackerKey: value.trackerKey,
        apiKey,
      });
      return Response.json(
        await getIntegrationStatus(value.trackerKey, value.provider),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const { credential } = garminCredentialInputSchema.parse(body);
    return Response.json(
      await createDefaultGarminRuntime().importCredential({
        trackerKey: value.trackerKey,
        credential,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (
      error instanceof ZodError ||
      error instanceof InvalidCredentialRequestError
    ) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (error instanceof XunjiProviderError) return providerFailure(error);
    if (error instanceof IntegrationTrackerNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
