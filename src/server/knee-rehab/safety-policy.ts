import "server-only";

import { z } from "zod";

import type { KneeCheckInSafetyPolicy } from "@/modules/knee-rehab/check-in";

const painThresholdSchema = z.coerce.number().int().min(1).max(10);

export function getKneeCheckInSafetyPolicy(): KneeCheckInSafetyPolicy {
  return {
    painYellowThreshold: painThresholdSchema.parse(
      process.env.KNEE_REHAB_PAIN_YELLOW_THRESHOLD,
    ),
  };
}
