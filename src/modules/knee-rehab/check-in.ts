import { z } from "zod";

import {
  evaluateSafetyPolicy,
  safetyPolicyReferenceSchema,
  type SafetyRule,
} from "@/domain/safety-policy";

export const kneeCheckInInputSchema = z.object({
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

export const kneeCheckInEventPayloadSchema = kneeCheckInInputSchema.extend({
  safetyLevel: z.enum(["green", "yellow", "red"]),
  safetyPolicy: safetyPolicyReferenceSchema.optional(),
});

export const auditedKneeCheckInEventPayloadSchema =
  kneeCheckInEventPayloadSchema.extend({
    safetyPolicy: safetyPolicyReferenceSchema,
  });

export const kneeCheckInSaveResultSchema = z.object({
  id: z.uuid(),
  safetyLevel: z.enum(["green", "yellow", "red"]),
  replayed: z.boolean(),
  safetyPolicy: safetyPolicyReferenceSchema,
  clientPolicyOutdated: z.boolean(),
});

export function evaluateKneeCheckIn(
  input: KneeCheckInInput,
  rules: readonly SafetyRule[],
) {
  return evaluateSafetyPolicy(input, rules);
}
