import { z } from "zod";

import { localDateSchema, schemaVersion } from "./schemas";

export const integrationStatusSchema = z.object({
  provider: z.string().min(1),
  configured: z.boolean(),
  maskedKey: z.literal("••••••••").nullable(),
  verifiedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime().nullable(),
  sync: z.object({
    status: z.enum(["idle", "running", "succeeded", "failed"]),
    lastAttemptAt: z.string().datetime().nullable(),
    lastSucceededAt: z.string().datetime().nullable(),
    lastSucceededDate: localDateSchema.nullable(),
    nextCursor: localDateSchema.nullable().optional(),
    lastErrorCode: z.string().nullable(),
  }),
});

export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

const successfulSyncDaySchema = z.object({
  date: localDateSchema,
  status: z.literal("succeeded"),
  cached: z.boolean(),
  created: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  recordCount: z.number().int().nonnegative(),
  syncedAt: z.string().datetime(),
});

const failedSyncDaySchema = z.object({
  date: localDateSchema,
  status: z.literal("failed"),
  errorCode: z.string().min(1),
});

export const integrationCatchUpResultSchema = z.object({
  provider: z.string().min(1),
  batch: z.object({ from: localDateSchema, to: localDateSchema }).nullable(),
  targetDate: localDateSchema,
  days: z.array(
    z.discriminatedUnion("status", [
      successfulSyncDaySchema,
      failedSyncDaySchema,
    ]),
  ),
  summary: z.object({
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    created: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
  }),
  nextCursor: localDateSchema.nullable(),
  complete: z.boolean(),
  lastSucceededDate: localDateSchema.nullable(),
});

export type IntegrationCatchUpResult = z.infer<
  typeof integrationCatchUpResultSchema
>;

export const providerHistoryScopeSchema = z.enum([
  "garmin_activity_history",
  "garmin_wellness_history",
  "xunji_training_history",
]);

export const providerHistoryDaysSchema = z.union([
  z.literal(7),
  z.literal(14),
  z.literal(30),
]);

export const providerHistorySyncInputSchema = z
  .object({ days: providerHistoryDaysSchema })
  .strict();

export const providerHistorySyncResultSchema = z
  .object({
    provider: z.enum(["garmin", "xunji"]),
    scope: providerHistoryScopeSchema,
    range: z
      .object({
        from: localDateSchema,
        through: localDateSchema,
        days: providerHistoryDaysSchema,
      })
      .strict(),
    batch: z
      .object({ from: localDateSchema, to: localDateSchema })
      .strict()
      .nullable(),
    days: z.array(
      z.discriminatedUnion("status", [
        successfulSyncDaySchema,
        failedSyncDaySchema,
      ]),
    ),
    summary: z
      .object({
        succeeded: z.number().int().nonnegative(),
        empty: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        created: z.number().int().nonnegative(),
        changed: z.number().int().nonnegative(),
        unchanged: z.number().int().nonnegative(),
      })
      .strict(),
    nextCursor: localDateSchema.nullable(),
    complete: z.boolean(),
  })
  .strict();

export type ProviderHistoryScope = z.infer<typeof providerHistoryScopeSchema>;
export type ProviderHistoryDays = z.infer<typeof providerHistoryDaysSchema>;
export type ProviderHistorySyncResult = z.infer<
  typeof providerHistorySyncResultSchema
>;

export const providerHistoryRecordSourceSchema = z.enum([
  "garmin_activity",
  "garmin_wellness",
  "xunji_training",
]);

export const providerHistoryErrorCodeSchema = z.enum([
  "authentication",
  "membership_required",
  "invalid_token_bundle",
  "unsupported_client_version",
  "rate_limited",
  "timeout",
  "invalid_response",
  "provider_unavailable",
]);

const providerHistoryScopeOverviewSchema = z
  .object({
    scope: providerHistoryScopeSchema,
    connected: z.boolean(),
    status: z.enum(["idle", "running", "succeeded", "failed"]),
    nextCursor: localDateSchema.nullable(),
    lastErrorCode: providerHistoryErrorCodeSchema.nullable(),
    updatedAt: z.string().datetime().nullable(),
    summary: z
      .object({
        processed: z.number().int().nonnegative(),
        records: z.number().int().nonnegative(),
        empty: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        unknown: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const providerHistoryOverviewSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    range: z
      .object({
        from: localDateSchema,
        through: localDateSchema,
        days: providerHistoryDaysSchema,
      })
      .strict()
      .nullable(),
    updatedAt: z.string().datetime().nullable(),
    scopes: z.array(providerHistoryScopeOverviewSchema).length(3),
    historyRecordDates: z.array(
      z
        .object({
          date: localDateSchema,
          sources: z.array(providerHistoryRecordSourceSchema).min(1).max(3),
        })
        .strict(),
    ),
    savedRecordDates: z.array(
      z
        .object({
          date: localDateSchema,
          sources: z.array(providerHistoryRecordSourceSchema).min(1).max(3),
        })
        .strict(),
    ),
  })
  .strict();

export type ProviderHistoryOverview = z.infer<
  typeof providerHistoryOverviewSchema
>;

export const integrationRecoveryResponseSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.literal("skipped"),
        reason: z.enum(["not_connected", "not_due", "in_progress"]),
      })
      .strict(),
    z
      .object({
        status: z.literal("completed"),
        sync: integrationCatchUpResultSchema,
      })
      .strict(),
  ],
);
