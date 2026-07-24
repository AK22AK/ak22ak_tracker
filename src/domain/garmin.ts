import { z } from "zod";

import { localDateSchema } from "./schemas";
import { integrationCatchUpResultSchema } from "./integrations";

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
    sync: z
      .object({
        status: z.enum(["idle", "running", "succeeded", "failed"]),
        lastAttemptAt: z.string().datetime().nullable(),
        lastSucceededDate: localDateSchema.nullable(),
        nextCursor: localDateSchema.nullable(),
        lastErrorCode: garminProviderErrorCodeSchema.nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type GarminConnectionStatus = z.infer<
  typeof garminConnectionStatusSchema
>;

export const garminActivitySummarySchema = z
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

export const garminActivityPreviewItemSchema = garminActivitySummarySchema;

export const garminActivityPreviewResponseSchema = z
  .object({
    provider: z.literal("garmin"),
    date: localDateSchema,
    activities: z.array(garminActivitySummarySchema).max(100),
    connection: garminConnectionStatusSchema,
  })
  .strict();

export type GarminActivityPreviewResponse = z.infer<
  typeof garminActivityPreviewResponseSchema
>;

export const garminActivitySyncResponseSchema = z
  .object({
    provider: z.literal("garmin"),
    date: localDateSchema,
    sync: z
      .object({
        cached: z.boolean(),
        created: z.number().int().nonnegative(),
        changed: z.number().int().nonnegative(),
        unchanged: z.number().int().nonnegative(),
        recordCount: z.number().int().nonnegative(),
        syncedAt: z.string().datetime(),
      })
      .strict(),
    connection: garminConnectionStatusSchema,
  })
  .strict();

export type GarminActivitySyncResponse = z.infer<
  typeof garminActivitySyncResponseSchema
>;

export const garminActivityRecoveryResponseSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.literal("skipped"),
        reason: z.enum([
          "not_connected",
          "needs_validation",
          "needs_refresh",
          "invalid",
          "not_due",
          "in_progress",
        ]),
        connection: garminConnectionStatusSchema,
      })
      .strict(),
    z
      .object({
        status: z.literal("completed"),
        sync: integrationCatchUpResultSchema,
        connection: garminConnectionStatusSchema,
      })
      .strict(),
  ],
);

export type GarminActivityRecoveryResponse = z.infer<
  typeof garminActivityRecoveryResponseSchema
>;

const garminActivityTypeLabels: Record<string, string> = {
  running: "跑步",
  walking: "步行",
  hiking: "徒步",
  cycling: "骑行",
  swimming: "游泳",
  strength_training: "力量训练",
};

export function garminActivityTypeLabel(activityType: string) {
  return garminActivityTypeLabels[activityType] ?? "其他活动";
}
