import { z } from "zod";

import { localDateSchema } from "./schemas";

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

export const garminConnectionStateSchema = z.enum([
  "not_connected",
  "needs_validation",
  "connected",
  "needs_refresh",
  "invalid",
]);

export const garminConnectionStatusSchema = z
  .object({
    provider: z.literal("garmin"),
    state: garminConnectionStateSchema,
    verifiedAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime().nullable(),
    lastErrorCode: garminProviderErrorCodeSchema.nullable(),
  })
  .strict();

export type GarminConnectionStatus = z.infer<
  typeof garminConnectionStatusSchema
>;

export const garminActivityPreviewItemSchema = z
  .object({
    activityType: z.string().min(1).max(100),
    startedAt: z.string().datetime({ offset: true }),
    durationSeconds: z.number().nonnegative().max(604_800),
    distanceMeters: z.number().nonnegative().max(10_000_000).nullable(),
    averagePaceSecondsPerKilometer: z
      .number()
      .positive()
      .max(86_400)
      .nullable(),
    averageHeartRateBpm: z.number().int().positive().max(300).nullable(),
  })
  .strict();

export const garminActivityPreviewResponseSchema = z
  .object({
    provider: z.literal("garmin"),
    date: localDateSchema,
    activities: z.array(garminActivityPreviewItemSchema).max(100),
    connection: garminConnectionStatusSchema,
  })
  .strict();

export type GarminActivityPreviewResponse = z.infer<
  typeof garminActivityPreviewResponseSchema
>;
