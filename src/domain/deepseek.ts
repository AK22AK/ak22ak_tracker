import { z } from "zod";

import { aiAnalysisErrorCodeSchema } from "./ai-analysis";
import { deepSeekModelSchema } from "./deepseek-model";
import { instantSchema, schemaVersion } from "./schemas";

export { deepSeekModelSchema, defaultDeepSeekModel } from "./deepseek-model";
export type { DeepSeekModel } from "./deepseek-model";

export const deepSeekCredentialInputSchema = z
  .object({ apiKey: z.string().trim().min(1).max(4_096) })
  .strict();

export const deepSeekModelPreferenceInputSchema = z
  .object({ model: deepSeekModelSchema })
  .strict();

export const deepSeekConnectionTestResultSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    model: deepSeekModelSchema,
    reply: z.literal("连接正常"),
  })
  .strict();

export const deepSeekConnectionStatusSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    provider: z.literal("deepseek"),
    model: deepSeekModelSchema,
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
export type DeepSeekConnectionTestResult = z.infer<
  typeof deepSeekConnectionTestResultSchema
>;
