import { z } from "zod";

import { aiAnalysisErrorCodeSchema } from "./ai-analysis";
import { instantSchema, schemaVersion } from "./schemas";

export const deepSeekCredentialInputSchema = z
  .object({ apiKey: z.string().trim().min(1).max(4_096) })
  .strict();

export const deepSeekConnectionStatusSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    provider: z.literal("deepseek"),
    hasCredential: z.boolean(),
    state: z.enum([
      "not_connected",
      "connected",
      "needs_update",
      "unavailable",
    ]),
    verifiedAt: instantSchema.nullable(),
    updatedAt: instantSchema.nullable(),
    lastErrorCode: aiAnalysisErrorCodeSchema.nullable(),
  })
  .strict();

export type DeepSeekConnectionStatus = z.infer<
  typeof deepSeekConnectionStatusSchema
>;
