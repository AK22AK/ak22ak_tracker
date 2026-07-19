import { z } from "zod";

import { localDateSchema } from "./schemas";

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
