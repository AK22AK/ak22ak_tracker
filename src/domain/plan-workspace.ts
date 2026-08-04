import { z } from "zod";

import { localDateSchema, schemaVersion, trackerKeySchema } from "./schemas";

export const planWorkspaceSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    trackerKey: trackerKeySchema,
    localDate: localDateSchema,
    currentWeek: z.number().int().positive().nullable(),
    plan: z
      .object({
        id: z.uuid(),
        version: z.number().int().positive(),
        effectiveFrom: localDateSchema,
      })
      .nullable(),
    goals: z.array(z.string().min(1).max(500)).max(20),
    nextTraining: z
      .object({
        localDate: localDateSchema,
        taskCount: z.number().int().positive(),
        titles: z.array(z.string().min(1).max(200)).max(20),
      })
      .nullable(),
    pendingAdviceCount: z.number().int().nonnegative(),
    profileVersion: z.number().int().positive().nullable(),
    activeMemoryCount: z.number().int().nonnegative(),
  })
  .strict();

export type PlanWorkspace = z.infer<typeof planWorkspaceSchema>;
