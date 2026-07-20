import { z } from "zod";

export const githubMirrorStatusSchema = z.object({
  configuration: z.enum([
    "configured",
    "not_configured",
    "invalid_configuration",
  ]),
  pendingCount: z.number().int().nonnegative(),
  processingCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  oldestPendingAt: z.string().datetime().nullable(),
  lastSucceededAt: z.string().datetime().nullable(),
  permissionError: z.boolean(),
  delayed: z.boolean(),
});

export const githubMirrorBatchResultSchema = z.object({
  status: z.enum([
    "not_configured",
    "invalid_configuration",
    "idle",
    "succeeded",
    "retry_scheduled",
    "needs_attention",
    "unconfirmed",
  ]),
  processed: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const githubMirrorSyncResponseSchema = z.object({
  result: githubMirrorBatchResultSchema,
  status: githubMirrorStatusSchema,
});

export type GitHubMirrorStatus = z.infer<typeof githubMirrorStatusSchema>;
