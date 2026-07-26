import { z } from "zod";

import { isLocalDate } from "./calendar";
import { localDateSchema } from "./schemas";

const availabilitySchema = z.enum(["available", "missing"]);

export const aiRecoveryEvidenceSchema = z
  .object({
    localDate: localDateSchema,
    sleepStatus: availabilitySchema,
    sleepTotalSeconds: z.number().int().nonnegative().max(172_800).nullable(),
    sleepScore: z.number().int().nonnegative().max(100).nullable(),
    stepsStatus: availabilitySchema,
    totalSteps: z.number().int().nonnegative().max(1_000_000).nullable(),
    stepsPartial: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.sleepStatus === "missing" &&
        (value.sleepTotalSeconds !== null || value.sleepScore !== null)) ||
      (value.sleepStatus === "available" && value.sleepTotalSeconds === null)
    ) {
      context.addIssue({ code: "custom", message: "Invalid sleep coverage" });
    }
    if (
      (value.stepsStatus === "missing" && value.totalSteps !== null) ||
      (value.stepsStatus === "available" && value.totalSteps === null)
    ) {
      context.addIssue({ code: "custom", message: "Invalid steps coverage" });
    }
  });

export type AiRecoveryEvidence = z.infer<typeof aiRecoveryEvidenceSchema>;

type RecoveryRecord = Omit<AiRecoveryEvidence, "stepsPartial">;

function shiftDate(localDate: string, days: number) {
  if (!isLocalDate(localDate)) throw new Error("invalid_local_date");
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildRecoveryEvidence(input: {
  from: string;
  through: string;
  records: readonly RecoveryRecord[];
}): AiRecoveryEvidence[] {
  if (!isLocalDate(input.from) || !isLocalDate(input.through)) {
    throw new Error("invalid_local_date");
  }
  const recordsByDate = new Map(
    input.records.map((record) => [record.localDate, record]),
  );
  const result: AiRecoveryEvidence[] = [];
  for (
    let localDate = input.from;
    localDate <= input.through;
    localDate = shiftDate(localDate, 1)
  ) {
    const record = recordsByDate.get(localDate);
    result.push(
      aiRecoveryEvidenceSchema.parse({
        localDate,
        sleepStatus: record?.sleepStatus ?? "missing",
        sleepTotalSeconds: record?.sleepTotalSeconds ?? null,
        sleepScore: record?.sleepScore ?? null,
        stepsStatus: record?.stepsStatus ?? "missing",
        totalSteps: record?.totalSteps ?? null,
        stepsPartial: localDate === input.through,
      }),
    );
  }
  return result;
}
