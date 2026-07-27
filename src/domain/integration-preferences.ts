import { z } from "zod";

import { deepSeekModelSchema } from "./deepseek-model";
import { schemaVersion } from "./schemas";

export const deepSeekIntegrationPreferenceSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    provider: z.literal("deepseek"),
    settings: z.object({ model: deepSeekModelSchema }).strict(),
  })
  .strict();

export const integrationPreferenceDocumentSchema = z.discriminatedUnion(
  "provider",
  [deepSeekIntegrationPreferenceSchema],
);

export type IntegrationPreferenceDocument = z.infer<
  typeof integrationPreferenceDocumentSchema
>;
