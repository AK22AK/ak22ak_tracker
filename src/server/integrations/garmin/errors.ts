import "server-only";

import { z } from "zod";

import {
  garminProviderErrorCodeSchema,
  type GarminProviderErrorCode,
} from "@/domain/garmin";

export { garminProviderErrorCodeSchema } from "@/domain/garmin";
export type { GarminProviderErrorCode } from "@/domain/garmin";

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
