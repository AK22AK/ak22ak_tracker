import "server-only";

import type { PlanChangeOperation, PlanVersion } from "@/domain/schemas";

export type PlanAdjustmentSafetyLevel = "green" | "yellow" | "red";

export type PlanAdjustmentFeedback = {
  localDate: string;
  timing: "morning" | "post_training" | "next_day" | "incident";
  leftPain: number;
  rightPain: number;
  swelling: "none" | "mild" | "obvious";
  stiffness: boolean;
  mechanicalSymptoms: boolean;
  weightBearingIssue: boolean;
  localizedBonePain: boolean;
  nightOrRestPain: boolean;
  safetyLevel: PlanAdjustmentSafetyLevel;
};

export type PlanAdjustmentTraining = {
  taskDefinitionId: string;
  localDate: string;
  category: string;
  durationMinutes: number | null;
  distanceKm: number | null;
};

export interface PlanAdjustmentContext {
  currentPlan: Pick<
    PlanVersion,
    "id" | "trackerKey" | "version" | "effectiveFrom" | "tasks" | "notes"
  >;
  timelineHeadPlanVersionId: string;
  planningTimeZone: string;
  range: { from: string; through: string };
  recentFeedback: PlanAdjustmentFeedback[];
  confirmedTraining: PlanAdjustmentTraining[];
  safetyLevel: PlanAdjustmentSafetyLevel;
}

export type PlanAdvisorProposal = {
  summary: string;
  safetyLevel: PlanAdjustmentSafetyLevel;
  operations: PlanChangeOperation[];
  model: string;
  responseHash: string;
};

export interface PlanAdvisor {
  proposeAdjustment(
    context: PlanAdjustmentContext,
  ): Promise<PlanAdvisorProposal>;
}

// An AI adapter returns a validated proposal only. It never receives database
// or GitHub credentials and cannot apply its own proposal.
