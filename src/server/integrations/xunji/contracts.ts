import { z } from "zod";

import { localDateSchema } from "@/domain/schemas";

export const xunjiSyncRequestSchema = z.object({
  schema_version: z.literal("train_open_api_v2"),
  datestr: localDateSchema,
  include_full_data: z.literal(true),
});

const epochMillisecondsSchema = z
  .number()
  .int()
  .min(-8_640_000_000_000_000)
  .max(8_640_000_000_000_000);

export const xunjiTrainSchema = z
  .object({
    datestr: localDateSchema,
    localid: z.union([z.string().min(1), z.number()]).transform(String),
    start: epochMillisecondsSchema,
    end: epochMillisecondsSchema,
    movements: z.array(z.unknown()),
  })
  .passthrough()
  .superRefine((train, context) => {
    if (train.end < train.start) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "Xunji training end must not precede start",
      });
    }
  });

export const xunjiTrainResponseSchema = z.object({
  res: z.object({
    trains: z.array(xunjiTrainSchema).superRefine((trains, context) => {
      const seen = new Set<string>();
      for (const train of trains) {
        if (seen.has(train.localid)) {
          context.addIssue({
            code: "custom",
            message: "Duplicate Xunji localid",
          });
          return;
        }
        seen.add(train.localid);
      }
    }),
  }),
});

export type XunjiTrain = z.infer<typeof xunjiTrainSchema>;
