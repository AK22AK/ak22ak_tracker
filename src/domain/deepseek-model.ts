import { z } from "zod";

export const deepSeekModelSchema = z.enum([
  "deepseek-v4-flash",
  "deepseek-v4-pro",
]);
export const defaultDeepSeekModel =
  deepSeekModelSchema.enum["deepseek-v4-flash"];

export type DeepSeekModel = z.infer<typeof deepSeekModelSchema>;
