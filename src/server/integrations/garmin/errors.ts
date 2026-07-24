import "server-only";

import { z } from "zod";

export const garminProviderErrorCodeSchema = z.enum([
  "invalid_token_bundle",
  "unsupported_client_version",
  "authentication",
  "rate_limited",
  "timeout",
  "invalid_response",
  "provider_unavailable",
]);

export type GarminProviderErrorCode = z.infer<
  typeof garminProviderErrorCodeSchema
>;

export const garminRuntimeFailureSchema = z
  .object({
    ok: z.literal(false),
    errorCode: garminProviderErrorCodeSchema,
  })
  .strict();

export class GarminProviderError extends Error {
  readonly code: GarminProviderErrorCode;

  constructor(code: GarminProviderErrorCode, options?: ErrorOptions) {
    super(`garmin_${code}`, options);
    this.name = "GarminProviderError";
    this.code = code;
  }
}

export function isRetryableGarminError(code: GarminProviderErrorCode) {
  return (
    code === "rate_limited" ||
    code === "timeout" ||
    code === "provider_unavailable"
  );
}
