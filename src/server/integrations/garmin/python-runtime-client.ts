import "server-only";

import { z } from "zod";

import { localDateSchema } from "@/domain/schemas";

import {
  garminActivityEvidenceSchema,
  garminActivityReadResultSchema,
  garminCredentialSchema,
  garminPrivateClientDescriptor,
  type GarminClient,
  type GarminCredential,
} from "./contracts";
import { GarminProviderError, garminRuntimeFailureSchema } from "./errors";

const runtimeSchemaVersion = 1 as const;
const maxRuntimeResponseBytes = 128 * 1024;

const garminRuntimeSuccessSchema = z
  .object({
    ok: z.literal(true),
    schemaVersion: z.literal(runtimeSchemaVersion),
    clientVersion: z.literal(garminPrivateClientDescriptor.version),
    activities: z.array(garminActivityEvidenceSchema).max(100),
    refreshedTokenBundle: z.string().min(2).max(131_072),
  })
  .strict();

const runtimeRequestSchema = z
  .object({
    schemaVersion: z.literal(runtimeSchemaVersion),
    operation: z.literal("preview_activities"),
    client: z.literal(garminPrivateClientDescriptor.id),
    clientVersion: z.literal(garminPrivateClientDescriptor.version),
    date: localDateSchema,
    credential: garminCredentialSchema,
  })
  .strict();

type RuntimeConfig = {
  endpoint: string;
  secret: string;
};

function defaultRuntimeConfig(): RuntimeConfig {
  const secret = process.env.GARMIN_RUNTIME_SECRET;
  if (!secret) throw new GarminProviderError("provider_unavailable");

  const explicitEndpoint = process.env.GARMIN_RUNTIME_URL;
  if (explicitEndpoint) {
    const url = new URL(explicitEndpoint);
    const localDevelopment =
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    if (url.protocol !== "https:" && !localDevelopment) {
      throw new GarminProviderError("provider_unavailable");
    }
    return { endpoint: url.toString(), secret };
  }

  const vercelHost = process.env.VERCEL_URL;
  if (
    !vercelHost ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/i.test(vercelHost)
  ) {
    throw new GarminProviderError("provider_unavailable");
  }
  return {
    endpoint: `https://${vercelHost}/api/garmin-runtime`,
    secret,
  };
}

async function readLimitedResponse(response: Response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > maxRuntimeResponseBytes
  ) {
    throw new GarminProviderError("invalid_response");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxRuntimeResponseBytes) {
    throw new GarminProviderError("invalid_response");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new GarminProviderError("invalid_response", { cause: error });
  }
}

export function createGarminPythonRuntimeClient({
  fetchImpl = fetch,
  resolveConfig = defaultRuntimeConfig,
  timeoutMs = 12_000,
}: {
  fetchImpl?: typeof fetch;
  resolveConfig?: () => RuntimeConfig;
  timeoutMs?: number;
} = {}): GarminClient<GarminCredential> {
  async function requestActivities(input: {
    credential: GarminCredential;
    date: string;
    signal?: AbortSignal;
  }) {
    const config = resolveConfig();
    const body = runtimeRequestSchema.parse({
      schemaVersion: runtimeSchemaVersion,
      operation: "preview_activities",
      client: garminPrivateClientDescriptor.id,
      clientVersion: garminPrivateClientDescriptor.version,
      date: input.date,
      credential: input.credential,
    });
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(config.endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${config.secret}`,
          "Content-Type": "application/json",
          "X-AK-Garmin-Runtime-Version": String(runtimeSchemaVersion),
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new GarminProviderError("timeout", { cause: error });
      }
      throw new GarminProviderError("provider_unavailable", { cause: error });
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortFromCaller);
    }

    if (response.status === 401 || response.status === 403) {
      throw new GarminProviderError("provider_unavailable");
    }
    const value = await readLimitedResponse(response);
    const failure = garminRuntimeFailureSchema.safeParse(value);
    if (failure.success) {
      throw new GarminProviderError(failure.data.errorCode);
    }
    if (!response.ok) {
      throw new GarminProviderError("provider_unavailable");
    }

    const result = garminRuntimeSuccessSchema.safeParse(value);
    if (!result.success) {
      throw new GarminProviderError("invalid_response");
    }
    const refreshedCredential = garminCredentialSchema.safeParse({
      ...input.credential,
      tokenBundle: result.data.refreshedTokenBundle,
    });
    if (!refreshedCredential.success) {
      throw new GarminProviderError("invalid_response");
    }
    return garminActivityReadResultSchema.parse({
      activities: result.data.activities,
      refreshedCredential: refreshedCredential.data,
    });
  }

  return {
    descriptor: garminPrivateClientDescriptor,
    async validateCredential({ credential, signal }) {
      const date = new Date().toISOString().slice(0, 10);
      const result = await requestActivities({ credential, date, signal });
      return { refreshedCredential: result.refreshedCredential };
    },
    fetchActivitiesForDate: requestActivities,
  };
}
