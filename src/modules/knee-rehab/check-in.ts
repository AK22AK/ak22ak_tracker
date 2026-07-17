import { z } from "zod";

export const kneeCheckInInputSchema = z.object({
  localDate: z.string().date(),
  timing: z.enum(["morning", "post_training", "next_day", "incident"]),
  leftPain: z.number().int().min(0).max(10),
  rightPain: z.number().int().min(0).max(10),
  swelling: z.enum(["none", "mild", "obvious"]),
  stiffness: z.boolean(),
  mechanicalSymptoms: z.boolean(),
  weightBearingIssue: z.boolean(),
  localizedBonePain: z.boolean(),
  nightOrRestPain: z.boolean(),
  note: z.string().max(2_000).default(""),
});

export type KneeCheckInInput = z.infer<typeof kneeCheckInInputSchema>;
export type SafetyLevel = "green" | "yellow" | "red";

export const kneeCheckInEventPayloadSchema = kneeCheckInInputSchema.extend({
  safetyLevel: z.enum(["green", "yellow", "red"]),
});

export function evaluateKneeCheckIn(input: KneeCheckInInput): SafetyLevel {
  if (
    input.swelling === "obvious" ||
    input.mechanicalSymptoms ||
    input.weightBearingIssue ||
    input.localizedBonePain ||
    input.nightOrRestPain
  ) {
    return "red";
  }

  if (
    Math.max(input.leftPain, input.rightPain) >= 3 ||
    input.swelling === "mild" ||
    input.stiffness
  ) {
    return "yellow";
  }

  return "green";
}
