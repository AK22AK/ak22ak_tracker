import { z } from "zod";

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
    lastErrorCode: z.string().nullable(),
  }),
});

export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;
