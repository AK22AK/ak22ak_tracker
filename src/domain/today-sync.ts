import { z } from "zod";

export const todaySyncSourceSchema = z
  .object({
    source: z.enum(["garmin_activity", "garmin_wellness", "xunji_training"]),
    status: z.enum([
      "syncing",
      "records",
      "no_records",
      "temporarily_failed",
      "needs_credentials",
      "not_connected",
    ]),
    recordCount: z.number().int().nonnegative(),
    continueAvailable: z.boolean(),
  })
  .strict();

export const todaySyncResultSchema = z
  .object({ sources: z.array(todaySyncSourceSchema).length(3) })
  .strict();

export type TodaySyncSource = z.infer<typeof todaySyncSourceSchema>;
export type TodaySyncResult = z.infer<typeof todaySyncResultSchema>;
